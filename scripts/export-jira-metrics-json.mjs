import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Some board-based teams are tracked internally under their Jira Team field
// value (e.g. "Team ASAP") but must surface in the dashboard under their
// canonical key (e.g. "ASAP") so their delivery metrics merge with the existing
// defect/sev/MTTR/AI rows for the same team.
const TEAM_NAME_OVERRIDES = {
  "Team ASAP": "ASAP",
  "Team Smartcare": "Smartcare",
};

function normalizeTeamName(teamName) {
  return TEAM_NAME_OVERRIDES[teamName] ?? teamName;
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(current);
      current = "";

      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    current += char;
  }

  if (current !== "" || row.length > 0) {
    row.push(current);
    if (row.some((cell) => cell !== "")) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const [headers, ...dataRows] = rows;

  return dataRows.map((dataRow) => {
    const entry = {};

    headers.forEach((header, index) => {
      entry[header] = dataRow[index] ?? "";
    });

    return entry;
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function metricValue(metricName, rawValue) {
  if (rawValue === "" || rawValue === undefined || rawValue === null) {
    return 0;
  }

  const parsed = Number(rawValue);

  if (Number.isNaN(parsed)) {
    throw new Error(`Metric value "${rawValue}" is not numeric for "${metricName}".`);
  }

  return parsed;
}

const sprintPeriodPattern = /^\d{4}-Q[1-4]-S\d+$/;

async function readSprintCalendar() {
  const repoRoot = path.resolve(__dirname, "..");
  const calendarPath = path.join(repoRoot, "backend/jira/generated/sprint_calendar_combined.csv");

  try {
    const text = await fs.readFile(calendarPath, "utf8");
    return parseCsv(text);
  } catch {
    return [];
  }
}

function buildSprintCalendarMap(calendarRows) {
  const map = {};

  for (const row of calendarRows) {
    const team = normalizeTeamName(row.team_name);
    const quarter = row.quarter_label;

    if (!team || !quarter) continue;

    if (!map[team]) map[team] = {};
    if (!map[team][quarter]) map[team][quarter] = [];

    map[team][quarter].push({
      key: row.sprint_key,
      sequence: Number(row.sprint_sequence),
      name: row.sprint_name,
      start: row.sprint_start_date,
      end: row.sprint_end_date,
    });
  }

  for (const team of Object.values(map)) {
    for (const sprints of Object.values(team)) {
      sprints.sort((a, b) => a.sequence - b.sequence);
    }
  }

  return map;
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    throw new Error(
      "Usage: node scripts/export-jira-metrics-json.mjs <input-csv-path> <output-json-path>",
    );
  }

  const csvText = await fs.readFile(inputPath, "utf8");
  const rows = parseCsv(csvText);

  const metrics = rows.map((row) => ({
    team: normalizeTeamName(row.team_name),
    quarter: row.quarter_label,
    metricName: row.metric_name,
    value: metricValue(row.metric_name, row.metric_value),
    unit: row.metric_unit,
    source: row.source_system,
    automationStatus: row.coverage_status,
    note: row.note,
    lastRefreshUtc: row.last_refresh_utc,
  }));

  const latestRefresh = rows
    .map((row) => row.last_refresh_utc)
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0];

  const reportDate = latestRefresh ? latestRefresh.slice(0, 10) : new Date().toISOString().slice(0, 10);

  const quarterOnlyLabels = uniqueSorted(
    rows.map((row) => row.quarter_label).filter((label) => !sprintPeriodPattern.test(label)),
  );

  const calendarRows = await readSprintCalendar();
  const sprintCalendar = buildSprintCalendarMap(calendarRows);

  const payload = {
    reportDate,
    teams: uniqueSorted(rows.map((row) => normalizeTeamName(row.team_name))),
    quarters: quarterOnlyLabels,
    sprintCalendar,
    metrics,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

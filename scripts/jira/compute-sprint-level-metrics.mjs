import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const generatedDir = path.join(repoRoot, "backend/jira/generated");

const jsonExportViewPath = path.join(generatedDir, "json_export_view.csv");
const sprintCalendarCombinedPath = path.join(generatedDir, "sprint_calendar_combined.csv");

const sprintPeriodPattern = /^\d{4}-Q[1-4]-S\d+$/;

const jsonExportViewHeaders = [
  "team_name",
  "quarter_label",
  "metric_name",
  "metric_value",
  "metric_unit",
  "source_system",
  "coverage_status",
  "note",
  "last_refresh_utc",
];

const sprintCalendarCombinedHeaders = [
  "team_name",
  "quarter_label",
  "sprint_key",
  "sprint_sequence",
  "sprint_name",
  "sprint_start_date",
  "sprint_end_date",
  "sprint_length_weeks",
];

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

  const [headerRow, ...dataRows] = rows;
  return dataRows.map((dataRow) => {
    const entry = {};
    headerRow.forEach((header, index) => {
      entry[header] = dataRow[index] ?? "";
    });
    return entry;
  });
}

function csvEscape(value) {
  const stringValue = value === undefined || value === null ? "" : String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function toCsv(headersList, rows) {
  const lines = [headersList.join(",")];
  for (const row of rows) {
    lines.push(headersList.map((header) => csvEscape(row[header] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function readCsvFile(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parseCsv(text);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function round(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }
  return Number(value.toFixed(decimals));
}

function sprintKey(quarterLabel, sprintSequence) {
  return `${quarterLabel}-S${sprintSequence}`;
}

function isoDateOnly(isoString) {
  return String(isoString ?? "").slice(0, 10);
}

async function discoverQuarterDirs() {
  const entries = await fs.readdir(generatedDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function loadAllSprintData() {
  const years = await discoverQuarterDirs();
  const allSprintInputs = [];
  const allCalendar = [];
  const allCycleTime = [];
  const allVelocityBySprint = [];

  for (const year of years) {
    const yearDir = path.join(generatedDir, year);
    const files = await fs.readdir(yearDir);

    for (const file of files) {
      const filePath = path.join(yearDir, file);

      if (file.startsWith("metric_inputs_by_sprint_")) {
        const rows = await readCsvFile(filePath);
        allSprintInputs.push(...rows);
      } else if (file.startsWith("sprint_calendar_")) {
        const rows = await readCsvFile(filePath);
        allCalendar.push(...rows);
      } else if (file.startsWith("cycle_time_issue_level_")) {
        const rows = await readCsvFile(filePath);
        allCycleTime.push(...rows);
      } else if (file.startsWith("velocity_by_sprint_")) {
        const rows = await readCsvFile(filePath);
        allVelocityBySprint.push(...rows);
      }
    }
  }

  return { allSprintInputs, allCalendar, allCycleTime, allVelocityBySprint };
}

function buildSprintLookup(calendarRows) {
  const lookup = new Map();
  for (const row of calendarRows) {
    const key = `${row.team_name}::${row.sprint_id}`;
    lookup.set(key, row);
  }
  return lookup;
}

function buildVelocityLookup(velocityRows) {
  const lookup = new Map();
  for (const row of velocityRows) {
    const key = `${row.team_name}::${row.sprint_id}`;
    lookup.set(key, toNumber(row.velocity_points) ?? 0);
  }
  return lookup;
}

function computeSprintMetrics(sprintInputs, calendarRows, cycleTimeRows, velocityRows) {
  const sprintLookup = buildSprintLookup(calendarRows);
  const velocityLookup = buildVelocityLookup(velocityRows);
  const exportRows = [];
  const calendarExport = [];

  for (const sprint of sprintInputs) {
    const calKey = `${sprint.team_name}::${sprint.sprint_id}`;
    const cal = sprintLookup.get(calKey);

    if (!cal) {
      continue;
    }

    const seq = toNumber(cal.sprint_sequence);
    if (seq === null) continue;

    const periodKey = sprintKey(sprint.quarter_label, seq);
    const sprintLengthWeeks = toNumber(cal.sprint_length_weeks) ?? 2;

    const committed = toNumber(sprint.cards_committed_at_start) ?? 0;
    const removed = toNumber(sprint.cards_removed_after_start) ?? 0;
    const reestimated = toNumber(sprint.cards_reestimated_after_start) ?? 0;
    const backward = toNumber(sprint.cards_sent_backward_after_start) ?? 0;
    const velocityKey = `${sprint.team_name}::${sprint.sprint_id}`;
    const completedPoints = velocityLookup.has(velocityKey)
      ? velocityLookup.get(velocityKey)
      : (toNumber(sprint.completed_points) ?? 0);
    const wipCards = toNumber(sprint.average_wip_cards) ?? 0;
    const throughput = toNumber(sprint.average_throughput_cards_per_sprint) ?? 0;
    const lastRefresh = sprint.last_refresh_utc || "";

    const churnPct = committed > 0
      ? ((removed + reestimated + backward) / committed) * 100
      : null;

    const flowProxy = throughput > 0
      ? (wipCards / throughput) * sprintLengthWeeks
      : null;

    const sprintStart = new Date(cal.sprint_start_date);
    const sprintEnd = new Date(cal.sprint_end_date);

    const sprintCycleTimeIssues = cycleTimeRows.filter((row) => {
      if (row.team_name !== sprint.team_name) return false;
      if (row.completed_in_done_category_flag !== "yes") return false;
      if (row.completed_with_allowed_resolution_flag !== "yes") return false;
      const endDate = new Date(row.cycle_time_end_utc);
      return endDate > sprintStart && endDate <= sprintEnd;
    });

    const actualCycleTimeWeeks = sprintCycleTimeIssues.length > 0
      ? sprintCycleTimeIssues.reduce((sum, row) => sum + (toNumber(row.cycle_time_weeks) ?? 0), 0) / sprintCycleTimeIssues.length
      : null;

    exportRows.push({
      team_name: sprint.team_name,
      quarter_label: periodKey,
      metric_name: "Jira Card Churn %",
      metric_value: round(churnPct),
      metric_unit: "percent",
      source_system: "Jira",
      coverage_status: "Yes (partial)",
      note: `Sprint ${seq} of ${sprint.quarter_label}.`,
      last_refresh_utc: lastRefresh,
    });

    exportRows.push({
      team_name: sprint.team_name,
      quarter_label: periodKey,
      metric_name: "Average Velocity (points per sprint)",
      metric_value: round(completedPoints),
      metric_unit: "points",
      source_system: "Jira",
      coverage_status: "Yes (partial)",
      note: `Sprint ${seq} of ${sprint.quarter_label}.`,
      last_refresh_utc: lastRefresh,
    });

    exportRows.push({
      team_name: sprint.team_name,
      quarter_label: periodKey,
      metric_name: "Flow-based Cycle Time Proxy (weeks)",
      metric_value: round(flowProxy),
      metric_unit: "weeks",
      source_system: "Jira",
      coverage_status: "Yes (partial)",
      note: `Sprint ${seq} of ${sprint.quarter_label}.`,
      last_refresh_utc: lastRefresh,
    });

    if (actualCycleTimeWeeks !== null) {
      exportRows.push({
        team_name: sprint.team_name,
        quarter_label: periodKey,
        metric_name: "Actual Cycle Time (weeks)",
        metric_value: round(actualCycleTimeWeeks),
        metric_unit: "weeks",
        source_system: "Jira",
        coverage_status: "Yes (partial)",
        note: `Sprint ${seq} of ${sprint.quarter_label} (${sprintCycleTimeIssues.length} items).`,
        last_refresh_utc: lastRefresh,
      });
    }

    calendarExport.push({
      team_name: sprint.team_name,
      quarter_label: sprint.quarter_label,
      sprint_key: periodKey,
      sprint_sequence: String(seq),
      sprint_name: cal.sprint_name,
      sprint_start_date: isoDateOnly(cal.sprint_start_date),
      sprint_end_date: isoDateOnly(cal.sprint_end_date),
      sprint_length_weeks: String(sprintLengthWeeks),
    });
  }

  return { exportRows, calendarExport };
}

function sortByKeys(rows, keys) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const leftValue = String(left[key] ?? "");
      const rightValue = String(right[key] ?? "");
      const compare = leftValue.localeCompare(rightValue);
      if (compare !== 0) return compare;
    }
    return 0;
  });
}

async function main() {
  const { allSprintInputs, allCalendar, allCycleTime, allVelocityBySprint } = await loadAllSprintData();

  if (allSprintInputs.length === 0) {
    console.log(JSON.stringify({ message: "No sprint data found.", sprintMetrics: 0 }));
    return;
  }

  const { exportRows, calendarExport } = computeSprintMetrics(
    allSprintInputs,
    allCalendar,
    allCycleTime,
    allVelocityBySprint,
  );

  const existingExportView = await readCsvFile(jsonExportViewPath);
  const withoutSprints = existingExportView.filter(
    (row) => !sprintPeriodPattern.test(row.quarter_label),
  );
  const finalExportView = sortByKeys(
    [...withoutSprints, ...exportRows],
    ["team_name", "quarter_label", "metric_name"],
  );

  const sortedCalendar = sortByKeys(calendarExport, [
    "team_name",
    "quarter_label",
    "sprint_key",
  ]);

  await Promise.all([
    fs.writeFile(jsonExportViewPath, toCsv(jsonExportViewHeaders, finalExportView), "utf8"),
    fs.writeFile(sprintCalendarCombinedPath, toCsv(sprintCalendarCombinedHeaders, sortedCalendar), "utf8"),
  ]);

  console.log(
    JSON.stringify(
      {
        sprintInputsRead: allSprintInputs.length,
        calendarEntriesRead: allCalendar.length,
        cycleTimeIssuesRead: allCycleTime.length,
        sprintMetricRowsWritten: exportRows.length,
        calendarRowsWritten: calendarExport.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

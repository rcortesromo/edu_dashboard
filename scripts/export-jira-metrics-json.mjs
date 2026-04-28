import fs from "node:fs/promises";
import path from "node:path";

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
    team: row.team_name,
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

  const payload = {
    reportDate,
    teams: uniqueSorted(rows.map((row) => row.team_name)),
    quarters: uniqueSorted(rows.map((row) => row.quarter_label)),
    metrics,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

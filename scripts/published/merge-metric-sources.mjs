import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const jiraInputPath = path.join(repoRoot, "backend/jira/generated/json_export_view.csv");
const aiInputPath = path.join(repoRoot, "backend/ai/generated/json_export_view.csv");
const outputPath = path.join(repoRoot, "backend/published/generated/json_export_view.csv");

const headers = [
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

function sortRows(rows) {
  return [...rows].sort((left, right) => {
    const teamCompare = String(left.team_name ?? "").localeCompare(String(right.team_name ?? ""));
    if (teamCompare !== 0) {
      return teamCompare;
    }

    const quarterCompare = String(left.quarter_label ?? "").localeCompare(String(right.quarter_label ?? ""));
    if (quarterCompare !== 0) {
      return quarterCompare;
    }

    const metricCompare = String(left.metric_name ?? "").localeCompare(String(right.metric_name ?? ""));
    if (metricCompare !== 0) {
      return metricCompare;
    }

    return String(left.source_system ?? "").localeCompare(String(right.source_system ?? ""));
  });
}

async function main() {
  const [jiraRows, aiRows] = await Promise.all([readCsvFile(jiraInputPath), readCsvFile(aiInputPath)]);
  const mergedByKey = new Map();

  for (const row of [...jiraRows, ...aiRows]) {
    const key = [
      row.team_name,
      row.quarter_label,
      row.metric_name,
      row.source_system,
      row.metric_unit,
    ].join("::");
    mergedByKey.set(key, row);
  }

  const mergedRows = sortRows([...mergedByKey.values()]);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, toCsv(headers, mergedRows), "utf8");

  console.log(
    JSON.stringify(
      {
        jiraRows: jiraRows.length,
        aiRows: aiRows.length,
        mergedRows: mergedRows.length,
        outputPath,
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

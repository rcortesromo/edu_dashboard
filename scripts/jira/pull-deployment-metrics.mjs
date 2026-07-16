import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findSprintForDate,
  matchDeploymentTeam,
  parseDeploymentDate,
  periodLabelsFrom,
  quarterLabelForDate,
  ytdLabelForDate,
} from "./deployment-metrics-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const envPath = path.join(repoRoot, ".env.local");
const mappingPath = path.join(repoRoot, "backend/jira/config/jira-field-mapping.template.json");
const generatedDir = path.join(repoRoot, "backend/jira/generated");
const calendarPath = path.join(generatedDir, "sprint_calendar_combined.csv");
const exportPath = path.join(generatedDir, "deployment_export.csv");
const auditPath = path.join(generatedDir, "deployment_issue_audit.csv");

const METRIC_NAME = "No. of Deployments";
const METRIC_UNIT = "count";
const SOURCE_SYSTEM = "Jira";
const OFFICIAL_CALENDAR_TEAM = "Team Connexpoint";

const exportHeaders = [
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

const auditHeaders = [
  "issue_key",
  "summary",
  "matched_prefix",
  "output_team_name",
  "status",
  "parsed_date",
  "matched_date_text",
  "quarter_label",
  "sprint_key",
  "included_flag",
  "exclusion_reason",
  "last_refresh_utc",
];

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    env[trimmed.slice(0, equalsIndex).trim()] = trimmed
      .slice(equalsIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function ensureRequiredEnv(env) {
  const missing = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"].filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
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
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      continue;
    }
    current += char;
  }

  if (current !== "" || row.length > 0) {
    row.push(current);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  if (rows.length === 0) return [];

  const [headers, ...dataRows] = rows;
  return dataRows.map((dataRow) =>
    Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ""])),
  );
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  return `${[
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n")}\n`;
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function sortByKeys(rows, keys) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const comparison = String(left[key] ?? "").localeCompare(String(right[key] ?? ""));
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

class JiraClient {
  constructor({ baseUrl, email, token }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  }

  async requestJson(urlPath, params = {}) {
    const url = new URL(`${this.baseUrl}${urlPath}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: this.authHeader },
    });
    if (!response.ok) {
      throw new Error(`Jira request failed (${response.status}) for ${url.pathname}: ${await response.text()}`);
    }
    return response.json();
  }

  async getBoardIssues(boardId) {
    const board = await this.requestJson(`/rest/agile/1.0/board/${boardId}/configuration`);
    const filterId = board.filter?.id;
    if (!filterId) throw new Error(`Jira board ${boardId} does not expose a saved filter.`);

    const issues = [];
    let nextPageToken = "";
    do {
      const payload = await this.requestJson("/rest/api/3/search/jql", {
        jql: `filter = ${filterId} ORDER BY key ASC`,
        fields: "summary,status",
        maxResults: 100,
        nextPageToken,
      });
      issues.push(...(payload.issues ?? []));
      nextPageToken = payload.nextPageToken ?? "";
    } while (nextPageToken);
    return { board, issues };
  }
}

async function loadCanonicalSprintWindows(startDate, now) {
  const rows = parseCsv(await fs.readFile(calendarPath, "utf8"));
  const byKey = new Map();

  for (const row of rows) {
    if (row.team_name !== OFFICIAL_CALENDAR_TEAM || Number(row.sprint_sequence) === 0) continue;
    const start = new Date(`${row.sprint_start_date}T00:00:00.000Z`);
    const end = new Date(`${row.sprint_end_date}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end < startDate || start > now) continue;

    const existing = byKey.get(row.sprint_key);
    if (!existing) {
      byKey.set(row.sprint_key, {
        key: row.sprint_key,
        quarter: row.quarter_label,
        sequence: Number(row.sprint_sequence),
        start: row.sprint_start_date,
        end: row.sprint_end_date,
      });
      continue;
    }
    if (row.sprint_start_date < existing.start) existing.start = row.sprint_start_date;
    if (row.sprint_end_date > existing.end) existing.end = row.sprint_end_date;
  }

  return [...byKey.values()].sort((left, right) => left.start.localeCompare(right.start));
}

function increment(counts, teamName, period) {
  counts.set(`${teamName}::${period}`, (counts.get(`${teamName}::${period}`) ?? 0) + 1);
}

function metricRow(team, period, value, refreshTimestamp, notePrefix = "") {
  return {
    team_name: team,
    quarter_label: period,
    metric_name: METRIC_NAME,
    metric_value: String(value),
    metric_unit: METRIC_UNIT,
    source_system: SOURCE_SYSTEM,
    coverage_status: "Yes",
    note: `${notePrefix}${value} Done RMM deployment ticket(s) with a valid title date in ${period}.`,
    last_refresh_utc: refreshTimestamp,
  };
}

async function main() {
  const env = parseEnv(await fs.readFile(envPath, "utf8"));
  ensureRequiredEnv(env);
  const mapping = JSON.parse(await fs.readFile(mappingPath, "utf8"));
  const config = mapping.deploymentMetrics;
  if (!config?.boardId || !Array.isArray(config.teams) || config.teams.length === 0) {
    throw new Error("Missing deploymentMetrics board/team configuration.");
  }

  const now = new Date();
  const refreshTimestamp = now.toISOString();
  const startDate = new Date(`${config.deploymentDateFrom ?? "2025-01-01"}T00:00:00.000Z`);
  const doneStatus = normalize(config.doneStatus ?? "Done");
  const portfolioTeam = config.portfolioTeamName ?? "EDU";
  const windows = await loadCanonicalSprintWindows(startDate, now);
  if (windows.length === 0) {
    throw new Error("No official CXP sprint windows are available for the deployment date range.");
  }

  const client = new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    token: env.JIRA_API_TOKEN,
  });
  const { board, issues } = await client.getBoardIssues(config.boardId);
  const counts = new Map();
  const auditRows = [];
  const excludedByReason = {};
  let matchedPrefixCount = 0;
  let includedCount = 0;

  for (const issue of issues) {
    const summary = issue.fields?.summary ?? "";
    const team = matchDeploymentTeam(summary, config.teams);
    if (!team) continue;
    matchedPrefixCount += 1;

    const status = issue.fields?.status?.name ?? "";
    const parsed = parseDeploymentDate(summary);
    const date = parsed?.date ?? null;
    const quarter = date ? quarterLabelForDate(date) : "";
    const sprint = date ? findSprintForDate(windows, date) : null;
    let exclusionReason = "";
    if (normalize(status) !== doneStatus) exclusionReason = "status_not_done";
    else if (!date) exclusionReason = "missing_or_invalid_title_date";
    else if (date < startDate) exclusionReason = "before_2025";
    else if (date > now) exclusionReason = "future_deployment_date";

    const included = exclusionReason === "";
    if (included) {
      includedCount += 1;
      increment(counts, team.outputTeamName, quarter);
      increment(counts, team.outputTeamName, ytdLabelForDate(date));
      if (sprint) increment(counts, team.outputTeamName, sprint.key);
    } else {
      excludedByReason[exclusionReason] = (excludedByReason[exclusionReason] ?? 0) + 1;
    }

    auditRows.push({
      issue_key: issue.key,
      summary,
      matched_prefix: team.titlePrefix,
      output_team_name: team.outputTeamName,
      status,
      parsed_date: date ? isoDate(date) : "",
      matched_date_text: parsed?.raw ?? "",
      quarter_label: quarter,
      sprint_key: sprint?.key ?? "",
      included_flag: included ? "yes" : "no",
      exclusion_reason: exclusionReason,
      last_refresh_utc: refreshTimestamp,
    });
  }

  const teamNames = config.teams.map((team) => team.outputTeamName);
  const { quarters, years } = periodLabelsFrom(startDate, now);
  const sprintKeys = windows.map((window) => window.key);
  const allPeriods = [...quarters, ...years, ...sprintKeys];
  const exportRows = [];

  for (const team of teamNames) {
    for (const period of allPeriods) {
      exportRows.push(metricRow(team, period, counts.get(`${team}::${period}`) ?? 0, refreshTimestamp));
    }
  }

  for (const period of allPeriods) {
    const value = teamNames.reduce(
      (sum, team) => sum + (counts.get(`${team}::${period}`) ?? 0),
      0,
    );
    exportRows.push(metricRow(portfolioTeam, period, value, refreshTimestamp, "Portfolio rollup. "));
  }

  await fs.mkdir(generatedDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      exportPath,
      toCsv(exportHeaders, sortByKeys(exportRows, ["team_name", "quarter_label"])),
      "utf8",
    ),
    fs.writeFile(
      auditPath,
      toCsv(auditHeaders, sortByKeys(auditRows, ["output_team_name", "parsed_date", "issue_key"])),
      "utf8",
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        board: { id: board.id, name: board.name, type: board.type },
        dateRange: { from: isoDate(startDate), through: isoDate(now) },
        issuesFetched: issues.length,
        matchedPrefixCount,
        includedDeployments: includedCount,
        excludedByReason,
        sprintPeriods: sprintKeys.length,
        exportRows: exportRows.length,
        outputs: { exportPath, auditPath },
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

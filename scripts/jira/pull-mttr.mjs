import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const mappingPath = path.join(repoRoot, "backend/jira/config/jira-field-mapping.template.json");
const generatedDir = path.join(repoRoot, "backend/jira/generated");

const exportPath = path.join(generatedDir, "mttr_export.csv");
const combinedCalendarPath = path.join(generatedDir, "sprint_calendar_combined.csv");

// Mean Time To Resolve: business time from an OV issue's creation until its status changes to
// "Closed". Population = OV issues of type Bug/Story/Task whose Severity is Level 1 / Level 2,
// grouped by the Jira Team field into the EDU teams. The end of the clock is taken from the
// changelog (the latest status -> Closed transition), falling back to resolutiondate when an
// already-Closed issue has no recorded transition.
// The main metric is the MEDIAN (robust to the long-tail of aged tickets); the average is kept as a
// reference series so the spikes from a few months-old tickets are still visible.
const MTTR_METRIC_NAME = "MTTR (Sev 1 + Sev 2)";
const MTTR_AVG_METRIC_NAME = "MTTR Avg (Sev 1 + Sev 2)";
const MTTR_TICKETS_METRIC_NAME = "MTTR Tickets (Sev 1 + Sev 2)";
const MTTR_UNIT = "hours";
const COUNT_UNIT = "count";
const SOURCE_SYSTEM = "Jira";
const COVERAGE_STATUS = "Yes (partial)";
const DEFAULT_PORTFOLIO = "EDU";

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

// --- generic helpers (self-contained so this script can run in isolation) ---

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return env;
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

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function toIsoDateTime(date) {
  return date.toISOString();
}

function round(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return Number(value.toFixed(decimals));
}

function sortByKeys(rows, keys) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const compare = String(left[key] ?? "").localeCompare(String(right[key] ?? ""));
      if (compare !== 0) return compare;
    }
    return 0;
  });
}

// --- quarter / period helpers ---

function quarterForDate(date) {
  return Math.floor(date.getUTCMonth() / 3) + 1;
}

function quarterWindowForDate(date) {
  const year = date.getUTCFullYear();
  const quarter = quarterForDate(date);
  const startMonth = (quarter - 1) * 3;
  return {
    year,
    quarter,
    label: `${year}-Q${quarter}`,
    start: new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)),
  };
}

function quarterWindowFromLabel(label) {
  const match = /^(\d{4})-Q([1-4])$/.exec(String(label ?? "").trim());
  if (!match) {
    throw new Error(`Invalid quarter format "${label}". Expected YYYY-Q#.`);
  }
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const startMonth = (quarter - 1) * 3;
  return {
    year,
    quarter,
    label: `${year}-Q${quarter}`,
    start: new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)),
  };
}

function getArgValue(argv, name) {
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === name) {
      return argv[index + 1] ?? "";
    }
    if (entry.startsWith(`${name}=`)) {
      return entry.slice(`${name}=`.length);
    }
  }
  return "";
}

function parentQuarterOfSprintKey(sprintKey) {
  const match = /^(\d{4}-Q[1-4])-S\d+$/.exec(String(sprintKey ?? "").trim());
  return match ? match[1] : "";
}

// Business time (milliseconds) between two instants, excluding Saturdays and Sundays (UTC). Full
// weekend days are removed; weekday partial segments are counted at their real elapsed duration.
function businessMsBetween(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end <= start) return 0;

  let total = 0;
  let cursor = new Date(start.getTime());
  while (cursor < end) {
    const day = cursor.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const endOfDay = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1, 0, 0, 0, 0),
    );
    const segEnd = end < endOfDay ? end : endOfDay;
    if (day !== 0 && day !== 6) {
      total += segEnd.getTime() - cursor.getTime();
    }
    cursor = segEnd;
  }
  return total;
}

function businessHoursBetween(start, end) {
  return businessMsBetween(start, end) / 3_600_000;
}

// --- Jira client (subset of the quarterly pull client) ---

class JiraClient {
  constructor({ baseUrl, email, token }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  }

  async requestJson(urlPath, params = {}) {
    const url = new URL(`${this.baseUrl}${urlPath}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: this.authHeader,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira request failed (${response.status}) for ${url.pathname}: ${errorText}`);
    }

    return response.json();
  }

  async searchIssues(jql, fields) {
    const issues = [];
    let nextPageToken = "";
    let hasMore = true;
    while (hasMore) {
      const payload = await this.requestJson("/rest/api/3/search/jql", {
        jql,
        maxResults: 100,
        fields: fields.join(","),
        fieldsByKeys: "false",
        nextPageToken,
      });
      issues.push(...(payload.issues ?? []));
      nextPageToken = payload.nextPageToken ?? "";
      hasMore = Boolean(nextPageToken);
    }
    return issues;
  }

  async getIssueChangelog(issueKey) {
    const entries = [];
    let startAt = 0;
    let total = Infinity;
    while (startAt < total) {
      const payload = await this.requestJson(`/rest/api/3/issue/${issueKey}/changelog`, {
        startAt,
        maxResults: 100,
      });
      entries.push(...(payload.values ?? []));
      total = payload.total ?? entries.length;
      startAt += payload.maxResults ?? 100;
    }
    return entries;
  }
}

function ensureRequiredEnv(env) {
  const requiredKeys = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"];
  const missing = requiredKeys.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

// --- sprint calendar (Team Connexpoint is the single official calendar; sprint 0 excluded) ---

const OFFICIAL_CALENDAR_TEAM = "Team Connexpoint";
const EXCLUDED_SPRINT_SEQUENCES = new Set([0]);

async function loadCanonicalSprintWindows() {
  const rows = await readCsvFile(combinedCalendarPath);
  const byKey = new Map();

  for (const row of rows) {
    if (row.team_name !== OFFICIAL_CALENDAR_TEAM) continue;

    const sequence = Number(row.sprint_sequence) || 0;
    if (EXCLUDED_SPRINT_SEQUENCES.has(sequence)) continue;

    const key = row.sprint_key;
    const quarter = parentQuarterOfSprintKey(key);
    if (!quarter) continue;

    const start = new Date(`${row.sprint_start_date}T00:00:00.000Z`);
    const end = new Date(`${row.sprint_end_date}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { key, sequence, quarter, start, end });
      continue;
    }
    if (start < existing.start) existing.start = start;
    if (end > existing.end) existing.end = end;
  }

  const byQuarter = new Map();
  for (const entry of byKey.values()) {
    if (!byQuarter.has(entry.quarter)) byQuarter.set(entry.quarter, []);
    byQuarter.get(entry.quarter).push(entry);
  }

  for (const entries of byQuarter.values()) {
    entries.sort((a, b) => a.sequence - b.sequence);
  }

  return byQuarter;
}

function findCanonicalSprint(windowsByQuarter, quarterLabel, date) {
  const entries = windowsByQuarter.get(quarterLabel) ?? [];
  return entries.find((sprint) => date >= sprint.start && date <= sprint.end) ?? null;
}

function fieldVal(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    return raw.value ?? raw.name ?? "";
  }
  return String(raw);
}

// The Jira Team field can be a string, an object, or a single-element array of objects.
function teamFieldValue(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first ? (first.value ?? first.name ?? "") : "";
  }
  if (typeof raw === "object") {
    return raw.value ?? raw.name ?? "";
  }
  return String(raw);
}

// Latest timestamp at which the issue transitioned into the given status, from the changelog.
function lastTransitionInto(changelog, statusName) {
  const target = normalizeName(statusName);
  let latest = null;
  for (const entry of changelog) {
    for (const item of entry.items ?? []) {
      if (item.field !== "status") continue;
      if (normalizeName(item.toString) !== target) continue;
      const when = new Date(entry.created);
      if (Number.isNaN(when.getTime())) continue;
      if (!latest || when > latest) latest = when;
    }
  }
  return latest;
}

// A bucket keeps every per-ticket business-hours value so we can derive both the median and the
// average for the team/period (and roll them up correctly by concatenating the underlying samples).
function newBucket() {
  return { hours: [] };
}

function addInto(target, src) {
  target.hours.push(...src.hours);
}

function medianOf(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function noteFor(period, count, medianHours, avgHours) {
  return `${period}: ${count} Sev 1/2 ticket(s), median ${round(medianHours)}h / avg ${round(avgHours)}h business time.`;
}

// Emit the MTTR (median), MTTR Avg, and ticket-count rows for one team/period.
function rowsFor(team, periodLabel, bucket, lastRefresh, notePrefix = "") {
  const count = bucket.hours.length;
  const medianHours = count > 0 ? medianOf(bucket.hours) : null;
  const avgHours = count > 0 ? bucket.hours.reduce((sum, h) => sum + h, 0) / count : null;
  const base = {
    team_name: team,
    quarter_label: periodLabel,
    source_system: SOURCE_SYSTEM,
    coverage_status: COVERAGE_STATUS,
    note: `${notePrefix}${noteFor(periodLabel, count, medianHours ?? 0, avgHours ?? 0)}`,
    last_refresh_utc: lastRefresh,
  };
  const rows = [
    {
      ...base,
      metric_name: MTTR_TICKETS_METRIC_NAME,
      metric_value: String(count),
      metric_unit: COUNT_UNIT,
    },
  ];
  if (medianHours !== null) {
    rows.push({
      ...base,
      metric_name: MTTR_METRIC_NAME,
      metric_value: String(round(medianHours)),
      metric_unit: MTTR_UNIT,
    });
  }
  if (avgHours !== null) {
    rows.push({
      ...base,
      metric_name: MTTR_AVG_METRIC_NAME,
      metric_value: String(round(avgHours)),
      metric_unit: MTTR_UNIT,
    });
  }
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const env = parseEnv(await fs.readFile(envPath, "utf8"));
  ensureRequiredEnv(env);

  const mapping = JSON.parse(await fs.readFile(mappingPath, "utf8"));
  const mttrConfig = mapping.mttr;
  if (!mttrConfig || !Array.isArray(mttrConfig.teams) || mttrConfig.teams.length === 0) {
    throw new Error("Missing mttr.teams configuration in jira-field-mapping.template.json.");
  }

  const now = new Date();
  const refreshTimestamp = toIsoDateTime(now);
  const severityFieldId = mapping.fields.severityFieldId;
  const teamFieldId = mapping.fields.teamFieldId;
  const severityCfNum = String(severityFieldId).replace(/^customfield_/, "");
  const portfolioTeamName = mttrConfig.portfolioTeamName ?? DEFAULT_PORTFOLIO;
  const severityLevels = new Set((mttrConfig.severityLevels ?? ["Level 1", "Level 2"]).map(normalizeName));
  const severityJqlValues = (mttrConfig.severityLevels ?? ["Level 1", "Level 2"])
    .map((level) => `"${level}"`)
    .join(", ");
  const projectKeys = mttrConfig.projectKeys ?? ["OV"];
  const issueTypes = mttrConfig.issueTypes ?? ["Bug", "Story", "Task"];
  const issueTypeJqlValues = issueTypes.map((type) => `"${type}"`).join(", ");
  const endStatus = mttrConfig.endStatus ?? "Closed";
  const fromYearArg = getArgValue(argv, "--from-year");
  const createdFrom = fromYearArg ? `${fromYearArg}-01-01` : mttrConfig.createdFrom ?? "2025-01-01";

  // Normalized Jira team name -> output team name.
  const teamLookup = new Map();
  for (const team of mttrConfig.teams) {
    teamLookup.set(normalizeName(team.jiraTeamName), team.outputTeamName);
  }

  const client = new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    token: env.JIRA_API_TOKEN,
  });

  const canonicalWindows = await loadCanonicalSprintWindows();

  // Fetch the in-scope OV issues (Sev 1/2, Bug/Story/Task) in one pass.
  const jql =
    `project in (${projectKeys.join(", ")}) AND issuetype in (${issueTypeJqlValues}) ` +
    `AND cf[${severityCfNum}] in (${severityJqlValues}) AND created >= "${createdFrom}" ORDER BY created ASC`;
  const issueFields = ["created", "status", "resolutiondate", teamFieldId, severityFieldId];
  const issues = await client.searchIssues(jql, issueFields);

  // Aggregators: Map<team, Map<period, { hours: [] }>>
  const quarterAgg = new Map();
  const sprintAgg = new Map();

  function bump(map, team, period, hours) {
    if (!map.has(team)) map.set(team, new Map());
    const periodMap = map.get(team);
    if (!periodMap.has(period)) periodMap.set(period, newBucket());
    const bucket = periodMap.get(period);
    bucket.hours.push(hours);
  }

  const endStatusNorm = normalizeName(endStatus);
  let inScopeIssues = 0;
  let countedTickets = 0;
  let fallbackToResolutionDate = 0;
  for (const issue of issues) {
    const outputTeam = teamLookup.get(normalizeName(teamFieldValue(issue.fields?.[teamFieldId])));
    if (!outputTeam) continue;

    const created = new Date(issue.fields?.created);
    if (Number.isNaN(created.getTime())) continue;

    const severity = normalizeName(fieldVal(issue.fields?.[severityFieldId]));
    if (!severityLevels.has(severity)) continue;

    inScopeIssues += 1;

    // Only issues that have reached the end status have a measurable end of clock.
    const status = normalizeName(fieldVal(issue.fields?.status));
    if (status !== endStatusNorm) continue;

    const changelog = await client.getIssueChangelog(issue.key);
    let endAt = lastTransitionInto(changelog, endStatus);
    if (!endAt) {
      // Already-Closed issue with no recorded transition: fall back to resolutiondate.
      const resDateRaw = issue.fields?.resolutiondate;
      const resDate = resDateRaw ? new Date(resDateRaw) : null;
      if (resDate && !Number.isNaN(resDate.getTime())) {
        endAt = resDate;
        fallbackToResolutionDate += 1;
      }
    }

    if (!endAt) continue;
    if (endAt <= created) continue;

    const hours = businessHoursBetween(created, endAt);
    countedTickets += 1;

    const quarterWindow = quarterWindowForDate(endAt);
    bump(quarterAgg, outputTeam, quarterWindow.label, hours);

    const sprint = findCanonicalSprint(canonicalWindows, quarterWindow.label, endAt);
    if (sprint) {
      bump(sprintAgg, outputTeam, sprint.key, hours);
    }
  }

  // --- derive quarter + YTD + EDU rows ---
  const rows = [];
  const ytdByYearTeam = new Map(); // key team::year -> { ...bucket, year }
  const quarterPortfolio = new Map(); // quarterLabel -> bucket
  const ytdByYearPortfolio = new Map(); // year -> bucket

  for (const [team, periodMap] of quarterAgg.entries()) {
    for (const [quarterLabel, bucket] of periodMap.entries()) {
      rows.push(...rowsFor(team, quarterLabel, bucket, refreshTimestamp));

      const year = Number(quarterLabel.slice(0, 4));
      const ytdKey = `${team}::${year}`;
      if (!ytdByYearTeam.has(ytdKey)) ytdByYearTeam.set(ytdKey, { ...newBucket(), year });
      addInto(ytdByYearTeam.get(ytdKey), bucket);

      if (!quarterPortfolio.has(quarterLabel)) quarterPortfolio.set(quarterLabel, newBucket());
      addInto(quarterPortfolio.get(quarterLabel), bucket);

      if (!ytdByYearPortfolio.has(year)) ytdByYearPortfolio.set(year, newBucket());
      addInto(ytdByYearPortfolio.get(year), bucket);
    }
  }

  for (const [key, agg] of ytdByYearTeam.entries()) {
    const team = key.split("::")[0];
    rows.push(...rowsFor(team, `${agg.year}-YTD`, agg, refreshTimestamp));
  }

  for (const [quarterLabel, agg] of quarterPortfolio.entries()) {
    rows.push(...rowsFor(portfolioTeamName, quarterLabel, agg, refreshTimestamp, "Portfolio rollup. "));
  }

  for (const [year, agg] of ytdByYearPortfolio.entries()) {
    rows.push(...rowsFor(portfolioTeamName, `${year}-YTD`, agg, refreshTimestamp, "Portfolio rollup. "));
  }

  // Sprint rows per team, plus the EDU portfolio rollup (true pooled samples per sprint, so the
  // EDU median is a real median of all teams' tickets -- not an average of team medians).
  const sprintPortfolio = new Map(); // sprintKey -> bucket
  for (const [team, periodMap] of sprintAgg.entries()) {
    for (const [sprintKey, bucket] of periodMap.entries()) {
      rows.push(...rowsFor(team, sprintKey, bucket, refreshTimestamp));

      if (!sprintPortfolio.has(sprintKey)) sprintPortfolio.set(sprintKey, newBucket());
      addInto(sprintPortfolio.get(sprintKey), bucket);
    }
  }

  for (const [sprintKey, agg] of sprintPortfolio.entries()) {
    rows.push(...rowsFor(portfolioTeamName, sprintKey, agg, refreshTimestamp, "Portfolio rollup. "));
  }

  const finalRows = sortByKeys(rows, ["team_name", "quarter_label", "metric_name"]);
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.writeFile(exportPath, toCsv(exportHeaders, finalRows), "utf8");

  console.log(
    JSON.stringify(
      {
        projectKeys,
        issueTypes,
        teams: mttrConfig.teams.map((t) => `${t.jiraTeamName} -> ${t.outputTeamName}`),
        createdFrom,
        endStatus,
        issuesFetched: issues.length,
        inScopeIssues,
        countedTickets,
        fallbackToResolutionDate,
        exportRows: finalRows.length,
        output: exportPath,
        refreshedAt: refreshTimestamp,
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

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const mappingPath = path.join(repoRoot, "backend/jira/config/jira-field-mapping.template.json");
const generatedDir = path.join(repoRoot, "backend/jira/generated");

const exportPath = path.join(generatedDir, "defect_leakage_export.csv");
const countsPath = path.join(generatedDir, "defect_leakage_counts.csv");
const combinedCalendarPath = path.join(generatedDir, "sprint_calendar_combined.csv");

const METRIC_NAME = "Defect Leakage %";
const METRIC_UNIT = "percent";
const SEV1_METRIC_NAME = "Sev 1 Bugs";
const SEV2_METRIC_NAME = "Sev 2 Bugs";
const SEV_HIGH_METRIC_NAME = "Sev 1 + Sev 2 Bugs";
const COUNT_UNIT = "count";
const SOURCE_SYSTEM = "Jira";
const COVERAGE_STATUS = "Yes (partial)";
const DEFAULT_PORTFOLIO = "EDU";

// Severity-count metric names share the defect leakage export. Used when deciding which prior rows
// to drop on incremental/quarter-scoped runs.
const SEV_COUNT_METRIC_NAMES = new Set([SEV1_METRIC_NAME, SEV2_METRIC_NAME, SEV_HIGH_METRIC_NAME]);
const ALL_METRIC_NAMES = new Set([METRIC_NAME, ...SEV_COUNT_METRIC_NAMES]);

const sprintPeriodPattern = /^\d{4}-Q[1-4]-S\d+$/;

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

const countsHeaders = [
  "team_name",
  "quarter_label",
  "sev_high",
  "sev1",
  "sev2",
  "total_bugs",
  "reopened_distinct",
  "last_refresh_utc",
];

// --- generic helpers (kept self-contained so this script can run in isolation) ---

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

function quarterWindowsForYearRange(fromYear, now) {
  const currentQuarter = quarterWindowForDate(now);
  const windows = [];
  for (let year = fromYear; year <= currentQuarter.year; year += 1) {
    const lastQuarter = year === currentQuarter.year ? currentQuarter.quarter : 4;
    for (let quarter = 1; quarter <= lastQuarter; quarter += 1) {
      windows.push(quarterWindowFromLabel(`${year}-Q${quarter}`));
    }
  }
  return windows;
}

function resolveTargetQuarterWindows(argv, now) {
  const targetQuarter = getArgValue(argv, "--quarter");
  const fromYearArg = getArgValue(argv, "--from-year");
  const isFull = argv.includes("--full");

  if (targetQuarter && fromYearArg) {
    throw new Error('Use either "--quarter YYYY-Q#" or "--from-year YYYY", not both in the same run.');
  }

  if (targetQuarter) {
    return [quarterWindowFromLabel(targetQuarter)];
  }

  if (isFull || fromYearArg) {
    const currentYear = now.getUTCFullYear();
    const fromYear = fromYearArg ? Number(fromYearArg) : currentYear - 1;
    if (fromYearArg && (!/^\d{4}$/.test(fromYearArg) || Number.isNaN(fromYear))) {
      throw new Error(`Invalid year format "${fromYearArg}". Expected YYYY.`);
    }
    if (fromYear > currentYear) {
      throw new Error(`Invalid --from-year "${fromYearArg}". It cannot be later than the current year ${currentYear}.`);
    }
    return quarterWindowsForYearRange(fromYear, now);
  }

  return [quarterWindowForDate(now)];
}

function parentQuarterOfSprintKey(sprintKey) {
  const match = /^(\d{4}-Q[1-4])-S\d+$/.exec(String(sprintKey ?? "").trim());
  return match ? match[1] : "";
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

  async getFields() {
    return this.requestJson("/rest/api/3/field");
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

// --- domain logic ---

async function resolveSeverityFieldId(client, mapping) {
  const configured = mapping.fields?.severityFieldId;
  if (configured) {
    return configured;
  }
  const fields = await client.getFields();
  const match = fields.find((field) => normalizeName(field.name) === "severity");
  if (!match) {
    throw new Error('Could not find a Jira field named "Severity". Set fields.severityFieldId in the mapping.');
  }
  return match.id;
}

// Team Connexpoint (CXP) is the single official sprint calendar. The periods are defined strictly
// by CXP's sprints; every team's bugs are bucketed into those windows by created date. This
// matches the frontend's getSprintsForQuarter. Sprint 0 is intentionally excluded.
const OFFICIAL_CALENDAR_TEAM = "Team Connexpoint";
const EXCLUDED_SPRINT_SEQUENCES = new Set([0]);

async function loadCanonicalSprintWindows() {
  const rows = await readCsvFile(combinedCalendarPath);
  const byKey = new Map(); // sprint_key -> { key, sequence, quarter, start, end }

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
    // Same key appearing more than once (mislabeled sprints in Jira): merge into one window
    // spanning the earliest start to the latest end so no created date in the period is dropped.
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

function severityValue(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    return raw.value ?? raw.name ?? "";
  }
  return String(raw);
}

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

function ratioPct(sevHigh, totalBugs, reopenedDistinct) {
  const denominator = totalBugs + reopenedDistinct;
  if (denominator <= 0) {
    return null;
  }
  return (sevHigh / denominator) * 100;
}

function noteFor(period, sevHigh, totalBugs, reopenedDistinct) {
  return `${period}: ${sevHigh} sev L1+L2 / (${totalBugs} bugs + ${reopenedDistinct} reopened).`;
}

function noteForCounts(period, sev1, sev2) {
  return `${period}: ${sev1} Sev 1 + ${sev2} Sev 2 bug(s).`;
}

// Emit the three severity-count metric rows (Sev 1, Sev 2, and the combined) for one team/period.
function countRowsFor(team, periodLabel, sev1, sev2, lastRefresh, notePrefix = "") {
  const base = {
    team_name: team,
    quarter_label: periodLabel,
    metric_unit: COUNT_UNIT,
    source_system: SOURCE_SYSTEM,
    coverage_status: COVERAGE_STATUS,
    note: `${notePrefix}${noteForCounts(periodLabel, sev1, sev2)}`,
    last_refresh_utc: lastRefresh,
  };
  return [
    { ...base, metric_name: SEV1_METRIC_NAME, metric_value: String(sev1) },
    { ...base, metric_name: SEV2_METRIC_NAME, metric_value: String(sev2) },
    { ...base, metric_name: SEV_HIGH_METRIC_NAME, metric_value: String(sev1 + sev2) },
  ];
}

async function main() {
  const argv = process.argv.slice(2);
  const env = parseEnv(await fs.readFile(envPath, "utf8"));
  ensureRequiredEnv(env);

  const mapping = JSON.parse(await fs.readFile(mappingPath, "utf8"));
  const leakageConfig = mapping.defectLeakage;
  if (!leakageConfig || !Array.isArray(leakageConfig.teams) || leakageConfig.teams.length === 0) {
    throw new Error("Missing defectLeakage.teams configuration in jira-field-mapping.template.json.");
  }

  const now = new Date();
  const refreshTimestamp = toIsoDateTime(now);
  const teamFieldId = mapping.fields.teamFieldId;
  const projectKeys = leakageConfig.projectKeys ?? ["OV"];
  const issueType = leakageConfig.issueType ?? "Bug";
  const portfolioTeamName = leakageConfig.portfolioTeamName ?? DEFAULT_PORTFOLIO;
  const numeratorLevelList = leakageConfig.severityNumeratorLevels ?? ["Level 1", "Level 2"];
  const sev1Level = normalizeName(numeratorLevelList[0]);
  const sev2Level = normalizeName(numeratorLevelList[1]);
  const reopenedStatusNames = new Set(
    (leakageConfig.reopenedStatusNames ?? ["Reopened"]).map((name) => normalizeName(name)),
  );

  const quarterWindows = resolveTargetQuarterWindows(argv, now);
  const processedQuarterLabels = new Set(quarterWindows.map((window) => window.label));
  const rangeStart = quarterWindows.reduce(
    (min, window) => (window.start < min ? window.start : min),
    quarterWindows[0].start,
  );

  const teamArg = getArgValue(argv, "--team");
  const teams = teamArg
    ? leakageConfig.teams.filter(
        (team) =>
          normalizeName(team.jiraTeamName) === normalizeName(teamArg) ||
          normalizeName(team.outputTeamName) === normalizeName(teamArg),
      )
    : leakageConfig.teams;

  if (teams.length === 0) {
    throw new Error(`No defect-leakage team matching "${teamArg}".`);
  }

  const client = new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    token: env.JIRA_API_TOKEN,
  });

  const severityFieldId = await resolveSeverityFieldId(client, mapping);

  const jiraTeamLookup = new Map();
  for (const team of teams) {
    jiraTeamLookup.set(normalizeName(team.jiraTeamName), team);
  }

  // Fetch every in-scope bug once, group by team.
  const projectClause = `project in (${projectKeys.join(", ")})`;
  const jql = `${projectClause} AND issuetype = "${issueType}" AND created >= "${toIsoDate(rangeStart)}" ORDER BY created ASC`;
  const fields = ["created", "status", "issuetype", teamFieldId, severityFieldId];
  const issues = await client.searchIssues(jql, fields);

  const canonicalWindows = await loadCanonicalSprintWindows();

  // Aggregators.
  // quarterCounts: Map<outputTeam, Map<quarterLabel, { sevHigh, total, reopened }>>
  const quarterCounts = new Map();
  // sprintCounts: Map<outputTeam, Map<sprintKey, { sevHigh, total, reopened }>>
  const sprintCounts = new Map();

  function bump(map, team, period, isSev1, isSev2, isReopened) {
    if (!map.has(team)) map.set(team, new Map());
    const periodMap = map.get(team);
    if (!periodMap.has(period)) periodMap.set(period, { sevHigh: 0, sev1: 0, sev2: 0, total: 0, reopened: 0 });
    const bucket = periodMap.get(period);
    bucket.total += 1;
    if (isSev1) {
      bucket.sev1 += 1;
      bucket.sevHigh += 1;
    }
    if (isSev2) {
      bucket.sev2 += 1;
      bucket.sevHigh += 1;
    }
    if (isReopened) bucket.reopened += 1;
  }

  // Group bugs by team and detect reopens via changelog.
  let scopedBugCount = 0;
  for (const issue of issues) {
    const rawTeam = teamFieldValue(issue.fields?.[teamFieldId]);
    const team = jiraTeamLookup.get(normalizeName(rawTeam));
    if (!team) continue;

    const created = new Date(issue.fields?.created);
    if (Number.isNaN(created.getTime())) continue;

    const quarterWindow = quarterWindowForDate(created);
    if (!processedQuarterLabels.has(quarterWindow.label)) continue;

    scopedBugCount += 1;

    const severity = normalizeName(severityValue(issue.fields?.[severityFieldId]));
    const isSev1 = severity === sev1Level;
    const isSev2 = severity === sev2Level;

    // Reopen detection: any status transition into a configured reopened status.
    let isReopened = false;
    const changelog = await client.getIssueChangelog(issue.key);
    for (const entry of changelog) {
      for (const item of entry.items ?? []) {
        if (item.field === "status" && reopenedStatusNames.has(normalizeName(item.toString))) {
          isReopened = true;
          break;
        }
      }
      if (isReopened) break;
    }

    const outputTeam = team.outputTeamName;
    bump(quarterCounts, outputTeam, quarterWindow.label, isSev1, isSev2, isReopened);

    const sprint = findCanonicalSprint(canonicalWindows, quarterWindow.label, created);
    if (sprint) {
      bump(sprintCounts, outputTeam, sprint.key, isSev1, isSev2, isReopened);
    }
  }

  // --- update the counts ledger (quarter grain, full history source of truth) ---
  const existingCounts = await readCsvFile(countsPath);
  const processedOutputTeams = new Set(teams.map((team) => normalizeName(team.outputTeamName)));
  // Drop the rows we are about to recompute: processed quarters (and, when team-scoped, only the
  // processed teams). Everything else is preserved so prior history survives incremental runs.
  const retainedCounts = existingCounts.filter((row) => {
    if (!processedQuarterLabels.has(row.quarter_label)) return true;
    if (teamArg) return !processedOutputTeams.has(normalizeName(row.team_name));
    return false;
  });

  const freshCountRows = [];
  for (const [team, periodMap] of quarterCounts.entries()) {
    for (const [quarterLabel, bucket] of periodMap.entries()) {
      freshCountRows.push({
        team_name: team,
        quarter_label: quarterLabel,
        sev_high: String(bucket.sevHigh),
        sev1: String(bucket.sev1),
        sev2: String(bucket.sev2),
        total_bugs: String(bucket.total),
        reopened_distinct: String(bucket.reopened),
        last_refresh_utc: refreshTimestamp,
      });
    }
  }

  const mergedCounts = sortByKeys([...retainedCounts, ...freshCountRows], ["team_name", "quarter_label"]);
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.writeFile(countsPath, toCsv(countsHeaders, mergedCounts), "utf8");

  // --- derive quarter + YTD + EDU export rows from the full counts ledger ---
  // ledger: Map<team, Map<quarter, { sevHigh, total, reopened, lastRefresh }>>
  const ledger = new Map();
  for (const row of mergedCounts) {
    if (!ledger.has(row.team_name)) ledger.set(row.team_name, new Map());
    ledger.get(row.team_name).set(row.quarter_label, {
      sevHigh: Number(row.sev_high) || 0,
      sev1: Number(row.sev1) || 0,
      sev2: Number(row.sev2) || 0,
      total: Number(row.total_bugs) || 0,
      reopened: Number(row.reopened_distinct) || 0,
      lastRefresh: row.last_refresh_utc || refreshTimestamp,
    });
  }

  const quarterAndYtdRows = [];
  const ytdByYearTeam = new Map(); // key team::year -> aggregate
  const ytdByYearPortfolio = new Map(); // year -> aggregate (EDU)
  const quarterPortfolio = new Map(); // quarterLabel -> aggregate (EDU)

  for (const [team, periodMap] of ledger.entries()) {
    for (const [quarterLabel, bucket] of periodMap.entries()) {
      const value = ratioPct(bucket.sevHigh, bucket.total, bucket.reopened);
      if (value !== null) {
        quarterAndYtdRows.push({
          team_name: team,
          quarter_label: quarterLabel,
          metric_name: METRIC_NAME,
          metric_value: String(round(value)),
          metric_unit: METRIC_UNIT,
          source_system: SOURCE_SYSTEM,
          coverage_status: COVERAGE_STATUS,
          note: noteFor(quarterLabel, bucket.sevHigh, bucket.total, bucket.reopened),
          last_refresh_utc: bucket.lastRefresh,
        });
      }

      // Severity counts are emitted for every quarter present in the ledger (0 is meaningful).
      quarterAndYtdRows.push(
        ...countRowsFor(team, quarterLabel, bucket.sev1, bucket.sev2, bucket.lastRefresh),
      );

      const year = Number(quarterLabel.slice(0, 4));
      const ytdKey = `${team}::${year}`;
      if (!ytdByYearTeam.has(ytdKey)) ytdByYearTeam.set(ytdKey, { sevHigh: 0, sev1: 0, sev2: 0, total: 0, reopened: 0, year });
      const ytdAgg = ytdByYearTeam.get(ytdKey);
      ytdAgg.sevHigh += bucket.sevHigh;
      ytdAgg.sev1 += bucket.sev1;
      ytdAgg.sev2 += bucket.sev2;
      ytdAgg.total += bucket.total;
      ytdAgg.reopened += bucket.reopened;

      if (!quarterPortfolio.has(quarterLabel)) {
        quarterPortfolio.set(quarterLabel, { sevHigh: 0, sev1: 0, sev2: 0, total: 0, reopened: 0 });
      }
      const portfolioQuarter = quarterPortfolio.get(quarterLabel);
      portfolioQuarter.sevHigh += bucket.sevHigh;
      portfolioQuarter.sev1 += bucket.sev1;
      portfolioQuarter.sev2 += bucket.sev2;
      portfolioQuarter.total += bucket.total;
      portfolioQuarter.reopened += bucket.reopened;

      if (!ytdByYearPortfolio.has(year)) ytdByYearPortfolio.set(year, { sevHigh: 0, sev1: 0, sev2: 0, total: 0, reopened: 0 });
      const portfolioYtd = ytdByYearPortfolio.get(year);
      portfolioYtd.sevHigh += bucket.sevHigh;
      portfolioYtd.sev1 += bucket.sev1;
      portfolioYtd.sev2 += bucket.sev2;
      portfolioYtd.total += bucket.total;
      portfolioYtd.reopened += bucket.reopened;
    }
  }

  for (const [key, agg] of ytdByYearTeam.entries()) {
    const team = key.split("::")[0];
    const ytdLabel = `${agg.year}-YTD`;
    const value = ratioPct(agg.sevHigh, agg.total, agg.reopened);
    if (value !== null) {
      quarterAndYtdRows.push({
        team_name: team,
        quarter_label: ytdLabel,
        metric_name: METRIC_NAME,
        metric_value: String(round(value)),
        metric_unit: METRIC_UNIT,
        source_system: SOURCE_SYSTEM,
        coverage_status: COVERAGE_STATUS,
        note: noteFor(ytdLabel, agg.sevHigh, agg.total, agg.reopened),
        last_refresh_utc: refreshTimestamp,
      });
    }
    quarterAndYtdRows.push(...countRowsFor(team, ytdLabel, agg.sev1, agg.sev2, refreshTimestamp));
  }

  for (const [quarterLabel, agg] of quarterPortfolio.entries()) {
    const value = ratioPct(agg.sevHigh, agg.total, agg.reopened);
    if (value !== null) {
      quarterAndYtdRows.push({
        team_name: portfolioTeamName,
        quarter_label: quarterLabel,
        metric_name: METRIC_NAME,
        metric_value: String(round(value)),
        metric_unit: METRIC_UNIT,
        source_system: SOURCE_SYSTEM,
        coverage_status: COVERAGE_STATUS,
        note: `Portfolio rollup. ${noteFor(quarterLabel, agg.sevHigh, agg.total, agg.reopened)}`,
        last_refresh_utc: refreshTimestamp,
      });
    }
    quarterAndYtdRows.push(
      ...countRowsFor(portfolioTeamName, quarterLabel, agg.sev1, agg.sev2, refreshTimestamp, "Portfolio rollup. "),
    );
  }

  for (const [year, agg] of ytdByYearPortfolio.entries()) {
    const ytdLabel = `${year}-YTD`;
    const value = ratioPct(agg.sevHigh, agg.total, agg.reopened);
    if (value !== null) {
      quarterAndYtdRows.push({
        team_name: portfolioTeamName,
        quarter_label: ytdLabel,
        metric_name: METRIC_NAME,
        metric_value: String(round(value)),
        metric_unit: METRIC_UNIT,
        source_system: SOURCE_SYSTEM,
        coverage_status: COVERAGE_STATUS,
        note: `Portfolio rollup. ${noteFor(ytdLabel, agg.sevHigh, agg.total, agg.reopened)}`,
        last_refresh_utc: refreshTimestamp,
      });
    }
    quarterAndYtdRows.push(
      ...countRowsFor(portfolioTeamName, ytdLabel, agg.sev1, agg.sev2, refreshTimestamp, "Portfolio rollup. "),
    );
  }

  // --- sprint-level rows: recomputed for processed quarters, others preserved ---
  const freshSprintRows = [];
  for (const [team, periodMap] of sprintCounts.entries()) {
    for (const [sprintKey, bucket] of periodMap.entries()) {
      const value = ratioPct(bucket.sevHigh, bucket.total, bucket.reopened);
      if (value !== null) {
        freshSprintRows.push({
          team_name: team,
          quarter_label: sprintKey,
          metric_name: METRIC_NAME,
          metric_value: String(round(value)),
          metric_unit: METRIC_UNIT,
          source_system: SOURCE_SYSTEM,
          coverage_status: COVERAGE_STATUS,
          note: noteFor(sprintKey, bucket.sevHigh, bucket.total, bucket.reopened),
          last_refresh_utc: refreshTimestamp,
        });
      }
      freshSprintRows.push(
        ...countRowsFor(team, sprintKey, bucket.sev1, bucket.sev2, refreshTimestamp),
      );
    }
  }

  const existingExport = await readCsvFile(exportPath);
  const keptSprintRows = existingExport.filter((row) => {
    if (!sprintPeriodPattern.test(row.quarter_label)) return false; // quarter/YTD regenerated below
    const parent = parentQuarterOfSprintKey(row.quarter_label);
    if (processedQuarterLabels.has(parent)) {
      // For team-scoped runs, only drop sprint rows for the processed teams.
      if (teamArg) {
        return !processedOutputTeams.has(normalizeName(row.team_name));
      }
      return false;
    }
    return true;
  });

  // When team-scoped, also keep quarter/YTD rows of non-processed teams (we regenerate from a full
  // ledger that already contains every team, so this is only relevant if --team excludes some).
  const keptNonSprintRows = teamArg
    ? existingExport.filter(
        (row) =>
          !sprintPeriodPattern.test(row.quarter_label) &&
          ALL_METRIC_NAMES.has(row.metric_name) &&
          !processedOutputTeams.has(normalizeName(row.team_name)) &&
          normalizeName(row.team_name) !== normalizeName(portfolioTeamName),
      )
    : [];

  const finalExport = sortByKeys(
    [...quarterAndYtdRows, ...keptNonSprintRows, ...keptSprintRows, ...freshSprintRows],
    ["team_name", "quarter_label", "metric_name"],
  );
  await fs.writeFile(exportPath, toCsv(exportHeaders, finalExport), "utf8");

  console.log(
    JSON.stringify(
      {
        severityFieldId,
        quartersProcessed: [...processedQuarterLabels],
        bugsFetched: issues.length,
        bugsInScope: scopedBugCount,
        teams: teams.map((team) => `${team.jiraTeamName} -> ${team.outputTeamName}`),
        exportRows: finalExport.length,
        sprintRowsWritten: freshSprintRows.length,
        outputs: { exportPath, countsPath },
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

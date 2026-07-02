import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const mappingPath = path.join(repoRoot, "backend/jira/config/jira-field-mapping.template.json");
const generatedDir = path.join(repoRoot, "backend/jira/generated");

const exportPath = path.join(generatedDir, "work_type_mix_export.csv");
const ledgerPath = path.join(generatedDir, "work_type_mix_hours.csv");
const combinedCalendarPath = path.join(generatedDir, "sprint_calendar_combined.csv");

// Maintain / Run / Growth mix: share of logged worklog hours per Work Type category, for the
// team/period. Population = every OV issue (any issue type) with at least one worklog entry whose
// `started` date falls in the period. Each worklog's own date drives its bucket -- NOT the issue's
// created date -- because a single ticket can accrue hours across many sprints.
// % = category hours / (Maintain + Run + Growth hours) for the whole period, computed once from
// the period's total. Never averaged from smaller buckets (weeks/sprints) or across teams: that is
// what biased the old manual weekly-Excel-pivot process this replaces.
const MAINTAIN_METRIC_NAME = "Maintain %";
const RUN_METRIC_NAME = "Run %";
const GROWTH_METRIC_NAME = "Growth %";
const METRIC_UNIT = "percent";
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

// Quarter-grain ledger: full-history source of truth for logged hours by category, merged
// incrementally across runs (same role as defect_leakage_counts.csv for that metric).
const ledgerHeaders = [
  "team_name",
  "quarter_label",
  "maintain_hours",
  "run_hours",
  "growth_hours",
  "unmapped_hours",
  "last_refresh_utc",
];

const sprintPeriodPattern = /^\d{4}-Q[1-4]-S\d+$/;

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

// --- Jira client (subset of the quarterly pull client, plus worklog pagination) ---

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

  // The search endpoint embeds up to 20 worklogs per issue. When an issue has more, page through
  // the dedicated worklog endpoint instead of trusting the embedded (truncated) list.
  async getIssueWorklogs(issueKey) {
    const entries = [];
    let startAt = 0;
    let total = Infinity;
    while (startAt < total) {
      const payload = await this.requestJson(`/rest/api/3/issue/${issueKey}/worklog`, {
        startAt,
        maxResults: 100,
      });
      entries.push(...(payload.worklogs ?? []));
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

async function resolveWorkTypeFieldId(client, mapping) {
  const configured = mapping.fields?.workTypeFieldId;
  if (configured) {
    return configured;
  }
  const fields = await client.getFields();
  const match = fields.find((field) => normalizeName(field.name) === "work type");
  if (!match) {
    throw new Error('Could not find a Jira field named "Work Type". Set fields.workTypeFieldId in the mapping.');
  }
  return match.id;
}

// Team Connexpoint (CXP) is the single official sprint calendar. The periods are defined strictly
// by CXP's sprints; every team's hours are bucketed into those windows by worklog date. This
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
    // spanning the earliest start to the latest end so no worklog date in the period is dropped.
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

// The Jira Team / Work Type fields are single-select customfields: string, object, or a
// single-element array of objects, depending on how they were requested/rendered.
function selectFieldValue(raw) {
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

function buildCategoryLookup(categories) {
  const lookup = new Map();
  for (const [category, values] of Object.entries(categories)) {
    for (const value of values) {
      lookup.set(normalizeName(value), category);
    }
  }
  return lookup;
}

function newBucket() {
  return { maintain: 0, run: 0, growth: 0, unmapped: 0 };
}

function addInto(target, src) {
  target.maintain += src.maintain;
  target.run += src.run;
  target.growth += src.growth;
  target.unmapped += src.unmapped;
}

function bumpCategory(bucket, category, hours) {
  if (category === "Maintain") bucket.maintain += hours;
  else if (category === "Run") bucket.run += hours;
  else if (category === "Growth") bucket.growth += hours;
  else bucket.unmapped += hours;
}

// Emit the Maintain/Run/Growth % rows for one team/period from its hours bucket. Percent is
// computed once from the period's total categorized hours -- never averaged from smaller buckets.
function rowsFor(team, periodLabel, bucket, lastRefresh, notePrefix = "") {
  const total = bucket.maintain + bucket.run + bucket.growth;
  if (total <= 0) return [];

  const pct = (hours) => round((hours / total) * 100);
  const unmappedNote = bucket.unmapped > 0 ? ` (${round(bucket.unmapped)}h with an unmapped Work Type excluded)` : "";
  const note = `${notePrefix}${periodLabel}: ${round(total)}h logged \u2014 M ${round(bucket.maintain)}h / R ${round(bucket.run)}h / G ${round(bucket.growth)}h${unmappedNote}.`;

  const base = {
    team_name: team,
    quarter_label: periodLabel,
    metric_unit: METRIC_UNIT,
    source_system: SOURCE_SYSTEM,
    coverage_status: COVERAGE_STATUS,
    note,
    last_refresh_utc: lastRefresh,
  };

  return [
    { ...base, metric_name: MAINTAIN_METRIC_NAME, metric_value: String(pct(bucket.maintain)) },
    { ...base, metric_name: RUN_METRIC_NAME, metric_value: String(pct(bucket.run)) },
    { ...base, metric_name: GROWTH_METRIC_NAME, metric_value: String(pct(bucket.growth)) },
  ];
}

async function main() {
  const argv = process.argv.slice(2);
  const env = parseEnv(await fs.readFile(envPath, "utf8"));
  ensureRequiredEnv(env);

  const mapping = JSON.parse(await fs.readFile(mappingPath, "utf8"));
  const mixConfig = mapping.workTypeMix;
  if (!mixConfig || !Array.isArray(mixConfig.teams) || mixConfig.teams.length === 0) {
    throw new Error("Missing workTypeMix.teams configuration in jira-field-mapping.template.json.");
  }
  if (!mixConfig.categories) {
    throw new Error("Missing workTypeMix.categories configuration in jira-field-mapping.template.json.");
  }

  const now = new Date();
  const refreshTimestamp = toIsoDateTime(now);
  const teamFieldId = mapping.fields.teamFieldId;
  const projectKeys = mixConfig.projectKeys ?? ["OV"];
  const portfolioTeamName = mixConfig.portfolioTeamName ?? DEFAULT_PORTFOLIO;
  const categoryLookup = buildCategoryLookup(mixConfig.categories);

  const quarterWindows = resolveTargetQuarterWindows(argv, now);
  const processedQuarterLabels = new Set(quarterWindows.map((window) => window.label));
  const rangeStart = quarterWindows.reduce(
    (min, window) => (window.start < min ? window.start : min),
    quarterWindows[0].start,
  );

  const teamArg = getArgValue(argv, "--team");
  const teams = teamArg
    ? mixConfig.teams.filter(
        (team) =>
          normalizeName(team.jiraTeamName) === normalizeName(teamArg) ||
          normalizeName(team.outputTeamName) === normalizeName(teamArg),
      )
    : mixConfig.teams;

  if (teams.length === 0) {
    throw new Error(`No workTypeMix team matching "${teamArg}".`);
  }

  const client = new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    token: env.JIRA_API_TOKEN,
  });

  const workTypeFieldId = await resolveWorkTypeFieldId(client, mapping);

  const jiraTeamLookup = new Map();
  for (const team of teams) {
    jiraTeamLookup.set(normalizeName(team.jiraTeamName), team);
  }

  // Fetch every OV issue (any issue type) that has at least one worklog entry in scope, once.
  // Individual worklog entries are re-checked against their own `started` date below, since an
  // issue can have worklogs both inside and outside the fetched range.
  const projectClause = `project in (${projectKeys.join(", ")})`;
  const jql = `${projectClause} AND worklogDate >= "${toIsoDate(rangeStart)}" ORDER BY key ASC`;
  const fields = [teamFieldId, workTypeFieldId, "worklog"];
  const issues = await client.searchIssues(jql, fields);

  const canonicalWindows = await loadCanonicalSprintWindows();

  // Aggregators.
  // quarterHours: Map<outputTeam, Map<quarterLabel, bucket>>
  const quarterHours = new Map();
  // sprintHours: Map<outputTeam, Map<sprintKey, bucket>>
  const sprintHours = new Map();

  function bump(map, team, period, category, hours) {
    if (!map.has(team)) map.set(team, new Map());
    const periodMap = map.get(team);
    if (!periodMap.has(period)) periodMap.set(period, newBucket());
    bumpCategory(periodMap.get(period), category, hours);
  }

  let issuesInScope = 0;
  let worklogEntriesCounted = 0;
  let worklogEntriesSkippedOutOfRange = 0;
  let issuesRepaged = 0;

  for (const issue of issues) {
    const rawTeam = selectFieldValue(issue.fields?.[teamFieldId]);
    const team = jiraTeamLookup.get(normalizeName(rawTeam));
    if (!team) continue;

    const rawWorkType = selectFieldValue(issue.fields?.[workTypeFieldId]);
    const category = categoryLookup.get(normalizeName(rawWorkType)) ?? null;

    const embeddedWorklog = issue.fields?.worklog;
    let entries = embeddedWorklog?.worklogs ?? [];
    if ((embeddedWorklog?.total ?? entries.length) > entries.length) {
      entries = await client.getIssueWorklogs(issue.key);
      issuesRepaged += 1;
    }
    if (entries.length === 0) continue;

    issuesInScope += 1;
    const outputTeam = team.outputTeamName;

    for (const entry of entries) {
      const started = new Date(entry.started);
      if (Number.isNaN(started.getTime())) continue;

      const quarterWindow = quarterWindowForDate(started);
      if (!processedQuarterLabels.has(quarterWindow.label)) {
        worklogEntriesSkippedOutOfRange += 1;
        continue;
      }

      const hours = (entry.timeSpentSeconds ?? 0) / 3600;
      if (hours <= 0) continue;

      worklogEntriesCounted += 1;
      bump(quarterHours, outputTeam, quarterWindow.label, category, hours);

      const sprint = findCanonicalSprint(canonicalWindows, quarterWindow.label, started);
      if (sprint) {
        bump(sprintHours, outputTeam, sprint.key, category, hours);
      }
    }
  }

  // --- update the hours ledger (quarter grain, full history source of truth) ---
  const existingLedger = await readCsvFile(ledgerPath);
  const processedOutputTeams = new Set(teams.map((team) => normalizeName(team.outputTeamName)));
  const retainedLedger = existingLedger.filter((row) => {
    if (!processedQuarterLabels.has(row.quarter_label)) return true;
    if (teamArg) return !processedOutputTeams.has(normalizeName(row.team_name));
    return false;
  });

  const freshLedgerRows = [];
  for (const [team, periodMap] of quarterHours.entries()) {
    for (const [quarterLabel, bucket] of periodMap.entries()) {
      freshLedgerRows.push({
        team_name: team,
        quarter_label: quarterLabel,
        maintain_hours: String(bucket.maintain),
        run_hours: String(bucket.run),
        growth_hours: String(bucket.growth),
        unmapped_hours: String(bucket.unmapped),
        last_refresh_utc: refreshTimestamp,
      });
    }
  }

  const mergedLedger = sortByKeys([...retainedLedger, ...freshLedgerRows], ["team_name", "quarter_label"]);
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.writeFile(ledgerPath, toCsv(ledgerHeaders, mergedLedger), "utf8");

  // --- derive quarter + YTD + EDU export rows from the full ledger ---
  const ledger = new Map(); // team -> quarter -> bucket
  for (const row of mergedLedger) {
    if (!ledger.has(row.team_name)) ledger.set(row.team_name, new Map());
    ledger.get(row.team_name).set(row.quarter_label, {
      maintain: Number(row.maintain_hours) || 0,
      run: Number(row.run_hours) || 0,
      growth: Number(row.growth_hours) || 0,
      unmapped: Number(row.unmapped_hours) || 0,
      lastRefresh: row.last_refresh_utc || refreshTimestamp,
    });
  }

  const quarterAndYtdRows = [];
  const ytdByYearTeam = new Map(); // team::year -> aggregate
  const ytdByYearPortfolio = new Map(); // year -> aggregate (EDU)
  const quarterPortfolio = new Map(); // quarterLabel -> aggregate (EDU)

  for (const [team, periodMap] of ledger.entries()) {
    for (const [quarterLabel, bucket] of periodMap.entries()) {
      quarterAndYtdRows.push(...rowsFor(team, quarterLabel, bucket, bucket.lastRefresh));

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
    quarterAndYtdRows.push(...rowsFor(team, `${agg.year}-YTD`, agg, refreshTimestamp));
  }

  for (const [quarterLabel, agg] of quarterPortfolio.entries()) {
    quarterAndYtdRows.push(
      ...rowsFor(portfolioTeamName, quarterLabel, agg, refreshTimestamp, "Portfolio rollup. "),
    );
  }

  for (const [year, agg] of ytdByYearPortfolio.entries()) {
    quarterAndYtdRows.push(
      ...rowsFor(portfolioTeamName, `${year}-YTD`, agg, refreshTimestamp, "Portfolio rollup. "),
    );
  }

  // --- sprint-level rows: recomputed for processed quarters, others preserved ---
  const freshSprintRows = [];
  const sprintPortfolio = new Map(); // sprintKey -> bucket
  for (const [team, periodMap] of sprintHours.entries()) {
    for (const [sprintKey, bucket] of periodMap.entries()) {
      freshSprintRows.push(...rowsFor(team, sprintKey, bucket, refreshTimestamp));

      if (!sprintPortfolio.has(sprintKey)) sprintPortfolio.set(sprintKey, newBucket());
      addInto(sprintPortfolio.get(sprintKey), bucket);
    }
  }
  for (const [sprintKey, agg] of sprintPortfolio.entries()) {
    freshSprintRows.push(...rowsFor(portfolioTeamName, sprintKey, agg, refreshTimestamp, "Portfolio rollup. "));
  }

  const existingExport = await readCsvFile(exportPath);
  const keptSprintRows = existingExport.filter((row) => {
    if (!sprintPeriodPattern.test(row.quarter_label)) return false; // quarter/YTD regenerated below
    const parent = parentQuarterOfSprintKey(row.quarter_label);
    if (processedQuarterLabels.has(parent)) {
      if (teamArg) {
        return !processedOutputTeams.has(normalizeName(row.team_name));
      }
      return false;
    }
    return true;
  });

  const finalExport = sortByKeys(
    [...quarterAndYtdRows, ...keptSprintRows, ...freshSprintRows],
    ["team_name", "quarter_label", "metric_name"],
  );
  await fs.writeFile(exportPath, toCsv(exportHeaders, finalExport), "utf8");

  console.log(
    JSON.stringify(
      {
        workTypeFieldId,
        quartersProcessed: [...processedQuarterLabels],
        teams: teams.map((team) => `${team.jiraTeamName} -> ${team.outputTeamName}`),
        issuesFetched: issues.length,
        issuesInScope,
        issuesRepaged,
        worklogEntriesCounted,
        worklogEntriesSkippedOutOfRange,
        exportRows: finalExport.length,
        sprintRowsWritten: freshSprintRows.length,
        outputs: { exportPath, ledgerPath },
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

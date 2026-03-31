import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const envPath = path.join(repoRoot, ".env.local");
const mappingPath = path.join(repoRoot, "backend/excel/jira-field-mapping.template.json");
const configPath = path.join(repoRoot, "backend/excel/templates/config.csv");
const generatedDir = path.join(repoRoot, "backend/excel/generated");

const outputFiles = {
  jiraIssuesRaw: path.join(generatedDir, "jira_issues_raw.csv"),
  jiraChangelogRaw: path.join(generatedDir, "jira_changelog_raw.csv"),
  sprintCalendar: path.join(generatedDir, "sprint_calendar.csv"),
  metricInputsBySprint: path.join(generatedDir, "metric_inputs_by_sprint.csv"),
  metricOutputsByQuarter: path.join(generatedDir, "metric_outputs_by_quarter.csv"),
  jsonExportView: path.join(generatedDir, "json_export_view.csv"),
  refreshControl: path.join(generatedDir, "refresh_control.csv"),
};

const headers = {
  jiraIssuesRaw: [
    "issue_key",
    "issue_id",
    "summary",
    "issue_type",
    "project_key",
    "team_name",
    "sprint_name",
    "sprint_id",
    "sprint_start_date",
    "sprint_end_date",
    "quarter_label",
    "status_at_sprint_start",
    "status_at_sprint_end",
    "points_at_sprint_start",
    "points_at_sprint_end",
    "completed_in_sprint_flag",
    "in_sprint_wip_flag",
    "added_after_sprint_start_flag",
    "removed_after_sprint_start_flag",
  ],
  jiraChangelogRaw: [
    "issue_key",
    "issue_id",
    "team_name",
    "sprint_id",
    "sprint_name",
    "quarter_label",
    "sprint_start_date",
    "event_timestamp",
    "event_author",
    "field_changed",
    "from_value",
    "to_value",
    "change_type",
    "after_sprint_start_flag",
    "backward_move_flag",
    "reestimate_flag",
    "scope_change_flag",
  ],
  sprintCalendar: [
    "team_name",
    "sprint_id",
    "sprint_name",
    "sprint_start_date",
    "sprint_end_date",
    "sprint_sequence",
    "sprint_length_weeks",
    "quarter_label",
    "quarter_start_date",
    "quarter_end_date",
  ],
  metricInputsBySprint: [
    "team_name",
    "sprint_id",
    "sprint_name",
    "quarter_label",
    "cards_committed_at_start",
    "cards_removed_after_start",
    "cards_reestimated_after_start",
    "cards_sent_backward_after_start",
    "completed_cards",
    "completed_points",
    "average_wip_cards",
    "average_throughput_cards_per_sprint",
    "data_quality_note",
    "last_refresh_utc",
  ],
  metricOutputsByQuarter: [
    "team_name",
    "quarter_label",
    "quarter_start_date",
    "quarter_end_date",
    "sprints_in_quarter",
    "cards_committed_at_start_total",
    "cards_removed_after_start_total",
    "cards_reestimated_after_start_total",
    "cards_sent_backward_after_start_total",
    "jira_card_churn_pct",
    "average_wip_cards",
    "average_throughput_cards_per_sprint",
    "estimated_cycle_time_weeks",
    "data_quality_note",
    "last_refresh_utc",
  ],
  jsonExportView: [
    "team_name",
    "quarter_label",
    "metric_name",
    "metric_value",
    "metric_unit",
    "source_system",
    "coverage_status",
    "note",
    "last_refresh_utc",
  ],
  refreshControl: [
    "team_name",
    "quarter_label",
    "quarter_start_date",
    "quarter_end_date",
    "quarter_status",
    "last_successful_refresh_utc",
    "last_issue_update_processed_utc",
    "last_sprint_end_processed",
    "full_recalculation_required_flag",
    "notes",
  ],
};

function parseEnv(text) {
  const env = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

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

function quarterForDate(date) {
  const month = date.getUTCMonth();
  return Math.floor(month / 3) + 1;
}

function quarterWindowForDate(date) {
  const year = date.getUTCFullYear();
  const quarter = quarterForDate(date);
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));

  return {
    year,
    quarter,
    label: `${year}-Q${quarter}`,
    start,
    end,
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
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));

  return {
    year,
    quarter,
    label: `${year}-Q${quarter}`,
    start,
    end,
  };
}

function getTargetQuarterArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (entry === "--quarter") {
      return argv[index + 1] ?? "";
    }

    if (entry.startsWith("--quarter=")) {
      return entry.slice("--quarter=".length);
    }
  }

  return "";
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function toIsoDateTime(date) {
  return date.toISOString();
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

function splitPipeList(value) {
  return String(value ?? "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildConfig(rows) {
  const workflowOrder = new Map();
  const configValues = {};

  for (const row of rows) {
    if (row.config_section === "workflow_order") {
      workflowOrder.set(row.value, Number(row.order_index));
    } else {
      configValues[row.key] = row.value;
    }
  }

  return {
    workflowOrder,
    completedStatuses: new Set(splitPipeList(configValues.completed_statuses)),
    includeIssueTypes: new Set(splitPipeList(configValues.include_issue_types)),
    excludeIssueTypes: new Set(splitPipeList(configValues.exclude_issue_types)),
    quarterConvention: configValues.quarter_convention || "calendar",
    throughputUnit: configValues.throughput_unit || "completed_cards",
    committedAtSprintStartRule:
      configValues.committed_at_sprint_start || "in_sprint_at_exact_sprint_start_timestamp",
    lateAddedCardsTreatment: configValues.late_added_cards_treatment || "churn_only",
    reestimateCounting: configValues.reestimate_counting || "once_per_issue_per_sprint",
    backwardMoveRule:
      configValues.backward_move_rule || "transition_to_earlier_workflow_stage_after_sprint_start",
  };
}

function ensureRequiredEnv(env) {
  const requiredKeys = [
    "JIRA_BASE_URL",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "JIRA_SPRINT_FIELD_ID",
    "JIRA_TEAM_FIELD_ID",
    "JIRA_STORY_POINTS_FIELD_ID",
  ];

  const missing = requiredKeys.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

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

  async getBoardSprints(boardId) {
    const sprints = [];
    let startAt = 0;
    let isLast = false;

    while (!isLast) {
      const payload = await this.requestJson(`/rest/agile/1.0/board/${boardId}/sprint`, {
        state: "active,closed,future",
        startAt,
        maxResults: 50,
      });

      sprints.push(...(payload.values ?? []));
      isLast = Boolean(payload.isLast);
      startAt += payload.maxResults ?? 50;
    }

    return sprints;
  }

  async getSprintIssues(sprintId, fields) {
    const issues = [];
    let startAt = 0;
    let isLast = false;

    while (!isLast) {
      const payload = await this.requestJson(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
        startAt,
        maxResults: 100,
        fields: fields.join(","),
      });

      issues.push(...(payload.issues ?? []));
      startAt += payload.maxResults ?? 100;
      isLast = startAt >= (payload.total ?? issues.length);
    }

    return issues;
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

function issueIsInScope(issue, teamName, mapping, config) {
  const teamField = issue.fields?.[mapping.fields.teamFieldId];
  const resolvedTeamName = teamField?.value ?? teamField?.name ?? "";
  const issueTypeName = issue.fields?.issuetype?.name ?? "";

  if (normalizeName(resolvedTeamName) !== normalizeName(teamName)) {
    return false;
  }

  if (config.includeIssueTypes.size > 0 && !config.includeIssueTypes.has(issueTypeName)) {
    return false;
  }

  if (config.excludeIssueTypes.has(issueTypeName)) {
    return false;
  }

  return true;
}

function sprintOverlapsQuarter(sprint, quarterStart, quarterEnd, now) {
  if (!sprint.startDate || !sprint.endDate) {
    return false;
  }

  const sprintStart = new Date(sprint.startDate);
  const sprintEnd = new Date(sprint.endDate);

  if (sprintStart > now) {
    return false;
  }

  return sprintStart <= quarterEnd && sprintEnd >= quarterStart;
}

function parseSprintFieldValue(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => ({
      id: String(entry.id),
      name: entry.name,
    }))
    .filter((entry) => entry.id && entry.name);
}

function makeSprintTokens(sprint) {
  return [String(sprint.id), sprint.name].filter(Boolean);
}

function sprintValueContainsReference(rawValue, sprint) {
  const haystack = String(rawValue ?? "").toLowerCase();

  return makeSprintTokens(sprint).some((token) => haystack.includes(String(token).toLowerCase()));
}

function eventDate(history) {
  return new Date(history.created);
}

function getHistoryItems(histories, predicate) {
  return histories
    .flatMap((history) =>
      history.items
        .filter(predicate)
        .map((item) => ({
          created: history.created,
          author: history.author?.displayName ?? history.author?.emailAddress ?? "",
          field: item.field,
          fieldId: item.fieldId,
          from: item.from,
          fromString: item.fromString,
          to: item.to,
          toString: item.toString,
        })),
    )
    .sort((left, right) => new Date(left.created) - new Date(right.created));
}

function getStatusHistory(histories) {
  return getHistoryItems(histories, (item) => item.fieldId === "status" || item.field === "status");
}

function getStoryPointsHistory(histories, storyPointsFieldId) {
  return getHistoryItems(
    histories,
    (item) =>
      item.fieldId === storyPointsFieldId ||
      normalizeName(item.field) === "story points" ||
      normalizeName(item.field) === "story point estimate",
  );
}

function getSprintHistory(histories, sprintFieldId) {
  return getHistoryItems(histories, (item) => item.fieldId === sprintFieldId || item.field === "Sprint");
}

function scalarValueAtTime(currentValue, historyItems, targetDate, selector) {
  let value = selector.current(currentValue);
  const targetTime = targetDate.getTime();

  for (let index = historyItems.length - 1; index >= 0; index -= 1) {
    const item = historyItems[index];
    const itemTime = new Date(item.created).getTime();

    if (itemTime > targetTime) {
      const previousValue = selector.from(item);
      if (previousValue !== undefined && previousValue !== null && previousValue !== "") {
        value = previousValue;
      }
    }
  }

  return value;
}

function statusAtTime(currentStatusName, statusHistory, targetDate) {
  return scalarValueAtTime(currentStatusName, statusHistory, targetDate, {
    current: (value) => value,
    from: (item) => item.fromString,
  });
}

function pointsAtTime(currentPoints, pointsHistory, targetDate) {
  const value = scalarValueAtTime(currentPoints, pointsHistory, targetDate, {
    current: (entry) => (entry === null || entry === undefined ? "" : entry),
    from: (item) => item.fromString ?? item.from,
  });

  const parsed = toNumber(value);
  return parsed ?? "";
}

function sprintAddOrRemoveFlags(sprintHistory, sprint, sprintStart, sprintEnd, issueCreatedAt) {
  let addedAfterStart = issueCreatedAt > sprintStart;
  let removedAfterStart = false;

  for (const item of sprintHistory) {
    const itemDate = new Date(item.created);
    if (itemDate <= sprintStart || itemDate > sprintEnd) {
      continue;
    }

    const fromHasSprint =
      sprintValueContainsReference(item.fromString, sprint) || sprintValueContainsReference(item.from, sprint);
    const toHasSprint =
      sprintValueContainsReference(item.toString, sprint) || sprintValueContainsReference(item.to, sprint);

    if (!fromHasSprint && toHasSprint) {
      addedAfterStart = true;
    }

    if (fromHasSprint && !toHasSprint) {
      removedAfterStart = true;
    }
  }

  return { addedAfterStart, removedAfterStart };
}

function issueTouchesSprint(issue, sprint, sprintHistory, sprintFieldId) {
  const currentSprintField = parseSprintFieldValue(issue.fields?.[sprintFieldId]);

  if (currentSprintField.some((entry) => String(entry.id) === String(sprint.id))) {
    return true;
  }

  return sprintHistory.some(
    (item) =>
      sprintValueContainsReference(item.fromString, sprint) ||
      sprintValueContainsReference(item.toString, sprint) ||
      sprintValueContainsReference(item.from, sprint) ||
      sprintValueContainsReference(item.to, sprint),
  );
}

function hasReestimateAfterStart(pointsHistory, sprintStart, sprintEnd) {
  return pointsHistory.some((item) => {
    const itemDate = new Date(item.created);
    if (itemDate <= sprintStart || itemDate > sprintEnd) {
      return false;
    }

    const fromValue = toNumber(item.fromString ?? item.from);
    const toValue = toNumber(item.toString ?? item.to);

    return fromValue !== toValue;
  });
}

function buildBackwardMoveFlag(statusHistory, sprintStart, sprintEnd, workflowOrder) {
  return statusHistory.some((item) => {
    const itemDate = new Date(item.created);
    if (itemDate <= sprintStart || itemDate > sprintEnd) {
      return false;
    }

    const fromOrder = workflowOrder.get(item.fromString);
    const toOrder = workflowOrder.get(item.toString);

    if (fromOrder === undefined || toOrder === undefined) {
      return false;
    }

    return toOrder < fromOrder;
  });
}

function buildCompletedInSprintFlag(
  statusHistory,
  sprintStart,
  sprintEnd,
  completedStatuses,
  statusAtStart,
  statusAtEnd,
) {
  const completedDuringSprint = statusHistory.some((item) => {
    const itemDate = new Date(item.created);
    if (itemDate <= sprintStart || itemDate > sprintEnd) {
      return false;
    }

    return completedStatuses.has(item.toString);
  });

  if (completedDuringSprint) {
    return true;
  }

  return completedStatuses.has(statusAtEnd) && !completedStatuses.has(statusAtStart);
}

function computeWipDurationMs({
  statusHistory,
  currentStatusName,
  sprintStart,
  sprintEnd,
  wipStatuses,
}) {
  if (sprintEnd <= sprintStart) {
    return 0;
  }

  let activeStatus = statusAtTime(currentStatusName, statusHistory, sprintStart);
  let cursor = sprintStart;
  let total = 0;

  for (const item of statusHistory) {
    const itemDate = new Date(item.created);

    if (itemDate <= sprintStart || itemDate > sprintEnd) {
      continue;
    }

    if (wipStatuses.has(activeStatus)) {
      total += itemDate.getTime() - cursor.getTime();
    }

    activeStatus = item.toString || activeStatus;
    cursor = itemDate;
  }

  if (wipStatuses.has(activeStatus)) {
    total += sprintEnd.getTime() - cursor.getTime();
  }

  return total;
}

function buildChangelogRows({
  issue,
  teamName,
  sprint,
  sprintStart,
  sprintEnd,
  quarterLabel,
  statusHistory,
  pointsHistory,
  sprintHistory,
  workflowOrder,
  storyPointsFieldId,
}) {
  const rows = [];
  const relevantItems = [...statusHistory, ...pointsHistory, ...sprintHistory].filter((item) => {
    const itemDate = new Date(item.created);
    return itemDate > sprintStart && itemDate <= sprintEnd;
  });

  for (const item of relevantItems) {
    const backwardMoveFlag =
      (item.fieldId === "status" || item.field === "status") &&
      workflowOrder.get(item.fromString) !== undefined &&
      workflowOrder.get(item.toString) !== undefined &&
      workflowOrder.get(item.toString) < workflowOrder.get(item.fromString);

    const reestimateFlag =
      item.fieldId === storyPointsFieldId ||
      normalizeName(item.field) === "story points" ||
      normalizeName(item.field) === "story point estimate";

    let scopeChangeFlag = false;
    let changeType = "other";

    if (item.field === "Sprint" || item.fieldId === "customfield_10020") {
      const fromHasSprint =
        sprintValueContainsReference(item.fromString, sprint) || sprintValueContainsReference(item.from, sprint);
      const toHasSprint =
        sprintValueContainsReference(item.toString, sprint) || sprintValueContainsReference(item.to, sprint);

      if (!fromHasSprint && toHasSprint) {
        changeType = "added_to_sprint";
        scopeChangeFlag = true;
      } else if (fromHasSprint && !toHasSprint) {
        changeType = "removed_from_sprint";
        scopeChangeFlag = true;
      }
    } else if (item.fieldId === "status" || item.field === "status") {
      changeType = "status_change";
    } else if (reestimateFlag) {
      changeType = "reestimate";
    }

    rows.push({
      issue_key: issue.key,
      issue_id: issue.id,
      team_name: teamName,
      sprint_id: String(sprint.id),
      sprint_name: sprint.name,
      quarter_label: quarterLabel,
      sprint_start_date: toIsoDateTime(sprintStart),
      event_timestamp: item.created,
      event_author: item.author,
      field_changed: item.fieldId || item.field,
      from_value: item.fromString ?? item.from ?? "",
      to_value: item.toString ?? item.to ?? "",
      change_type: changeType,
      after_sprint_start_flag: "yes",
      backward_move_flag: backwardMoveFlag ? "yes" : "no",
      reestimate_flag: reestimateFlag ? "yes" : "no",
      scope_change_flag: scopeChangeFlag ? "yes" : "no",
    });
  }

  return rows;
}

function uniqueBy(rows, keyBuilder) {
  const map = new Map();
  for (const row of rows) {
    map.set(keyBuilder(row), row);
  }
  return [...map.values()];
}

function mergeRowsKeepingOtherQuarters(existingRows, newRows, quarterLabel, teams, rowQuarterKey) {
  const teamNames = new Set(teams.map((team) => team.teamName));
  const retained = existingRows.filter(
    (row) => !(row[rowQuarterKey] === quarterLabel && teamNames.has(row.team_name)),
  );

  return [...retained, ...newRows];
}

function sortByKeys(rows, keys) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const leftValue = String(left[key] ?? "");
      const rightValue = String(right[key] ?? "");
      const compare = leftValue.localeCompare(rightValue);

      if (compare !== 0) {
        return compare;
      }
    }

    return 0;
  });
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

async function main() {
  const env = parseEnv(await fs.readFile(envPath, "utf8"));
  ensureRequiredEnv(env);

  const mapping = JSON.parse(await fs.readFile(mappingPath, "utf8"));
  const configRows = parseCsv(await fs.readFile(configPath, "utf8"));
  const config = buildConfig(configRows);

  const now = new Date();
  const targetQuarter = getTargetQuarterArg(process.argv.slice(2));
  const quarterWindow = targetQuarter ? quarterWindowFromLabel(targetQuarter) : quarterWindowForDate(now);
  const refreshTimestamp = toIsoDateTime(now);

  const client = new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    token: env.JIRA_API_TOKEN,
  });

  const teams = mapping.boardsOrProjects.filter((entry) => entry.teamName && entry.boardId);

  if (teams.length === 0) {
    throw new Error("No tracked teams are configured in backend/excel/jira-field-mapping.template.json.");
  }

  const trackedSprints = [];
  const issueCandidates = new Map();

  for (const team of teams) {
    const boardSprints = await client.getBoardSprints(team.boardId);
    const relevantSprints = boardSprints
      .filter((sprint) => sprintOverlapsQuarter(sprint, quarterWindow.start, quarterWindow.end, now))
      .sort((left, right) => new Date(left.startDate) - new Date(right.startDate));

    relevantSprints.forEach((sprint, index) => {
      trackedSprints.push({
        ...sprint,
        teamName: team.teamName,
        projectKeys: team.projectKeys ?? [],
        sprintSequence: index + 1,
      });
    });

    for (const sprint of relevantSprints) {
      const issues = await client.getSprintIssues(sprint.id, [
        "summary",
        "status",
        "issuetype",
        "created",
        "updated",
        "project",
        mapping.fields.sprintFieldId,
        mapping.fields.teamFieldId,
        mapping.fields.storyPointsFieldId,
      ]);

      for (const issue of issues) {
        if (!issueIsInScope(issue, team.teamName, mapping, config)) {
          continue;
        }

        issueCandidates.set(issue.key, issue);
      }
    }
  }

  const sprintCalendarRows = [];
  const jiraIssuesRawRows = [];
  const jiraChangelogRawRows = [];
  const metricInputsBySprintRows = [];

  const wipStatuses = new Set(
    [...config.workflowOrder.entries()]
      .filter(([statusName, orderIndex]) => {
        const startIndex = config.workflowOrder.get("In Development");
        const completedIndex = config.workflowOrder.get("Closed");

        if (startIndex === undefined || completedIndex === undefined) {
          return false;
        }

        return orderIndex >= startIndex && orderIndex < completedIndex && statusName !== "Closed";
      })
      .map(([statusName]) => statusName),
  );

  for (const sprint of trackedSprints) {
    sprintCalendarRows.push({
      team_name: sprint.teamName,
      sprint_id: String(sprint.id),
      sprint_name: sprint.name,
      sprint_start_date: sprint.startDate,
      sprint_end_date: sprint.endDate,
      sprint_sequence: String(sprint.sprintSequence),
      sprint_length_weeks: "2",
      quarter_label: quarterWindow.label,
      quarter_start_date: toIsoDate(quarterWindow.start),
      quarter_end_date: toIsoDate(quarterWindow.end),
    });
  }

  const issueEntries = await mapLimit([...issueCandidates.values()], 2, async (issue) => ({
    issue,
    changelog: await client.getIssueChangelog(issue.key),
  }));

  for (const { issue, changelog } of issueEntries) {
    const teamField = issue.fields?.[mapping.fields.teamFieldId];
    const teamName = teamField?.value ?? teamField?.name ?? "";
    const teamSprints = trackedSprints.filter((sprint) => sprint.teamName === teamName);

    const statusHistory = getStatusHistory(changelog);
    const pointsHistory = getStoryPointsHistory(changelog, mapping.fields.storyPointsFieldId);
    const sprintHistory = getSprintHistory(changelog, mapping.fields.sprintFieldId);

    const issueCreatedAt = new Date(issue.fields.created);
    const currentStatusName = issue.fields.status?.name ?? "";
    const currentPoints = issue.fields?.[mapping.fields.storyPointsFieldId] ?? "";

    for (const sprint of teamSprints) {
      if (!issueTouchesSprint(issue, sprint, sprintHistory, mapping.fields.sprintFieldId)) {
        continue;
      }

      const sprintStart = new Date(sprint.startDate);
      const sprintEnd = new Date(Math.min(new Date(sprint.endDate).getTime(), now.getTime()));
      const sprintDurationMs = Math.max(1, sprintEnd.getTime() - sprintStart.getTime());
      const { addedAfterStart, removedAfterStart } = sprintAddOrRemoveFlags(
        sprintHistory,
        sprint,
        sprintStart,
        sprintEnd,
        issueCreatedAt,
      );

      const statusAtStart = statusAtTime(currentStatusName, statusHistory, sprintStart);
      const statusAtEnd = statusAtTime(currentStatusName, statusHistory, sprintEnd);
      const pointsAtStart = pointsAtTime(currentPoints, pointsHistory, sprintStart);
      const pointsAtEnd = pointsAtTime(currentPoints, pointsHistory, sprintEnd);

      const committedAtStart = issueCreatedAt <= sprintStart && !addedAfterStart;
      const reestimatedAfterStart = hasReestimateAfterStart(pointsHistory, sprintStart, sprintEnd);
      const backwardMoveFlag = buildBackwardMoveFlag(
        statusHistory,
        sprintStart,
        sprintEnd,
        config.workflowOrder,
      );
      const completedInSprint = buildCompletedInSprintFlag(
        statusHistory,
        sprintStart,
        sprintEnd,
        config.completedStatuses,
        statusAtStart,
        statusAtEnd,
      );

      const wipDurationMs = computeWipDurationMs({
        statusHistory,
        currentStatusName,
        sprintStart,
        sprintEnd,
        wipStatuses,
      });

      const inSprintWipFlag = wipDurationMs > 0;

      jiraIssuesRawRows.push({
        issue_key: issue.key,
        issue_id: issue.id,
        summary: issue.fields.summary ?? "",
        issue_type: issue.fields.issuetype?.name ?? "",
        project_key: issue.fields.project?.key ?? "",
        team_name: teamName,
        sprint_name: sprint.name,
        sprint_id: String(sprint.id),
        sprint_start_date: sprint.startDate,
        sprint_end_date: sprint.endDate,
        quarter_label: quarterWindow.label,
        status_at_sprint_start: statusAtStart,
        status_at_sprint_end: statusAtEnd,
        points_at_sprint_start: pointsAtStart,
        points_at_sprint_end: pointsAtEnd,
        completed_in_sprint_flag: completedInSprint ? "yes" : "no",
        in_sprint_wip_flag: inSprintWipFlag ? "yes" : "no",
        added_after_sprint_start_flag: addedAfterStart ? "yes" : "no",
        removed_after_sprint_start_flag: removedAfterStart ? "yes" : "no",
      });

      jiraChangelogRawRows.push(
        ...buildChangelogRows({
          issue,
          teamName,
          sprint,
          sprintStart,
          sprintEnd,
          quarterLabel: quarterWindow.label,
          statusHistory,
          pointsHistory,
          sprintHistory,
          workflowOrder: config.workflowOrder,
          storyPointsFieldId: mapping.fields.storyPointsFieldId,
        }),
      );

      const sprintDurationRatio = wipDurationMs / sprintDurationMs;
      metricInputsBySprintRows.push({
        team_name: teamName,
        sprint_id: String(sprint.id),
        sprint_name: sprint.name,
        quarter_label: quarterWindow.label,
        cards_committed_at_start: committedAtStart ? "1" : "0",
        cards_removed_after_start: removedAfterStart ? "1" : "0",
        cards_reestimated_after_start: reestimatedAfterStart ? "1" : "0",
        cards_sent_backward_after_start: backwardMoveFlag ? "1" : "0",
        completed_cards: completedInSprint ? "1" : "0",
        completed_points: completedInSprint ? String(toNumber(pointsAtEnd) ?? 0) : "0",
        average_wip_cards: String(round(sprintDurationRatio, 4) || 0),
        average_throughput_cards_per_sprint: completedInSprint ? "1" : "0",
        data_quality_note: committedAtStart ? "" : "Issue was not committed at sprint start.",
        last_refresh_utc: refreshTimestamp,
      });
    }
  }

  const aggregatedSprintInputs = uniqueBy(metricInputsBySprintRows, (row) => `${row.team_name}::${row.sprint_id}`)
    .map((row) => {
      const matchingRows = metricInputsBySprintRows.filter(
        (entry) => entry.team_name === row.team_name && entry.sprint_id === row.sprint_id,
      );

      const noteSet = new Set(matchingRows.map((entry) => entry.data_quality_note).filter(Boolean));
      return {
        team_name: row.team_name,
        sprint_id: row.sprint_id,
        sprint_name: row.sprint_name,
        quarter_label: row.quarter_label,
        cards_committed_at_start: String(
          matchingRows.reduce((sum, entry) => sum + Number(entry.cards_committed_at_start), 0),
        ),
        cards_removed_after_start: String(
          matchingRows.reduce((sum, entry) => sum + Number(entry.cards_removed_after_start), 0),
        ),
        cards_reestimated_after_start: String(
          matchingRows.reduce((sum, entry) => sum + Number(entry.cards_reestimated_after_start), 0),
        ),
        cards_sent_backward_after_start: String(
          matchingRows.reduce((sum, entry) => sum + Number(entry.cards_sent_backward_after_start), 0),
        ),
        completed_cards: String(matchingRows.reduce((sum, entry) => sum + Number(entry.completed_cards), 0)),
        completed_points: String(matchingRows.reduce((sum, entry) => sum + Number(entry.completed_points), 0)),
        average_wip_cards: String(
          round(matchingRows.reduce((sum, entry) => sum + Number(entry.average_wip_cards), 0), 4) || 0,
        ),
        average_throughput_cards_per_sprint: String(
          matchingRows.reduce((sum, entry) => sum + Number(entry.completed_cards), 0),
        ),
        data_quality_note: [...noteSet].join(" | "),
        last_refresh_utc: refreshTimestamp,
      };
    });

  const metricOutputsByQuarterRows = [];
  const jsonExportViewRows = [];
  const refreshControlRows = [];

  for (const team of teams) {
    const teamSprintRows = aggregatedSprintInputs.filter((row) => row.team_name === team.teamName);
    const teamSprintsInQuarter = trackedSprints.filter((sprint) => sprint.teamName === team.teamName);
    const teamIssues = [...issueCandidates.values()].filter(
      (issue) => normalizeName(issue.fields?.[mapping.fields.teamFieldId]?.value) === normalizeName(team.teamName),
    );
    const sprintCount = teamSprintsInQuarter.length;
    const committedTotal = teamSprintRows.reduce((sum, row) => sum + Number(row.cards_committed_at_start), 0);
    const removedTotal = teamSprintRows.reduce((sum, row) => sum + Number(row.cards_removed_after_start), 0);
    const reestimatedTotal = teamSprintRows.reduce(
      (sum, row) => sum + Number(row.cards_reestimated_after_start),
      0,
    );
    const backwardTotal = teamSprintRows.reduce(
      (sum, row) => sum + Number(row.cards_sent_backward_after_start),
      0,
    );
    const averageWipCards =
      sprintCount > 0
        ? teamSprintRows.reduce((sum, row) => sum + Number(row.average_wip_cards), 0) / sprintCount
        : 0;
    const averageThroughput =
      sprintCount > 0
        ? teamSprintRows.reduce((sum, row) => sum + Number(row.completed_cards), 0) / sprintCount
        : 0;
    const churnPct =
      committedTotal > 0 ? ((removedTotal + reestimatedTotal + backwardTotal) / committedTotal) * 100 : null;
    const estimatedCycleTime =
      averageThroughput > 0 ? (averageWipCards / averageThroughput) * 2 : null;
    const latestSprintEndProcessed = teamSprintsInQuarter
      .map((sprint) => sprint.endDate)
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0];
    const latestIssueUpdateProcessed = teamIssues
      .map((issue) => issue.fields?.updated)
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0];
    const quarterStatus = now <= quarterWindow.end ? "in_progress" : "complete";

    metricOutputsByQuarterRows.push({
      team_name: team.teamName,
      quarter_label: quarterWindow.label,
      quarter_start_date: toIsoDate(quarterWindow.start),
      quarter_end_date: toIsoDate(quarterWindow.end),
      sprints_in_quarter: String(sprintCount),
      cards_committed_at_start_total: String(committedTotal),
      cards_removed_after_start_total: String(removedTotal),
      cards_reestimated_after_start_total: String(reestimatedTotal),
      cards_sent_backward_after_start_total: String(backwardTotal),
      jira_card_churn_pct: round(churnPct),
      average_wip_cards: round(averageWipCards, 4),
      average_throughput_cards_per_sprint: round(averageThroughput, 4),
      estimated_cycle_time_weeks: round(estimatedCycleTime),
      data_quality_note:
        quarterStatus === "in_progress"
          ? "Quarter is still in progress; values are quarter-to-date."
          : "",
      last_refresh_utc: refreshTimestamp,
    });

    jsonExportViewRows.push(
      {
        team_name: team.teamName,
        quarter_label: quarterWindow.label,
        metric_name: "Jira Card Churn %",
        metric_value: round(churnPct),
        metric_unit: "percent",
        source_system: "Jira",
        coverage_status: "Yes (partial)",
        note: "Calculated from removed, re-estimated, and backward-move events after sprint start.",
        last_refresh_utc: refreshTimestamp,
      },
      {
        team_name: team.teamName,
        quarter_label: quarterWindow.label,
        metric_name: "Estimated Cycle Time (weeks)",
        metric_value: round(estimatedCycleTime),
        metric_unit: "weeks",
        source_system: "Jira",
        coverage_status: "Yes (partial)",
        note: "Proxy metric based on average WIP cards and completed cards per sprint.",
        last_refresh_utc: refreshTimestamp,
      },
    );

    refreshControlRows.push({
      team_name: team.teamName,
      quarter_label: quarterWindow.label,
      quarter_start_date: toIsoDate(quarterWindow.start),
      quarter_end_date: toIsoDate(quarterWindow.end),
      quarter_status: quarterStatus,
      last_successful_refresh_utc: refreshTimestamp,
      last_issue_update_processed_utc: latestIssueUpdateProcessed ?? refreshTimestamp,
      last_sprint_end_processed: latestSprintEndProcessed ?? "",
      full_recalculation_required_flag: quarterStatus === "in_progress" ? "yes" : "no",
      notes: quarterStatus === "in_progress" ? "Current quarter is recalculated on every run." : "",
    });
  }

  await fs.mkdir(generatedDir, { recursive: true });

  const existingJiraIssuesRaw = await readCsvFile(outputFiles.jiraIssuesRaw);
  const existingJiraChangelogRaw = await readCsvFile(outputFiles.jiraChangelogRaw);
  const existingSprintCalendar = await readCsvFile(outputFiles.sprintCalendar);
  const existingMetricInputsBySprint = await readCsvFile(outputFiles.metricInputsBySprint);
  const existingMetricOutputsByQuarter = await readCsvFile(outputFiles.metricOutputsByQuarter);
  const existingJsonExportView = await readCsvFile(outputFiles.jsonExportView);
  const existingRefreshControl = await readCsvFile(outputFiles.refreshControl);

  const mergedJiraIssuesRaw = sortByKeys(
    mergeRowsKeepingOtherQuarters(existingJiraIssuesRaw, jiraIssuesRawRows, quarterWindow.label, teams, "quarter_label"),
    ["team_name", "quarter_label", "sprint_id", "issue_key"],
  );
  const mergedJiraChangelogRaw = sortByKeys(
    mergeRowsKeepingOtherQuarters(
      existingJiraChangelogRaw,
      jiraChangelogRawRows,
      quarterWindow.label,
      teams,
      "quarter_label",
    ),
    ["team_name", "quarter_label", "sprint_id", "issue_key", "event_timestamp"],
  );
  const mergedSprintCalendar = sortByKeys(
    mergeRowsKeepingOtherQuarters(existingSprintCalendar, sprintCalendarRows, quarterWindow.label, teams, "quarter_label"),
    ["team_name", "quarter_label", "sprint_id"],
  );
  const mergedMetricInputs = sortByKeys(
    mergeRowsKeepingOtherQuarters(
      existingMetricInputsBySprint,
      aggregatedSprintInputs,
      quarterWindow.label,
      teams,
      "quarter_label",
    ),
    ["team_name", "quarter_label", "sprint_id"],
  );
  const mergedMetricOutputs = sortByKeys(
    mergeRowsKeepingOtherQuarters(
      existingMetricOutputsByQuarter,
      metricOutputsByQuarterRows,
      quarterWindow.label,
      teams,
      "quarter_label",
    ),
    ["team_name", "quarter_label"],
  );
  const mergedJsonExportView = sortByKeys(
    mergeRowsKeepingOtherQuarters(existingJsonExportView, jsonExportViewRows, quarterWindow.label, teams, "quarter_label"),
    ["team_name", "quarter_label", "metric_name"],
  );
  const retainedRefreshControl = existingRefreshControl.filter(
    (row) =>
      !(
        row.quarter_label === quarterWindow.label &&
        teams.some((team) => team.teamName === row.team_name)
      ),
  );
  const mergedRefreshControl = sortByKeys([...retainedRefreshControl, ...refreshControlRows], [
    "team_name",
    "quarter_label",
  ]);

  await Promise.all([
    fs.writeFile(outputFiles.jiraIssuesRaw, toCsv(headers.jiraIssuesRaw, mergedJiraIssuesRaw), "utf8"),
    fs.writeFile(outputFiles.jiraChangelogRaw, toCsv(headers.jiraChangelogRaw, mergedJiraChangelogRaw), "utf8"),
    fs.writeFile(outputFiles.sprintCalendar, toCsv(headers.sprintCalendar, mergedSprintCalendar), "utf8"),
    fs.writeFile(
      outputFiles.metricInputsBySprint,
      toCsv(headers.metricInputsBySprint, mergedMetricInputs),
      "utf8",
    ),
    fs.writeFile(
      outputFiles.metricOutputsByQuarter,
      toCsv(headers.metricOutputsByQuarter, mergedMetricOutputs),
      "utf8",
    ),
    fs.writeFile(outputFiles.jsonExportView, toCsv(headers.jsonExportView, mergedJsonExportView), "utf8"),
    fs.writeFile(outputFiles.refreshControl, toCsv(headers.refreshControl, mergedRefreshControl), "utf8"),
  ]);

  const summary = {
    quarter: quarterWindow.label,
    teams: teams.map((team) => team.teamName),
    sprintsProcessed: trackedSprints.length,
    issuesProcessed: issueCandidates.size,
    refreshedAt: refreshTimestamp,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

export type MetricRecord = {
  team: string;
  quarter: string;
  metricName: string;
  value: number;
  unit: string;
  source: string;
  automationStatus: string;
  note: string;
  lastRefreshUtc: string;
};

export type MetricsPayload = {
  reportDate: string;
  teams: string[];
  quarters: string[];
  metrics: MetricRecord[];
};

export type TeamSummary = {
  teamKey: string;
  teamLabel: string;
  periodLabel: string;
  lastRefreshUtc: string;
  metrics: MetricRecord[];
  isPortfolio: boolean;
};

export type PeriodOption = {
  key: string;
  label: string;
  kind: "quarter" | "ytd";
  year: number;
  quarter?: number;
  isInProgress: boolean;
};

export const metricDescriptions: Record<string, string> = {
  "Jira Card Churn %":
    "Share of sprint-committed work that left the plan, was re-pointed, or moved backward after sprint start.",
  "Average Velocity (points per sprint)":
    "Average completed story points per sprint across the period for the team.",
  "Flow-based Cycle Time Proxy (weeks)":
    "Flow-health signal from average WIP vs completed cards per sprint; lower usually means healthier flow.",
  "Actual Cycle Time (weeks)":
    "Average real elapsed time from active work start until the item is done in Jira with resolution Done.",
  "Cursor Adoption Rate":
    "Share of mapped team members with qualifying Cursor activity in the selected period.",
  "AI-assisted Pull Request Coverage":
    "Share of in-scope pull requests with qualifying AI assistance signals in the selected period.",
  "AI Active Developers":
    "Count of mapped developers with qualifying AI-assisted activity in the selected period.",
};

export const metricDisplayOrder = [
  "Jira Card Churn %",
  "Average Velocity (points per sprint)",
  "Flow-based Cycle Time Proxy (weeks)",
  "Actual Cycle Time (weeks)",
  "Cursor Adoption Rate",
  "AI-assisted Pull Request Coverage",
  "AI Active Developers",
];

const teamDisplayMap: Record<string, string> = {
  EDU: "EDU",
  "Team Connexpoint": "CXP",
  "Team Webstore": "Revtrak",
  ASAP: "ASAP",
  Smartcare: "Smartcare",
  SmartCare: "Smartcare",
};

const preferredTeamOrder = ["EDU", "Team Connexpoint", "Team Webstore", "ASAP", "Smartcare"];

function metricSortIndex(metricName: string) {
  const index = metricDisplayOrder.indexOf(metricName);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

type ParsedPeriod = {
  key: string;
  kind: "quarter" | "ytd";
  year: number;
  quarter?: number;
};

function parsePeriod(key: string): ParsedPeriod | null {
  const quarterMatch = /^(\d{4})-Q([1-4])$/.exec(String(key ?? "").trim());

  if (quarterMatch) {
    return {
      key,
      kind: "quarter",
      year: Number(quarterMatch[1]),
      quarter: Number(quarterMatch[2]),
    };
  }

  const ytdMatch = /^(\d{4})-YTD$/.exec(String(key ?? "").trim());

  if (ytdMatch) {
    return {
      key,
      kind: "ytd",
      year: Number(ytdMatch[1]),
    };
  }

  return null;
}

function reportDateQuarter(reportDate: string) {
  if (!reportDate) {
    return null;
  }

  const date = new Date(`${reportDate}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    year: date.getUTCFullYear(),
    quarter: Math.floor(date.getUTCMonth() / 3) + 1,
  };
}

function comparePeriodOptions(left: PeriodOption, right: PeriodOption) {
  if (left.year !== right.year) {
    return right.year - left.year;
  }

  if (left.kind === "quarter" && right.kind === "quarter") {
    return (right.quarter ?? 0) - (left.quarter ?? 0);
  }

  if (left.kind !== right.kind) {
    return left.kind === "quarter" ? -1 : 1;
  }

  return right.label.localeCompare(left.label);
}

export function buildPeriodOptions(payload: MetricsPayload | null): PeriodOption[] {
  if (!payload) {
    return [];
  }

  const reportQuarter = reportDateQuarter(payload.reportDate);
  const periodKeys = [...new Set([...payload.quarters, ...payload.metrics.map((metric) => metric.quarter)])];
  const periodOptions: PeriodOption[] = [];

  for (const key of periodKeys) {
    const parsed = parsePeriod(key);

    if (!parsed) {
      continue;
    }

    periodOptions.push({
      key: parsed.key,
      label: parsed.key,
      kind: parsed.kind,
      year: parsed.year,
      quarter: parsed.quarter,
      isInProgress:
        parsed.kind === "quarter" &&
        reportQuarter !== null &&
        parsed.year === reportQuarter.year &&
        parsed.quarter === reportQuarter.quarter,
    });
  }

  return periodOptions.sort(comparePeriodOptions);
}

export function defaultPeriodKey(periodOptions: PeriodOption[]) {
  return periodOptions.find((period) => period.kind === "quarter")?.key ?? periodOptions[0]?.key ?? "";
}

export function getPeriodOption(periodOptions: PeriodOption[], periodKey: string) {
  return periodOptions.find((period) => period.key === periodKey) ?? null;
}

export function formatMetricValue(metric: MetricRecord) {
  if (metric.unit === "percent") {
    return `${metric.value.toFixed(2)}%`;
  }

  if (metric.unit === "weeks") {
    return `${metric.value.toFixed(2)} wks`;
  }

  if (metric.unit === "points") {
    return `${metric.value.toFixed(2)} pts`;
  }

  if (metric.unit === "count") {
    return Number.isInteger(metric.value) ? String(metric.value) : metric.value.toFixed(2);
  }

  return String(metric.value);
}

export function buildTeamSummaries(payload: MetricsPayload | null, periodKey: string) {
  if (!payload || !periodKey) {
    return [];
  }

  const availableTeamKeys = [...new Set([...payload.teams, ...payload.metrics.map((metric) => metric.team)])];
  const remainingTeamKeys = availableTeamKeys
    .filter((teamKey) => !preferredTeamOrder.includes(teamKey))
    .sort((left, right) => left.localeCompare(right));
  const orderedTeamKeys = [...preferredTeamOrder, ...remainingTeamKeys].filter((teamKey) =>
    availableTeamKeys.includes(teamKey),
  );

  return orderedTeamKeys.map((teamKey) => {
    const teamMetrics = payload.metrics
      .filter((metric) => metric.team === teamKey && metric.quarter === periodKey)
      .sort(
        (left, right) =>
          metricSortIndex(left.metricName) - metricSortIndex(right.metricName),
      );

    return {
      teamKey,
      teamLabel: teamDisplayMap[teamKey] ?? teamKey,
      periodLabel: teamMetrics[0]?.quarter ?? periodKey,
      lastRefreshUtc: teamMetrics[0]?.lastRefreshUtc ?? "",
      metrics: teamMetrics,
      isPortfolio: teamKey === "EDU",
    };
  });
}

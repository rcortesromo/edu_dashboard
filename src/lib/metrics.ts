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

export type SprintInfo = {
  key: string;
  sequence: number;
  name: string;
  start: string;
  end: string;
};

export type SprintCalendar = Record<string, Record<string, SprintInfo[]>>;

export type MetricsPayload = {
  reportDate: string;
  teams: string[];
  quarters: string[];
  sprintCalendar: SprintCalendar;
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
  kind: "quarter" | "ytd" | "sprint";
  year: number;
  quarter?: number;
  sprintSequence?: number;
  parentQuarter?: string;
  dateRange?: string;
  isInProgress: boolean;
};

export const metricDescriptions: Record<string, string> = {
  "Jira Card Churn %":
    "Share of sprint-committed work that left the plan, was re-pointed, or moved backward after sprint start.",
  "Defect Leakage %":
    "Share of high-severity bugs (Severity Level 1 and 2) out of all logged bugs plus reopens for the team.",
  "Sev 1 Bugs": "Count of Severity Level 1 bugs logged for the team in the selected period.",
  "Sev 2 Bugs": "Count of Severity Level 2 bugs logged for the team in the selected period.",
  "Sev 1 + Sev 2 Bugs":
    "Count of high-severity bugs (Severity Level 1 and 2 combined) logged for the team in the selected period.",
  "MTTR (Sev 1 + Sev 2)":
    "Time to resolve for Sev 1 and 2 OV issues (Bug, Story, Task): business time (weekends excluded) from when the issue was created until its status changes to Closed. Covers Connexpoint, Webstore, ASAP, and Smartcare. The line is the median (the typical case); the lighter line is the average, which a few long-running issues can pull up.",
  "Maintain %":
    "Share of logged worklog hours spent on Maintain work (Prod Sev 1, Maintenance, Tech Hardening) in the selected period, from the Work Type field.",
  "Run %":
    "Share of logged worklog hours spent on Run work (Client Request, Strategic) in the selected period, from the Work Type field.",
  "Growth %":
    "Share of logged worklog hours spent on Growth work (Experiment/Growth) in the selected period, from the Work Type field.",
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
    "Count of mapped team members with qualifying Cursor activity in the selected period (the numerator behind the Cursor adoption rate).",
};

export const metricDisplayOrder = [
  "Maintain %",
  "Run %",
  "Growth %",
  "Jira Card Churn %",
  "Defect Leakage %",
  "Sev 1 Bugs",
  "Sev 2 Bugs",
  "MTTR (Sev 1 + Sev 2)",
  "Average Velocity (points per sprint)",
  "Flow-based Cycle Time Proxy (weeks)",
  "Actual Cycle Time (weeks)",
  "Cursor Adoption Rate",
  "AI-assisted Pull Request Coverage",
  "AI Active Developers",
];

// The Metrics (charts) page renders the per-severity bug counts in a dedicated chart (one Sev 1 and
// one Sev 2 line per team), so the individual count metrics are not listed here; MetricsPage injects
// that chart right after Defect Leakage.
export const trendsMetricOrder = [
  "Jira Card Churn %",
  "Defect Leakage %",
  "MTTR (Sev 1 + Sev 2)",
  "Average Velocity (points per sprint)",
  "Flow-based Cycle Time Proxy (weeks)",
  "Actual Cycle Time (weeks)",
  "Cursor Adoption Rate",
  "AI-assisted Pull Request Coverage",
  "AI Active Developers",
];

// Metric names for the per-severity bug-count trend chart (team x severity lines).
export const severityCountMetricNames = ["Sev 1 Bugs", "Sev 2 Bugs"] as const;

// Metric names for the internal-vs-external (Root Cause) severity breakdown chart.
export const severityRootCauseMetricNames = [
  "Sev 1 Bugs (Internal)",
  "Sev 1 Bugs (External)",
  "Sev 2 Bugs (Internal)",
  "Sev 2 Bugs (External)",
] as const;

// MTTR combo chart: a median line (main) + average line (reference) for the resolve time, with bars
// for the ticket count.
export const mttrMetricName = "MTTR (Sev 1 + Sev 2)";
export const mttrAvgMetricName = "MTTR Avg (Sev 1 + Sev 2)";
export const mttrTicketsMetricName = "MTTR Tickets (Sev 1 + Sev 2)";

// Maintain/Run/Growth mix: a single-period snapshot bar chart (one bar per category), not a
// per-period trend line, so it is rendered by a dedicated component instead of the generic
// trendsMetricOrder loop.
export const maintainMetricName = "Maintain %";
export const runMetricName = "Run %";
export const growthMetricName = "Growth %";
export const mrgMetricNames = [maintainMetricName, runMetricName, growthMetricName] as const;

// Format a business-hours duration adaptively: hours under a day, days (24h = 1 day) from a day up.
export function formatBusinessHours(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value < 24 ? `${value.toFixed(1)} h` : `${(value / 24).toFixed(2)} d`;
}

const teamDisplayMap: Record<string, string> = {
  EDU: "EDU",
  "Team Connexpoint": "CXP",
  "Team Webstore": "Revtrak",
  ASAP: "ASAP",
  Smartcare: "Smartcare",
  SmartCare: "Smartcare",
};

const preferredTeamOrder = ["EDU", "Team Connexpoint", "Team Webstore", "ASAP", "Smartcare"];

const metricDisplaySet = new Set(metricDisplayOrder);

// Shared visual grouping, reused by both the Metrics (Trends) charts page and the Scorecard
// snapshot page: each section owns an ordered subset of metric names. Each page still filters
// this down to whichever metric names actually apply to it (trendsMetricOrder for charts,
// metricDisplayOrder for scorecard cards), so a metric only listed here for one page (e.g. Sev 1/2
// counts, which the Trends page renders via a dedicated combo chart instead) is automatically
// skipped on the other.
export type MetricSectionId = "work-type" | "delivery-flow" | "quality-reliability" | "ai-adoption";

export const metricSections: { id: MetricSectionId; title: string; description: string; metrics: string[] }[] = [
  {
    id: "work-type",
    title: "Work Type",
    description: "Share of logged hours across Maintain, Run, and Growth work.",
    metrics: [maintainMetricName, runMetricName, growthMetricName],
  },
  {
    id: "delivery-flow",
    title: "Delivery Flow",
    description: "Sprint planning stability, throughput, and cycle time.",
    metrics: [
      "Jira Card Churn %",
      "Average Velocity (points per sprint)",
      "Flow-based Cycle Time Proxy (weeks)",
      "Actual Cycle Time (weeks)",
    ],
  },
  {
    id: "quality-reliability",
    title: "Severities & MTTR",
    description: "Defect leakage, severity breakdown, and resolution time.",
    metrics: ["Defect Leakage %", "Sev 1 Bugs", "Sev 2 Bugs", "MTTR (Sev 1 + Sev 2)"],
  },
  {
    id: "ai-adoption",
    title: "AI & Cursor Adoption",
    description: "Cursor usage and AI-assisted delivery signals.",
    metrics: ["Cursor Adoption Rate", "AI-assisted Pull Request Coverage", "AI Active Developers"],
  },
];

// Metrics that represent counts/ratios of bugs in a period: when a sprint has no matching row it
// means zero bugs, so show 0 with a "no bugs" flag instead of falling back to the quarter value.
const zeroWhenNoSprintData = new Set(["Defect Leakage %", "Sev 1 Bugs", "Sev 2 Bugs"]);

function metricSortIndex(metricName: string) {
  const index = metricDisplayOrder.indexOf(metricName);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

type ParsedPeriod = {
  key: string;
  kind: "quarter" | "ytd" | "sprint";
  year: number;
  quarter?: number;
  sprintSequence?: number;
  parentQuarter?: string;
};

function parsePeriod(key: string): ParsedPeriod | null {
  const trimmed = String(key ?? "").trim();

  const sprintMatch = /^(\d{4})-Q([1-4])-S(\d+)$/.exec(trimmed);

  if (sprintMatch) {
    return {
      key: trimmed,
      kind: "sprint",
      year: Number(sprintMatch[1]),
      quarter: Number(sprintMatch[2]),
      sprintSequence: Number(sprintMatch[3]),
      parentQuarter: `${sprintMatch[1]}-Q${sprintMatch[2]}`,
    };
  }

  const quarterMatch = /^(\d{4})-Q([1-4])$/.exec(trimmed);

  if (quarterMatch) {
    return {
      key: trimmed,
      kind: "quarter",
      year: Number(quarterMatch[1]),
      quarter: Number(quarterMatch[2]),
    };
  }

  const ytdMatch = /^(\d{4})-YTD$/.exec(trimmed);

  if (ytdMatch) {
    return {
      key: trimmed,
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

    if (!parsed || parsed.kind === "sprint") {
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

export function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);

  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return "";
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sMonth = months[s.getUTCMonth()];
  const eMonth = months[e.getUTCMonth()];
  const sDay = s.getUTCDate();
  const eDay = e.getUTCDate();

  if (sMonth === eMonth) {
    return `${sMonth} ${sDay}\u2013${eDay}`;
  }

  return `${sMonth} ${sDay} \u2013 ${eMonth} ${eDay}`;
}

// Team Connexpoint (CXP) is the single official sprint calendar. The sprint axis is defined
// strictly by CXP's sprints; every team's data is bucketed into these periods. Sprint 0 is
// intentionally excluded.
export const officialCalendarTeam = "Team Connexpoint";
const excludedSprintSequences = new Set<number>([0]);

export function getSprintsForQuarter(
  payload: MetricsPayload | null,
  quarterKey: string,
): SprintInfo[] {
  if (!payload?.sprintCalendar) return [];

  const officialSprints = payload.sprintCalendar[officialCalendarTeam]?.[quarterKey] ?? [];
  const byKey = new Map<string, SprintInfo>();

  for (const sprint of officialSprints) {
    if (excludedSprintSequences.has(sprint.sequence)) continue;

    const existing = byKey.get(sprint.key);
    if (!existing) {
      byKey.set(sprint.key, { ...sprint });
      continue;
    }
    // Same key appearing more than once (e.g. mislabeled sprints in Jira): merge into one window
    // spanning the earliest start to the latest end so no part of the period is dropped.
    if (sprint.start < existing.start) existing.start = sprint.start;
    if (sprint.end > existing.end) existing.end = sprint.end;
  }

  return [...byKey.values()].sort((a, b) => a.sequence - b.sequence);
}

export function formatMetricValue(metric: MetricRecord) {
  if (metric.unit === "percent") {
    return `${metric.value.toFixed(2)}%`;
  }

  if (metric.unit === "weeks") {
    return `${metric.value.toFixed(2)} wks`;
  }

  if (metric.unit === "hours") {
    // Adaptive: show hours under a day, days (24 business-hours = 1 day) from a day up.
    return metric.value < 24
      ? `${metric.value.toFixed(1)} h`
      : `${(metric.value / 24).toFixed(2)} d`;
  }

  if (metric.unit === "points") {
    return `${metric.value.toFixed(2)} pts`;
  }

  if (metric.unit === "count") {
    return Number.isInteger(metric.value) ? String(metric.value) : metric.value.toFixed(2);
  }

  return String(metric.value);
}

export function buildTeamSummaries(payload: MetricsPayload | null, periodKey: string, sprintKey?: string) {
  if (!payload || !periodKey) {
    return [];
  }

  const effectiveKey = sprintKey || periodKey;
  const parsed = parsePeriod(effectiveKey);
  const parentQuarter = parsed?.kind === "sprint" ? parsed.parentQuarter : undefined;

  const availableTeamKeys = [...new Set([...payload.teams, ...payload.metrics.map((metric) => metric.team)])];
  const remainingTeamKeys = availableTeamKeys
    .filter((teamKey) => !preferredTeamOrder.includes(teamKey))
    .sort((left, right) => left.localeCompare(right));
  const orderedTeamKeys = [...preferredTeamOrder, ...remainingTeamKeys].filter((teamKey) =>
    availableTeamKeys.includes(teamKey),
  );

  return orderedTeamKeys.map((teamKey) => {
    const sprintMetrics = sprintKey
      ? payload.metrics.filter(
          (metric) =>
            metric.team === teamKey &&
            metric.quarter === sprintKey &&
            metricDisplaySet.has(metric.metricName),
        )
      : [];

    const quarterMetrics = payload.metrics.filter(
      (metric) =>
        metric.team === teamKey &&
        metric.quarter === (parentQuarter ?? periodKey) &&
        metricDisplaySet.has(metric.metricName),
    );

    let teamMetrics: MetricRecord[];

    if (sprintKey && parentQuarter) {
      const sprintMetricNames = new Set(sprintMetrics.map((m) => m.metricName));
      const fallbackMetrics = quarterMetrics
        .filter((m) => !sprintMetricNames.has(m.metricName))
        .map((m) => {
          // These metrics only emit a sprint row when bugs were logged in that sprint window.
          // No row means zero bugs, so show 0 with a "no bugs" flag instead of the quarter value.
          if (zeroWhenNoSprintData.has(m.metricName)) {
            return { ...m, value: 0, quarter: sprintKey, _noBugsInPeriod: true as const };
          }
          return { ...m, _quarterFallback: true as const };
        });
      teamMetrics = [...sprintMetrics, ...fallbackMetrics];
    } else {
      teamMetrics = quarterMetrics;
    }

    teamMetrics.sort(
      (left, right) =>
        metricSortIndex(left.metricName) - metricSortIndex(right.metricName),
    );

    return {
      teamKey,
      teamLabel: teamDisplayMap[teamKey] ?? teamKey,
      periodLabel: sprintKey ?? (teamMetrics[0]?.quarter ?? periodKey),
      lastRefreshUtc: teamMetrics[0]?.lastRefreshUtc ?? "",
      metrics: teamMetrics,
      isPortfolio: teamKey === "EDU",
    };
  });
}

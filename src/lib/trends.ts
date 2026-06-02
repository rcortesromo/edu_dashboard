import { formatDateRange, type MetricsPayload, type SprintInfo } from "./metrics";

export type ViewMode = "year" | "all-quarters" | "ytd" | "sprint";

export const teamDisplayMap: Record<string, string> = {
  EDU: "EDU",
  "Team Connexpoint": "CXP",
  "Team Webstore": "Revtrak",
  ASAP: "ASAP",
  Smartcare: "Smartcare",
  SmartCare: "Smartcare",
};

export const teamColors: Record<string, string> = {
  EDU: "#6d28d9",
  "Team Connexpoint": "#2563eb",
  "Team Webstore": "#059669",
  ASAP: "#d97706",
  Smartcare: "#dc2626",
};

const preferredTeamOrder = ["Team Connexpoint", "Team Webstore", "ASAP", "Smartcare"];

export function getAvailableYears(payload: MetricsPayload): number[] {
  const years = new Set<number>();
  for (const q of payload.quarters) {
    const match = /^(\d{4})-/.exec(q);
    if (match) years.add(Number(match[1]));
  }
  for (const m of payload.metrics) {
    const match = /^(\d{4})-/.exec(m.quarter);
    if (match) years.add(Number(match[1]));
  }
  return [...years].sort((a, b) => b - a);
}

export function getAvailableQuarters(payload: MetricsPayload): string[] {
  const quarters = new Set<string>();
  for (const q of payload.quarters) {
    if (/^\d{4}-Q[1-4]$/.test(q)) quarters.add(q);
  }
  return [...quarters].sort().reverse();
}

export function getAvailableTeams(payload: MetricsPayload): string[] {
  const teams = new Set(payload.metrics.map((m) => m.team).filter((t) => t !== "EDU"));
  const ordered = preferredTeamOrder.filter((t) => teams.has(t));
  const rest = [...teams].filter((t) => !ordered.includes(t)).sort();
  return [...ordered, ...rest];
}

export function getPeriodMapping(
  viewMode: ViewMode,
  selectedYear: number,
  selectedQuarter?: string,
  sprintLookup?: Map<string, SprintInfo>,
): { periodFilter: (q: string) => boolean; xLabel: (q: string) => string } {
  if (viewMode === "sprint" && selectedQuarter) {
    return {
      periodFilter: (q) => {
        // Exclude S0 (warm-up sprint that only carries AI/Cursor data).
        const match = /^(\d{4}-Q[1-4])-S[1-9]\d*$/.exec(q);
        return match !== null && match[1] === selectedQuarter;
      },
      xLabel: (q) => {
        const sprint = sprintLookup?.get(q);
        if (sprint) {
          const range = formatDateRange(sprint.start, sprint.end);
          return range ? `S${sprint.sequence} (${range})` : `S${sprint.sequence}`;
        }
        return q.replace(/^.*-S/, "S");
      },
    };
  }
  if (viewMode === "ytd") {
    return {
      periodFilter: (q) => /^\d{4}-YTD$/.test(q),
      xLabel: (q) => q.replace("-YTD", ""),
    };
  }
  if (viewMode === "year") {
    return {
      periodFilter: (q) => {
        const match = /^(\d{4})-Q\d$/.exec(q);
        return match !== null && Number(match[1]) === selectedYear;
      },
      xLabel: (q) => q.replace(`${selectedYear}-`, ""),
    };
  }
  return {
    periodFilter: (q) => /^\d{4}-Q\d$/.test(q),
    xLabel: (q) => q,
  };
}

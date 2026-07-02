import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { maintainMetricName, runMetricName, growthMetricName, type MetricsPayload } from "../lib/metrics";

type MrgMixChartProps = {
  payload: MetricsPayload;
  // When set, plot a single team's mix. When omitted, plot the EDU rollup across all teams.
  team?: string;
};

type MrgBar = {
  name: "G" | "M" | "R";
  label: string;
  value: number;
};

const MRG_COLORS: Record<MrgBar["name"], string> = {
  M: "#2563eb",
  R: "#d97706",
  G: "#059669",
};

const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid rgba(109,40,217,0.14)",
  borderRadius: 12,
  fontSize: 13,
} as const;

// Snapshot bar chart: G/M/R are fixed categories for a single selected period, not a trend across
// periods, so this owns its own quarter/YTD selector instead of following the page's viewMode
// toolbar (which drives time-series charts elsewhere on the Metrics/Team Metrics pages).
function availablePeriods(payload: MetricsPayload, team: string): string[] {
  const periods = new Set<string>();
  for (const metric of payload.metrics) {
    if (metric.team !== team) continue;
    if (
      metric.metricName !== maintainMetricName &&
      metric.metricName !== runMetricName &&
      metric.metricName !== growthMetricName
    ) {
      continue;
    }
    if (/^\d{4}-Q[1-4]$/.test(metric.quarter) || /^\d{4}-YTD$/.test(metric.quarter)) {
      periods.add(metric.quarter);
    }
  }
  // Quarters and YTD labels both sort lexicographically in the right order within their own kind;
  // interleave with quarters first (most recent) so the default selection is the latest quarter.
  return [...periods].sort((a, b) => b.localeCompare(a));
}

function periodLabel(period: string): string {
  return period.replace("-YTD", " YTD");
}

function buildMrgData(payload: MetricsPayload, team: string, period: string): MrgBar[] {
  const valueFor = (metricName: string) =>
    payload.metrics.find((m) => m.team === team && m.quarter === period && m.metricName === metricName)?.value ?? 0;

  return [
    { name: "M", label: "Maintain", value: valueFor(maintainMetricName) },
    { name: "R", label: "Run", value: valueFor(runMetricName) },
    { name: "G", label: "Growth", value: valueFor(growthMetricName) },
  ];
}

function MrgMixChart({ payload, team }: MrgMixChartProps) {
  const targetTeam = team ?? "EDU";

  const periods = useMemo(() => availablePeriods(payload, targetTeam), [payload, targetTeam]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const resolvedPeriod = periods.includes(selectedPeriod) ? selectedPeriod : periods[0] ?? "";

  const data = useMemo(
    () => (resolvedPeriod ? buildMrgData(payload, targetTeam, resolvedPeriod) : []),
    [payload, targetTeam, resolvedPeriod],
  );

  if (periods.length === 0 || !resolvedPeriod) return null;

  return (
    <article className="trend-chart-card">
      <div className="trend-chart-header">
        <div className="trend-chart-title-row">
          <h3>Maintain / Run / Growth</h3>
          <span className="trend-source-badge">Jira</span>
        </div>
        <p className="trend-chart-description">
          Share of logged worklog hours by Work Type category ({periodLabel(resolvedPeriod)}), for{" "}
          {targetTeam === "EDU" ? "the EDU portfolio" : targetTeam}.
        </p>
      </div>
      <div className="trend-chart-period-row">
        <label className="trends-toolbar-label" htmlFor={`mrg-period-${targetTeam}`}>
          Period
        </label>
        <select
          id={`mrg-period-${targetTeam}`}
          className="period-dropdown"
          value={resolvedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
        >
          {periods.map((period) => (
            <option key={period} value={period}>
              {periodLabel(period)}
            </option>
          ))}
        </select>
      </div>
      <div className="trend-chart-body">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(109,40,217,0.08)" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#6b5a8d" }} axisLine={{ stroke: "rgba(109,40,217,0.14)" }} />
            <YAxis
              tick={{ fontSize: 12, fill: "#6b5a8d" }}
              axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
              unit="%"
              domain={[0, (dataMax: number) => Math.max(100, Math.ceil(dataMax / 10) * 10)]}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, _name, item) => [`${Number(value ?? 0).toFixed(1)}%`, item?.payload?.label ?? ""]}
            />
            <Bar dataKey="value" name="Share of logged hours" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={MRG_COLORS[entry.name]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

export default MrgMixChart;

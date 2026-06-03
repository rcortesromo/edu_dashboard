import { useMemo } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  mttrMetricName,
  mttrAvgMetricName,
  mttrTicketsMetricName,
  formatBusinessHours,
  type MetricsPayload,
  type SprintInfo,
} from "../lib/metrics";
import { getPeriodMapping, type ViewMode } from "../lib/trends";

type MttrPoint = {
  quarter: string;
  tickets: number;
  mttr: number | null;
  mttrAvg: number | null;
};

type MttrTrendChartProps = {
  payload: MetricsPayload;
  viewMode: ViewMode;
  selectedYear: number;
  selectedQuarter?: string;
  sprintLookup?: Map<string, SprintInfo>;
  title: string;
  description: string;
  // When set, plot a single team's values. When omitted, plot the EDU rollup across all teams.
  team?: string;
};

function buildPoints(
  payload: MetricsPayload,
  viewMode: ViewMode,
  selectedYear: number,
  selectedQuarter: string | undefined,
  sprintLookup: Map<string, SprintInfo> | undefined,
  team: string | undefined,
): MttrPoint[] {
  const { periodFilter, xLabel } = getPeriodMapping(viewMode, selectedYear, selectedQuarter, sprintLookup);

  const allPeriods = [...new Set([...payload.quarters, ...payload.metrics.map((m) => m.quarter)])]
    .filter(periodFilter)
    .sort();

  if (team) {
    return allPeriods.map((period) => {
      const ticketRec = payload.metrics.find(
        (m) => m.team === team && m.quarter === period && m.metricName === mttrTicketsMetricName,
      );
      const mttrRec = payload.metrics.find(
        (m) => m.team === team && m.quarter === period && m.metricName === mttrMetricName,
      );
      const mttrAvgRec = payload.metrics.find(
        (m) => m.team === team && m.quarter === period && m.metricName === mttrAvgMetricName,
      );
      const tickets = ticketRec?.value ?? 0;
      return {
        quarter: xLabel(period),
        tickets,
        mttr: tickets > 0 && mttrRec ? mttrRec.value : null,
        mttrAvg: tickets > 0 && mttrAvgRec ? mttrAvgRec.value : null,
      };
    });
  }

  // EDU rollup: bars = sum of tickets across teams; lines = ticket-weighted median/average so adding
  // more service desks later aggregates correctly (not an average of team averages). Today Revtrak is
  // the only team in scope, so EDU equals Revtrak; the weighting matters once CXP is added.
  const teams = [...new Set(payload.metrics.map((m) => m.team))].filter((t) => t !== "EDU");
  return allPeriods.map((period) => {
    let tickets = 0;
    let weightedMedian = 0;
    let weightedAvg = 0;
    for (const t of teams) {
      const ticketRec = payload.metrics.find(
        (m) => m.team === t && m.quarter === period && m.metricName === mttrTicketsMetricName,
      );
      const mttrRec = payload.metrics.find(
        (m) => m.team === t && m.quarter === period && m.metricName === mttrMetricName,
      );
      const mttrAvgRec = payload.metrics.find(
        (m) => m.team === t && m.quarter === period && m.metricName === mttrAvgMetricName,
      );
      const teamTickets = ticketRec?.value ?? 0;
      if (teamTickets > 0 && mttrRec) {
        tickets += teamTickets;
        weightedMedian += mttrRec.value * teamTickets;
        weightedAvg += (mttrAvgRec?.value ?? mttrRec.value) * teamTickets;
      }
    }
    return {
      quarter: xLabel(period),
      tickets,
      mttr: tickets > 0 ? weightedMedian / tickets : null,
      mttrAvg: tickets > 0 ? weightedAvg / tickets : null,
    };
  });
}

function MttrTrendChart({
  payload,
  viewMode,
  selectedYear,
  selectedQuarter,
  sprintLookup,
  title,
  description,
  team,
}: MttrTrendChartProps) {
  const data = useMemo(
    () => buildPoints(payload, viewMode, selectedYear, selectedQuarter, sprintLookup, team),
    [payload, viewMode, selectedYear, selectedQuarter, sprintLookup, team],
  );

  // Hide the chart when there is no MTTR data (e.g. teams without a Service Desk).
  if (data.length === 0 || !data.some((point) => point.tickets > 0)) return null;

  const isSprintView = viewMode === "sprint";
  const xTickFormatter = isSprintView ? (value: string) => String(value).split(" (")[0] : undefined;
  const xInterval = isSprintView ? 0 : undefined;

  return (
    <article className="trend-chart-card">
      <div className="trend-chart-header">
        <div className="trend-chart-title-row">
          <h3>{title}</h3>
          <span className="trend-source-badge">Jira</span>
        </div>
        <p className="trend-chart-description">{description}</p>
      </div>
      <div className="trend-chart-body">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(109,40,217,0.08)" />
            <XAxis
              dataKey="quarter"
              tick={{ fontSize: 12, fill: "#6b5a8d" }}
              axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
              tickFormatter={xTickFormatter}
              interval={xInterval}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 12, fill: "#6b5a8d" }}
              axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
              allowDecimals={false}
              label={{ value: "tickets", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#6b5a8d" } }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 12, fill: "#6b5a8d" }}
              axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
              tickFormatter={(value: number) => (value < 24 ? `${Math.round(value)}h` : `${(value / 24).toFixed(1)}d`)}
              label={{ value: "MTTR", angle: 90, position: "insideRight", style: { fontSize: 11, fill: "#6b5a8d" } }}
            />
            <Tooltip
              contentStyle={{
                background: "#ffffff",
                border: "1px solid rgba(109,40,217,0.14)",
                borderRadius: 12,
                fontSize: 13,
              }}
              formatter={(value, name) =>
                name === "Median time to resolve" || name === "Average time to resolve"
                  ? [typeof value === "number" ? formatBusinessHours(value) : "-", name]
                  : [value, name]
              }
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Bar
              yAxisId="left"
              dataKey="tickets"
              name="No. of tickets"
              fill="#a78bfa"
              radius={[3, 3, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="mttrAvg"
              name="Average time to resolve"
              stroke="#f0abab"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 3, strokeWidth: 1 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="mttr"
              name="Median time to resolve"
              stroke="#dc2626"
              strokeWidth={2.5}
              dot={{ r: 4, strokeWidth: 2 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

export default MttrTrendChart;

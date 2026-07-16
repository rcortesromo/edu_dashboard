import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  deploymentMetricName,
  metricDescriptions,
  type MetricsPayload,
  type SprintInfo,
} from "../lib/metrics";
import {
  getChartPeriods,
  getPeriodMapping,
  teamColors,
  teamDisplayMap,
  type ViewMode,
} from "../lib/trends";

type ChartDataPoint = {
  quarter: string;
  [teamKey: string]: number | string;
};

type MetricTrendChartProps = {
  payload: MetricsPayload;
  metricName: string;
  viewMode: ViewMode;
  selectedYear: number;
  selectedQuarter?: string;
  sprintLookup?: Map<string, SprintInfo>;
  team?: string;
};

function buildChartData({
  payload,
  metricName,
  viewMode,
  selectedYear,
  selectedQuarter,
  sprintLookup,
  team,
}: MetricTrendChartProps): { data: ChartDataPoint[]; teams: string[] } {
  const { xLabel } = getPeriodMapping(viewMode, selectedYear, selectedQuarter, sprintLookup);
  const periods = getChartPeriods(payload, viewMode, selectedYear, selectedQuarter, sprintLookup);
  const teams = team
    ? [team]
    : [
        ...new Set(
          payload.metrics
            .filter((metric) => metric.metricName === metricName && periods.includes(metric.quarter))
            .map((metric) => metric.team),
        ),
      ].filter((teamName) => teamName !== "EDU");

  return {
    teams,
    data: periods.map((period) => {
      const point: ChartDataPoint = { quarter: xLabel(period) };
      for (const teamName of teams) {
        const record = payload.metrics.find(
          (metric) =>
            metric.team === teamName &&
            metric.quarter === period &&
            metric.metricName === metricName,
        );
        point[teamName] = record?.value ?? 0;
      }
      return point;
    }),
  };
}

function unitLabel(metricName: string) {
  if (metricName === deploymentMetricName) return "deployments";
  if (metricName.includes("(weeks)")) return "weeks";
  if (metricName.includes("(points")) return "pts";
  if (metricName.includes("%") || metricName.includes("Coverage") || metricName.includes("Rate")) {
    return "%";
  }
  return "";
}

function MetricTrendChart(props: MetricTrendChartProps) {
  const { payload, metricName, viewMode, team } = props;
  const { data, teams } = useMemo(
    () => buildChartData(props),
    [
      payload,
      metricName,
      viewMode,
      props.selectedYear,
      props.selectedQuarter,
      props.sprintLookup,
      team,
    ],
  );
  const source = useMemo(
    () => payload.metrics.find((metric) => metric.metricName === metricName && metric.source)?.source ?? "",
    [payload, metricName],
  );

  if (data.length === 0 || teams.length === 0) return null;

  const label = unitLabel(metricName);
  const useBar = metricName === deploymentMetricName || metricName === "AI Active Developers" || viewMode === "ytd";
  const sprintView = viewMode === "sprint";
  const xTickFormatter = sprintView ? (value: string) => String(value).split(" (")[0] : undefined;
  const xInterval = sprintView ? 0 : undefined;
  const commonAxis = {
    tick: { fontSize: 12, fill: "#6b5a8d" },
    axisLine: { stroke: "rgba(109,40,217,0.14)" },
  };

  const chartChildren = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(109,40,217,0.08)" />
      <XAxis
        dataKey="quarter"
        {...commonAxis}
        tickFormatter={xTickFormatter}
        interval={xInterval}
      />
      <YAxis
        {...commonAxis}
        allowDecimals={metricName !== deploymentMetricName}
        label={
          label
            ? {
                value: label,
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "#6b5a8d" },
              }
            : undefined
        }
      />
      <Tooltip
        contentStyle={{
          background: "#ffffff",
          border: "1px solid rgba(109,40,217,0.14)",
          borderRadius: 12,
          fontSize: 13,
        }}
      />
      <Legend
        wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        formatter={(value: string) => teamDisplayMap[value] ?? value}
      />
      {teams.map((teamName) =>
        useBar ? (
          <Bar
            key={teamName}
            dataKey={teamName}
            name={teamName}
            fill={teamColors[teamName] ?? "#6d28d9"}
            radius={[4, 4, 0, 0]}
          />
        ) : (
          <Line
            key={teamName}
            type="monotone"
            dataKey={teamName}
            name={teamName}
            stroke={teamColors[teamName] ?? "#6d28d9"}
            strokeWidth={2.5}
            dot={{ r: 4, strokeWidth: 2 }}
            activeDot={{ r: 6 }}
          />
        ),
      )}
    </>
  );

  return (
    <article className="trend-chart-card">
      <div className="trend-chart-header">
        <div className="trend-chart-title-row">
          <h3>{metricName}</h3>
          {source ? <span className="trend-source-badge">{source}</span> : null}
        </div>
        <p className="trend-chart-description">
          {team ? `${teamDisplayMap[team] ?? team}. ` : ""}
          {metricDescriptions[metricName] ?? ""}
        </p>
      </div>
      <div className="trend-chart-body">
        <ResponsiveContainer width="100%" height={280}>
          {useBar ? (
            <BarChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              {chartChildren}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              {chartChildren}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </article>
  );
}

export default MetricTrendChart;

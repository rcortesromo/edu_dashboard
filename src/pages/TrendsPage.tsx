import { Fragment, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { trendsMetricOrder, metricDescriptions, formatDateRange, getSprintsForQuarter, severityCountMetricNames, type MetricsPayload, type SprintInfo } from "../lib/metrics";

type TrendsPageProps = {
  payload: MetricsPayload | null;
  loading: boolean;
  error: string;
};

type ViewMode = "year" | "all-quarters" | "ytd" | "sprint";

// All metrics now have sprint-level data (Jira from sprint computation, AI/Cursor from pull scripts)

const teamDisplayMap: Record<string, string> = {
  EDU: "EDU",
  "Team Connexpoint": "CXP",
  "Team Webstore": "Revtrak",
  ASAP: "ASAP",
  Smartcare: "Smartcare",
  SmartCare: "Smartcare",
};

const teamColors: Record<string, string> = {
  EDU: "#6d28d9",
  "Team Connexpoint": "#2563eb",
  "Team Webstore": "#059669",
  ASAP: "#d97706",
  Smartcare: "#dc2626",
};

type ChartDataPoint = {
  quarter: string;
  [teamKey: string]: number | string;
};

function getAvailableYears(payload: MetricsPayload): number[] {
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

function getPeriodMapping(
  viewMode: ViewMode,
  selectedYear: number,
  selectedQuarter?: string,
  sprintLookup?: Map<string, SprintInfo>,
): { periodFilter: (q: string) => boolean; xLabel: (q: string) => string } {
  if (viewMode === "sprint" && selectedQuarter) {
    return {
      periodFilter: (q) => {
        const match = /^(\d{4}-Q[1-4])-S\d+$/.exec(q);
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

function buildChartData(
  payload: MetricsPayload,
  metricName: string,
  viewMode: ViewMode,
  selectedYear: number,
  selectedQuarter?: string,
  sprintLookup?: Map<string, SprintInfo>,
): { data: ChartDataPoint[]; teams: string[] } {
  const { periodFilter, xLabel } = getPeriodMapping(viewMode, selectedYear, selectedQuarter, sprintLookup);

  const allPeriods = [
    ...new Set([
      ...payload.quarters,
      ...payload.metrics.map((m) => m.quarter),
    ]),
  ]
    .filter(periodFilter)
    .sort();

  const relevantTeams = [
    ...new Set(
      payload.metrics
        .filter((m) => m.metricName === metricName && periodFilter(m.quarter))
        .map((m) => m.team),
    ),
  ].filter((t) => t !== "EDU");

  const data: ChartDataPoint[] = allPeriods.map((period) => {
    const point: ChartDataPoint = { quarter: xLabel(period) };
    for (const team of relevantTeams) {
      const record = payload.metrics.find(
        (m) => m.team === team && m.quarter === period && m.metricName === metricName,
      );
      point[team] = record?.value ?? 0;
    }
    return point;
  });

  return { data, teams: relevantTeams };
}

function getUnitLabel(metricName: string): string {
  if (metricName.includes("(weeks)")) return "weeks";
  if (metricName.includes("(points")) return "pts";
  if (metricName.includes("%") || metricName.includes("Coverage") || metricName.includes("Rate"))
    return "%";
  return "";
}

function isBarMetric(metricName: string, viewMode: ViewMode): boolean {
  return metricName === "AI Active Developers" || viewMode === "ytd";
}

function MetricChart({
  payload,
  metricName,
  viewMode,
  selectedYear,
  selectedQuarter,
  sprintLookup,
}: {
  payload: MetricsPayload;
  metricName: string;
  viewMode: ViewMode;
  selectedYear: number;
  selectedQuarter?: string;
  sprintLookup?: Map<string, SprintInfo>;
}) {
  const { data, teams } = useMemo(
    () => buildChartData(payload, metricName, viewMode, selectedYear, selectedQuarter, sprintLookup),
    [payload, metricName, viewMode, selectedYear, selectedQuarter, sprintLookup],
  );

  const source = useMemo(() => {
    const record = payload.metrics.find((m) => m.metricName === metricName && m.source);
    return record?.source ?? "";
  }, [payload, metricName]);

  if (data.length === 0 || teams.length === 0) return null;

  const unitLabel = getUnitLabel(metricName);
  const useBar = isBarMetric(metricName, viewMode);
  const isSprintView = viewMode === "sprint";
  const xTickFormatter = isSprintView ? (value: string) => String(value).split(" (")[0] : undefined;
  const xInterval = isSprintView ? 0 : undefined;

  return (
    <article className="trend-chart-card">
      <div className="trend-chart-header">
        <div className="trend-chart-title-row">
          <h3>{metricName}</h3>
          {source && <span className="trend-source-badge">{source}</span>}
        </div>
        <p className="trend-chart-description">
          {metricDescriptions[metricName] ?? ""}
        </p>
      </div>
      <div className="trend-chart-body">
        <ResponsiveContainer width="100%" height={280}>
          {useBar ? (
            <BarChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(109,40,217,0.08)" />
              <XAxis
                dataKey="quarter"
                tick={{ fontSize: 12, fill: "#6b5a8d" }}
                axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
                tickFormatter={xTickFormatter}
                interval={xInterval}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#6b5a8d" }}
                axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
                label={unitLabel ? { value: unitLabel, angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#6b5a8d" } } : undefined}
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
              {teams.map((team) => (
                <Bar
                  key={team}
                  dataKey={team}
                  name={team}
                  fill={teamColors[team] ?? "#6d28d9"}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(109,40,217,0.08)" />
              <XAxis
                dataKey="quarter"
                tick={{ fontSize: 12, fill: "#6b5a8d" }}
                axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
                tickFormatter={xTickFormatter}
                interval={xInterval}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#6b5a8d" }}
                axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
                label={unitLabel ? { value: unitLabel, angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#6b5a8d" } } : undefined}
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
              {teams.map((team) => (
                <Line
                  key={team}
                  type="monotone"
                  dataKey={team}
                  name={team}
                  stroke={teamColors[team] ?? "#6d28d9"}
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </article>
  );
}

const [SEV1_METRIC, SEV2_METRIC] = severityCountMetricNames;

function buildSeverityChartData(
  payload: MetricsPayload,
  viewMode: ViewMode,
  selectedYear: number,
  selectedQuarter?: string,
  sprintLookup?: Map<string, SprintInfo>,
): { data: ChartDataPoint[]; teams: string[] } {
  const { periodFilter, xLabel } = getPeriodMapping(viewMode, selectedYear, selectedQuarter, sprintLookup);

  const allPeriods = [
    ...new Set([...payload.quarters, ...payload.metrics.map((m) => m.quarter)]),
  ]
    .filter(periodFilter)
    .sort();

  const teams = [
    ...new Set(
      payload.metrics
        .filter(
          (m) =>
            (m.metricName === SEV1_METRIC || m.metricName === SEV2_METRIC) && periodFilter(m.quarter),
        )
        .map((m) => m.team),
    ),
  ].filter((t) => t !== "EDU");

  const data: ChartDataPoint[] = allPeriods.map((period) => {
    const point: ChartDataPoint = { quarter: xLabel(period) };
    for (const team of teams) {
      const sev1 = payload.metrics.find(
        (m) => m.team === team && m.quarter === period && m.metricName === SEV1_METRIC,
      );
      const sev2 = payload.metrics.find(
        (m) => m.team === team && m.quarter === period && m.metricName === SEV2_METRIC,
      );
      point[`${team}__s1`] = sev1?.value ?? 0;
      point[`${team}__s2`] = sev2?.value ?? 0;
    }
    return point;
  });

  return { data, teams };
}

function SeverityTrendChart({
  payload,
  viewMode,
  selectedYear,
  selectedQuarter,
  sprintLookup,
}: {
  payload: MetricsPayload;
  viewMode: ViewMode;
  selectedYear: number;
  selectedQuarter?: string;
  sprintLookup?: Map<string, SprintInfo>;
}) {
  const { data, teams } = useMemo(
    () => buildSeverityChartData(payload, viewMode, selectedYear, selectedQuarter, sprintLookup),
    [payload, viewMode, selectedYear, selectedQuarter, sprintLookup],
  );

  if (data.length === 0 || teams.length === 0) return null;

  const isSprintView = viewMode === "sprint";
  const xTickFormatter = isSprintView ? (value: string) => String(value).split(" (")[0] : undefined;
  const xInterval = isSprintView ? 0 : undefined;

  return (
    <article className="trend-chart-card">
      <div className="trend-chart-header">
        <div className="trend-chart-title-row">
          <h3>Sev 1 &amp; Sev 2 Bugs</h3>
          <span className="trend-source-badge">Jira</span>
        </div>
        <p className="trend-chart-description">
          High-severity bug counts per team: one solid line for Sev 1 and one dashed line for Sev 2.
        </p>
      </div>
      <div className="trend-chart-body">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(109,40,217,0.08)" />
            <XAxis
              dataKey="quarter"
              tick={{ fontSize: 12, fill: "#6b5a8d" }}
              axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
              tickFormatter={xTickFormatter}
              interval={xInterval}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#6b5a8d" }}
              axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
              allowDecimals={false}
              label={{ value: "bugs", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "#6b5a8d" } }}
            />
            <Tooltip
              contentStyle={{
                background: "#ffffff",
                border: "1px solid rgba(109,40,217,0.14)",
                borderRadius: 12,
                fontSize: 13,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            {teams.flatMap((team) => {
              const color = teamColors[team] ?? "#6d28d9";
              return [
                <Bar
                  key={`${team}__s1`}
                  dataKey={`${team}__s1`}
                  name={`${teamDisplayMap[team] ?? team} Sev 1`}
                  fill={color}
                  radius={[3, 3, 0, 0]}
                />,
                <Bar
                  key={`${team}__s2`}
                  dataKey={`${team}__s2`}
                  name={`${teamDisplayMap[team] ?? team} Sev 2`}
                  fill={color}
                  fillOpacity={0.4}
                  radius={[3, 3, 0, 0]}
                />,
              ];
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function getAvailableQuarters(payload: MetricsPayload): string[] {
  const quarters = new Set<string>();
  for (const q of payload.quarters) {
    if (/^\d{4}-Q[1-4]$/.test(q)) quarters.add(q);
  }
  return [...quarters].sort().reverse();
}

function TrendsPage({ payload, loading, error }: TrendsPageProps) {
  const availableYears = useMemo(() => (payload ? getAvailableYears(payload) : []), [payload]);
  const availableQuarters = useMemo(() => (payload ? getAvailableQuarters(payload) : []), [payload]);
  const [viewMode, setViewMode] = useState<ViewMode>("sprint");
  const [selectedYear, setSelectedYear] = useState<number>(() => availableYears[0] ?? new Date().getFullYear());
  const [selectedQuarter, setSelectedQuarter] = useState<string>(() => availableQuarters[0] ?? "");

  const resolvedYear = availableYears.includes(selectedYear)
    ? selectedYear
    : availableYears[0] ?? new Date().getFullYear();

  const resolvedQuarter = availableQuarters.includes(selectedQuarter)
    ? selectedQuarter
    : availableQuarters[0] ?? "";

  const sprintLookup = useMemo(() => {
    if (!payload || viewMode !== "sprint" || !resolvedQuarter) return undefined;
    const sprints = getSprintsForQuarter(payload, resolvedQuarter);
    const map = new Map<string, SprintInfo>();
    for (const s of sprints) map.set(s.key, s);
    return map;
  }, [payload, viewMode, resolvedQuarter]);

  const availableMetrics = useMemo(() => {
    if (!payload) return [];
    const metricNames = [...new Set(payload.metrics.map((m) => m.metricName))];
    return trendsMetricOrder.filter((name) => metricNames.includes(name));
  }, [payload]);

  const hasSeverityData = useMemo(
    () =>
      Boolean(payload) &&
      payload!.metrics.some((m) => m.metricName === SEV1_METRIC || m.metricName === SEV2_METRIC),
    [payload],
  );

  return (
    <main className="content-shell trends-shell">
      <section className="panel">
        <div className="section-heading">
          <span className="hero-tag">Trends</span>
          <h2>Delivery pulse</h2>
          <p>Visual evolution of each metric across quarters, by delivery team.</p>
        </div>

        <div className="trends-toolbar">
          <div className="trends-toolbar-group">
            <label className="trends-toolbar-label" htmlFor="trend-view-mode">View</label>
            <select
              id="trend-view-mode"
              className="period-dropdown"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
            >
              <option value="year">By Year</option>
              <option value="all-quarters">All Quarters</option>
              <option value="ytd">Year-to-Date</option>
              <option value="sprint">By Sprint</option>
            </select>
          </div>

          {viewMode === "year" && availableYears.length > 0 && (
            <div className="trends-toolbar-group">
              <label className="trends-toolbar-label" htmlFor="trend-year">Year</label>
              <select
                id="trend-year"
                className="period-dropdown"
                value={resolvedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          )}

          {viewMode === "sprint" && availableQuarters.length > 0 && (
            <div className="trends-toolbar-group">
              <label className="trends-toolbar-label" htmlFor="trend-quarter">Quarter</label>
              <select
                id="trend-quarter"
                className="period-dropdown"
                value={resolvedQuarter}
                onChange={(e) => setSelectedQuarter(e.target.value)}
              >
                {availableQuarters.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading ? <div className="state-card">Loading metrics data...</div> : null}
        {!loading && error ? <div className="state-card state-card-error">{error}</div> : null}

        {!loading && !error && payload ? (
          <div className="trends-grid">
            {availableMetrics.map((metricName) => (
              <Fragment key={metricName}>
                <MetricChart
                  payload={payload}
                  metricName={metricName}
                  viewMode={viewMode}
                  selectedYear={resolvedYear}
                  selectedQuarter={viewMode === "sprint" ? resolvedQuarter : undefined}
                  sprintLookup={sprintLookup}
                />
                {metricName === "Defect Leakage %" && hasSeverityData && (
                  <SeverityTrendChart
                    payload={payload}
                    viewMode={viewMode}
                    selectedYear={resolvedYear}
                    selectedQuarter={viewMode === "sprint" ? resolvedQuarter : undefined}
                    sprintLookup={sprintLookup}
                  />
                )}
              </Fragment>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default TrendsPage;

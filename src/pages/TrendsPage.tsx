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
import { trendsMetricOrder, metricDescriptions, getSprintsForQuarter, severityCountMetricNames, severityRootCauseMetricNames, type MetricsPayload, type SprintInfo } from "../lib/metrics";
import { getAvailableQuarters, getAvailableYears, getPeriodMapping, teamColors, teamDisplayMap, type ViewMode } from "../lib/trends";

type TrendsPageProps = {
  payload: MetricsPayload | null;
  loading: boolean;
  error: string;
};

// All metrics now have sprint-level data (Jira from sprint computation, AI/Cursor from pull scripts)

type ChartDataPoint = {
  quarter: string;
  [teamKey: string]: number | string;
};

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
): { data: ChartDataPoint[] } {
  const { periodFilter, xLabel } = getPeriodMapping(viewMode, selectedYear, selectedQuarter, sprintLookup);

  const allPeriods = [
    ...new Set([...payload.quarters, ...payload.metrics.map((m) => m.quarter)]),
  ]
    .filter(periodFilter)
    .sort();

  // EDU is the vertical that groups every delivery team, so its value for a
  // metric/period is the sum of that metric across all individual teams.
  const eduValue = (period: string, metricName: string): number =>
    payload.metrics
      .filter(
        (m) => m.team !== "EDU" && m.quarter === period && m.metricName === metricName,
      )
      .reduce((sum, m) => sum + (m.value ?? 0), 0);

  const data: ChartDataPoint[] = allPeriods.map((period) => ({
    quarter: xLabel(period),
    sev1: eduValue(period, SEV1_METRIC),
    sev2: eduValue(period, SEV2_METRIC),
  }));

  return { data };
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
  const { data } = useMemo(
    () => buildSeverityChartData(payload, viewMode, selectedYear, selectedQuarter, sprintLookup),
    [payload, viewMode, selectedYear, selectedQuarter, sprintLookup],
  );

  if (data.length === 0) return null;

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
          High-severity bug counts for EDU overall: one bar for Sev 1 and one bar for Sev 2 per period.
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
            <Bar
              dataKey="sev1"
              name="Sev 1"
              fill="#dc2626"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              dataKey="sev2"
              name="Sev 2"
              fill="#f59e0b"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

const [SEV1_INTERNAL_METRIC, SEV1_EXTERNAL_METRIC, SEV2_INTERNAL_METRIC, SEV2_EXTERNAL_METRIC] =
  severityRootCauseMetricNames;

type RootCausePoint = {
  quarter: string;
  sev1Internal: number;
  sev1External: number;
  sev2Internal: number;
  sev2External: number;
};

function buildSeverityRootCauseData(
  payload: MetricsPayload,
  viewMode: ViewMode,
  selectedYear: number,
  selectedQuarter?: string,
  sprintLookup?: Map<string, SprintInfo>,
): RootCausePoint[] {
  const { periodFilter, xLabel } = getPeriodMapping(viewMode, selectedYear, selectedQuarter, sprintLookup);

  const allPeriods = [
    ...new Set([...payload.quarters, ...payload.metrics.map((m) => m.quarter)]),
  ]
    .filter(periodFilter)
    .sort();

  // EDU is the vertical that groups every delivery team: sum each metric across all teams.
  const eduValue = (period: string, metricName: string): number =>
    payload.metrics
      .filter(
        (m) => m.team !== "EDU" && m.quarter === period && m.metricName === metricName,
      )
      .reduce((sum, m) => sum + (m.value ?? 0), 0);

  return allPeriods.map((period) => ({
    quarter: xLabel(period),
    sev1Internal: eduValue(period, SEV1_INTERNAL_METRIC),
    sev1External: eduValue(period, SEV1_EXTERNAL_METRIC),
    sev2Internal: eduValue(period, SEV2_INTERNAL_METRIC),
    sev2External: eduValue(period, SEV2_EXTERNAL_METRIC),
  }));
}

function SeverityRootCauseChart({
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
  const data = useMemo(
    () => buildSeverityRootCauseData(payload, viewMode, selectedYear, selectedQuarter, sprintLookup),
    [payload, viewMode, selectedYear, selectedQuarter, sprintLookup],
  );

  if (data.length === 0) return null;

  const isSprintView = viewMode === "sprint";
  const xTickFormatter = isSprintView ? (value: string) => String(value).split(" (")[0] : undefined;
  const xInterval = isSprintView ? 0 : undefined;

  return (
    <article className="trend-chart-card">
      <div className="trend-chart-header">
        <div className="trend-chart-title-row">
          <h3>Sev 1 &amp; Sev 2 Bugs by Root Cause</h3>
          <span className="trend-source-badge">Jira</span>
        </div>
        <p className="trend-chart-description">
          EDU overall, split by Root Cause: External = "Third Party", Internal = any other root cause.
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
            <Bar dataKey="sev1Internal" name="Sev 1 Internal" fill="#dc2626" radius={[3, 3, 0, 0]} />
            <Bar dataKey="sev1External" name="Sev 1 External" fill="#2563eb" radius={[3, 3, 0, 0]} />
            <Bar dataKey="sev2Internal" name="Sev 2 Internal" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            <Bar dataKey="sev2External" name="Sev 2 External" fill="#059669" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
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

  const hasRootCauseData = useMemo(
    () =>
      Boolean(payload) &&
      payload!.metrics.some((m) =>
        (severityRootCauseMetricNames as readonly string[]).includes(m.metricName),
      ),
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
                {metricName === "Defect Leakage %" && hasRootCauseData && (
                  <SeverityRootCauseChart
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

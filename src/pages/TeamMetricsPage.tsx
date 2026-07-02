import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getSprintsForQuarter, metricDescriptions, mttrMetricName, severityRootCauseMetricNames, type MetricsPayload, type SprintInfo } from "../lib/metrics";
import {
  getAvailableQuarters,
  getAvailableTeams,
  getAvailableYears,
  getChartPeriods,
  getPeriodMapping,
  teamDisplayMap,
  type ViewMode,
} from "../lib/trends";
import MttrTrendChart from "../components/MttrTrendChart";
import MrgMixChart from "../components/MrgMixChart";

type TeamMetricsPageProps = {
  payload: MetricsPayload | null;
  loading: boolean;
  error: string;
};

const [SEV1_INTERNAL_METRIC, SEV1_EXTERNAL_METRIC, SEV2_INTERNAL_METRIC, SEV2_EXTERNAL_METRIC] =
  severityRootCauseMetricNames;

type SeverityLevelPoint = {
  quarter: string;
  internal: number;
  external: number;
};

function buildTeamSeverityLevelData(
  payload: MetricsPayload,
  team: string,
  internalMetric: string,
  externalMetric: string,
  viewMode: ViewMode,
  selectedYear: number,
  selectedQuarter?: string,
  sprintLookup?: Map<string, SprintInfo>,
): SeverityLevelPoint[] {
  const { xLabel } = getPeriodMapping(viewMode, selectedYear, selectedQuarter, sprintLookup);

  const allPeriods = getChartPeriods(payload, viewMode, selectedYear, selectedQuarter, sprintLookup);

  const valueFor = (period: string, metricName: string): number => {
    const record = payload.metrics.find(
      (m) => m.team === team && m.quarter === period && m.metricName === metricName,
    );
    return record?.value ?? 0;
  };

  return allPeriods.map((period) => ({
    quarter: xLabel(period),
    internal: valueFor(period, internalMetric),
    external: valueFor(period, externalMetric),
  }));
}

function TeamSeverityLevelChart({
  payload,
  team,
  title,
  internalMetric,
  externalMetric,
  internalColor,
  externalColor,
  viewMode,
  selectedYear,
  selectedQuarter,
  sprintLookup,
}: {
  payload: MetricsPayload;
  team: string;
  title: string;
  internalMetric: string;
  externalMetric: string;
  internalColor: string;
  externalColor: string;
  viewMode: ViewMode;
  selectedYear: number;
  selectedQuarter?: string;
  sprintLookup?: Map<string, SprintInfo>;
}) {
  const data = useMemo(
    () =>
      buildTeamSeverityLevelData(
        payload,
        team,
        internalMetric,
        externalMetric,
        viewMode,
        selectedYear,
        selectedQuarter,
        sprintLookup,
      ),
    [payload, team, internalMetric, externalMetric, viewMode, selectedYear, selectedQuarter, sprintLookup],
  );

  if (data.length === 0) return null;

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
        <p className="trend-chart-description">
          {teamDisplayMap[team] ?? team}, split by Root Cause: External = "Third Party", Internal = any other root cause.
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
            <Bar dataKey="internal" name="Internal" fill={internalColor} radius={[3, 3, 0, 0]} />
            <Bar dataKey="external" name="External" fill={externalColor} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function TeamMetricsPage({ payload, loading, error }: TeamMetricsPageProps) {
  const availableYears = useMemo(() => (payload ? getAvailableYears(payload) : []), [payload]);
  const availableQuarters = useMemo(() => (payload ? getAvailableQuarters(payload) : []), [payload]);
  const availableTeams = useMemo(() => (payload ? getAvailableTeams(payload) : []), [payload]);

  const [viewMode, setViewMode] = useState<ViewMode>("sprint");
  const [selectedYear, setSelectedYear] = useState<number>(() => availableYears[0] ?? new Date().getFullYear());
  const [selectedQuarter, setSelectedQuarter] = useState<string>(() => availableQuarters[0] ?? "");
  const [selectedTeam, setSelectedTeam] = useState<string>(() => availableTeams[0] ?? "");

  const resolvedYear = availableYears.includes(selectedYear)
    ? selectedYear
    : availableYears[0] ?? new Date().getFullYear();

  const resolvedQuarter = availableQuarters.includes(selectedQuarter)
    ? selectedQuarter
    : availableQuarters[0] ?? "";

  const resolvedTeam = availableTeams.includes(selectedTeam) ? selectedTeam : availableTeams[0] ?? "";

  const sprintLookup = useMemo(() => {
    if (!payload || viewMode !== "sprint" || !resolvedQuarter) return undefined;
    const sprints = getSprintsForQuarter(payload, resolvedQuarter);
    const map = new Map<string, SprintInfo>();
    for (const s of sprints) map.set(s.key, s);
    return map;
  }, [payload, viewMode, resolvedQuarter]);

  return (
    <main className="content-shell trends-shell">
      <section className="panel">
        <div className="section-heading">
          <span className="hero-tag">Team Metrics</span>
          <h2>Delivery pulse by team</h2>
          <p>Visual evolution of each metric across periods, for a single delivery team.</p>
        </div>

        <div className="trends-toolbar">
          <div className="trends-toolbar-group">
            <label className="trends-toolbar-label" htmlFor="team-trend-team">Team</label>
            <select
              id="team-trend-team"
              className="period-dropdown"
              value={resolvedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
            >
              {availableTeams.map((team) => (
                <option key={team} value={team}>
                  {teamDisplayMap[team] ?? team}
                </option>
              ))}
            </select>
          </div>

          <div className="trends-toolbar-group">
            <label className="trends-toolbar-label" htmlFor="team-trend-view-mode">View</label>
            <select
              id="team-trend-view-mode"
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
              <label className="trends-toolbar-label" htmlFor="team-trend-year">Year</label>
              <select
                id="team-trend-year"
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
              <label className="trends-toolbar-label" htmlFor="team-trend-quarter">Quarter</label>
              <select
                id="team-trend-quarter"
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

        {!loading && !error && payload && resolvedTeam ? (
          <div className="trends-grid">
            <MrgMixChart payload={payload} team={resolvedTeam} />
            <TeamSeverityLevelChart
              payload={payload}
              team={resolvedTeam}
              title="Sev 1 Bugs (Internal & External)"
              internalMetric={SEV1_INTERNAL_METRIC}
              externalMetric={SEV1_EXTERNAL_METRIC}
              internalColor="#dc2626"
              externalColor="#2563eb"
              viewMode={viewMode}
              selectedYear={resolvedYear}
              selectedQuarter={viewMode === "sprint" ? resolvedQuarter : undefined}
              sprintLookup={sprintLookup}
            />
            <TeamSeverityLevelChart
              payload={payload}
              team={resolvedTeam}
              title="Sev 2 Bugs (Internal & External)"
              internalMetric={SEV2_INTERNAL_METRIC}
              externalMetric={SEV2_EXTERNAL_METRIC}
              internalColor="#f59e0b"
              externalColor="#059669"
              viewMode={viewMode}
              selectedYear={resolvedYear}
              selectedQuarter={viewMode === "sprint" ? resolvedQuarter : undefined}
              sprintLookup={sprintLookup}
            />
            <MttrTrendChart
              payload={payload}
              team={resolvedTeam}
              viewMode={viewMode}
              selectedYear={resolvedYear}
              selectedQuarter={viewMode === "sprint" ? resolvedQuarter : undefined}
              sprintLookup={sprintLookup}
              title="Mean time to resolve (Sev 1 + Sev 2)"
              description={metricDescriptions[mttrMetricName] ?? ""}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default TeamMetricsPage;

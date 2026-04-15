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
  teams: string[];
  quarters: string[];
  metrics: MetricRecord[];
};

export type TeamSummary = {
  teamKey: string;
  teamLabel: string;
  quarter: string;
  lastRefreshUtc: string;
  metrics: MetricRecord[];
};

export const metricDescriptions: Record<string, string> = {
  "Jira Card Churn %":
    "Share of sprint-committed work that left the plan, was re-pointed, or moved backward after sprint start.",
  "Average Velocity (points per sprint)":
    "Average completed story points per sprint across the quarter for the team.",
  "Flow-based Cycle Time Proxy (weeks)":
    "Flow-health signal from average WIP vs completed cards per sprint; lower usually means healthier flow.",
  "Actual Cycle Time (weeks)":
    "Average real elapsed time from active work start until the item is done in Jira with resolution Done.",
};

export const metricDisplayOrder = [
  "Jira Card Churn %",
  "Average Velocity (points per sprint)",
  "Flow-based Cycle Time Proxy (weeks)",
  "Actual Cycle Time (weeks)",
];

const teamDisplayMap: Record<string, string> = {
  "Team Connexpoint": "CXP",
  "Team Webstore": "Revtrak",
};

const teamDisplayOrder = ["Team Connexpoint", "Team Webstore"];

function formatMetricValue(metric: MetricRecord) {
  if (metric.unit === "percent") {
    return `${metric.value.toFixed(2)}%`;
  }

  if (metric.unit === "weeks") {
    return `${metric.value.toFixed(2)} wks`;
  }

  if (metric.unit === "points") {
    return `${metric.value.toFixed(2)} pts`;
  }

  return String(metric.value);
}

export function buildTeamSummaries(payload: MetricsPayload | null) {
  if (!payload) {
    return [];
  }

  return teamDisplayOrder.map((teamKey) => {
    const teamMetrics = payload.metrics
      .filter((metric) => metric.team === teamKey)
      .sort(
        (left, right) =>
          metricDisplayOrder.indexOf(left.metricName) - metricDisplayOrder.indexOf(right.metricName),
      );

    return {
      teamKey,
      teamLabel: teamDisplayMap[teamKey] ?? teamKey,
      quarter: teamMetrics[0]?.quarter ?? payload.quarters[0] ?? "Quarter unavailable",
      lastRefreshUtc: teamMetrics[0]?.lastRefreshUtc ?? "",
      metrics: teamMetrics,
    };
  });
}

function MetricsView({
  teams,
  loading,
  error,
}: {
  teams: TeamSummary[];
  loading: boolean;
  error: string;
}) {
  const hasAnyMetrics = teams.some((team) => team.metrics.length > 0);
  const visibleTeams = teams.filter((team) => team.metrics.length > 0);
  const activeQuarter = visibleTeams[0]?.quarter ?? "Quarter unavailable";

  return (
    <main className="content-shell metrics-shell">
      <section className="panel">
        <div className="section-heading">
          <span className="hero-tag">Quarter Snapshot</span>
          <h2>{activeQuarter} delivery briefing</h2>
        </div>

        {loading ? <div className="state-card">Loading metrics from the published JSON feed.</div> : null}

        {!loading && error ? <div className="state-card state-card-error">{error}</div> : null}

        {!loading && !error && !hasAnyMetrics ? (
          <div className="state-card">No team metrics are available yet in the published JSON feed.</div>
        ) : null}

        {!loading && !error && hasAnyMetrics ? (
          <div className="quarter-report">
            <div className="team-section-list">
              {teams.map((team) => (
                <section key={team.teamKey} className="team-section">
                  <div className="team-section-header">
                    <div>
                      <p className="team-card-tag">Team snapshot</p>
                      <h3>{team.teamLabel}</h3>
                    </div>
                    <div className="team-meta">
                      <span><strong>{team.quarter}</strong></span>
                    </div>
                  </div>

                  <div className="team-metrics">
                    {team.metrics.length > 0 ? (
                      team.metrics.map((metric, index) => (
                        <article key={metric.metricName} className={`team-metric-card metric-tone-${(index % 3) + 1}`}>
                          <div className="team-metric-card-header">
                            <p className="team-metric-kicker"></p>
                            <span className="team-metric-source">Source:{metric.source}</span>
                          </div>

                          <div className="team-metric-copy">
                            <p className="team-metric-name">{metric.metricName}</p>
                            <p className="team-metric-description">
                              {metricDescriptions[metric.metricName] ?? metric.note}
                            </p>
                          </div>

                          <div className="team-metric-value">
                            <strong>{formatMetricValue(metric)}</strong>
                            <span>{team.quarter}</span>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="state-card state-card-inline">
                        No current metrics are available for {team.teamLabel}.
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default MetricsView;

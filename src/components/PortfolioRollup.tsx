import { formatMetricValue, type TeamSummary } from "../lib/metrics";

function portfolioMetricHint(metricName: string) {
  if (metricName === "Jira Card Churn %") {
    return "Weighted by committed work";
  }

  if (metricName === "Average Velocity (points per sprint)") {
    return "Weighted by team sprint count";
  }

  if (metricName === "Flow-based Cycle Time Proxy (weeks)") {
    return "Rebuilt from total WIP and throughput";
  }

  if (metricName === "Actual Cycle Time (weeks)") {
    return "Weighted by completed items";
  }

  return "Portfolio rollup";
}

type PortfolioRollupProps = {
  portfolioTeam: TeamSummary;
  deliveryTeams: TeamSummary[];
};

function PortfolioRollup({ portfolioTeam, deliveryTeams }: PortfolioRollupProps) {
  return (
    <section className="portfolio-rollup">
      <div className="portfolio-header">
        <div>
          <p className="team-card-tag">Portfolio rollup</p>
          <h3>{portfolioTeam.teamLabel} aggregate</h3>
          <p className="portfolio-description">
            {deliveryTeams.map((team) => team.teamLabel).join(" + ") || "All delivery teams"}
          </p>
        </div>

        <div className="portfolio-meta">
          <span>{deliveryTeams.length} teams in scope</span>
          <span>{portfolioTeam.periodLabel}</span>
        </div>
      </div>

      <div className="portfolio-metrics">
        {portfolioTeam.metrics.map((metric) => (
          <article key={metric.metricName} className="portfolio-metric-card">
            <div className="portfolio-metric-copy">
              <p className="team-metric-name">{metric.metricName}</p>
              <p className="portfolio-metric-hint">{portfolioMetricHint(metric.metricName)}</p>
            </div>

            <div className="team-metric-value portfolio-metric-value">
              <strong>{formatMetricValue(metric)}</strong>
              <span>{portfolioTeam.periodLabel}</span>
            </div>

          </article>
        ))}
      </div>
    </section>
  );
}

export default PortfolioRollup;

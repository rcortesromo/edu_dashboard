import PeriodSelector from "../components/PeriodSelector";
import { formatMetricValue, getPeriodOption, type PeriodOption, type TeamSummary } from "../lib/metrics";

type MetricsPageProps = {
  teams: TeamSummary[];
  loading: boolean;
  error: string;
  periodOptions: PeriodOption[];
  selectedPeriod: string;
  onSelectPeriod: (periodKey: string) => void;
};

function MetricsPage({
  teams,
  loading,
  error,
  periodOptions,
  selectedPeriod,
  onSelectPeriod,
}: MetricsPageProps) {
  const activePeriod = getPeriodOption(periodOptions, selectedPeriod);
  const hasAnyMetrics = teams.some((team) => team.metrics.length > 0);
  const visibleTeams = teams.filter((team) => team.metrics.length > 0);
  const deliveryTeams = visibleTeams.filter((team) => !team.isPortfolio);
  const headingLabel = activePeriod?.kind === "ytd" ? "Year-to-date summary" : "Delivery briefing";

  return (
    <main className="content-shell metrics-shell">
      <section className="panel">
        <div className="section-heading section-heading-with-selector">
          <div>
            <span className="hero-tag">Delivery Detail</span>
            <h2>{activePeriod ? `${activePeriod.label} ${headingLabel}` : "Delivery briefing"}</h2>
            <p>Every team snapshot below follows the same selected period as the EDU rollup.</p>
          </div>
          <PeriodSelector
            options={periodOptions}
            selectedPeriod={selectedPeriod}
            onSelectPeriod={onSelectPeriod}
          />
        </div>

        {activePeriod?.isInProgress ? (
          <div className="state-card period-state-card">
            Current quarter is still in progress. Values reflect work completed or observed so far.
          </div>
        ) : null}

        {loading ? <div className="state-card">Loading metrics from the published JSON feed.</div> : null}
        {!loading && error ? <div className="state-card state-card-error">{error}</div> : null}
        {!loading && !error && !hasAnyMetrics ? (
          <div className="state-card">No team metrics are available yet in the published JSON feed.</div>
        ) : null}

        {!loading && !error && hasAnyMetrics ? (
          <div className="quarter-report">
            <div className="team-section-list">
              {deliveryTeams.map((team) => (
                <section key={team.teamKey} className="team-section">
                  <div className="team-section-header">
                    <div>
                      <p className="team-card-tag">Team snapshot</p>
                      <h3>{team.teamLabel}</h3>
                    </div>
                    <div className="team-meta">
                      <span>
                        <strong>{team.periodLabel}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="team-metrics">
                    {team.metrics.map((metric, index) => (
                      <article
                        key={metric.metricName}
                        className={`team-metric-card metric-tone-${(index % 3) + 1}`}
                      >
                        <div className="team-metric-card-header">
                          <p className="team-metric-kicker">{activePeriod?.kind === "ytd" ? "YTD" : "Snapshot"}</p>
                          <span className="team-metric-source">Source: {metric.source}</span>
                        </div>

                        <div className="team-metric-copy">
                          <p className="team-metric-name">{metric.metricName}</p>
                        </div>

                        <div className="team-metric-value">
                          <strong>{formatMetricValue(metric)}</strong>
                          <span>{team.periodLabel}</span>
                        </div>
                      </article>
                    ))}
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

export default MetricsPage;

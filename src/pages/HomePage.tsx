import { Link } from "react-router-dom";
import PeriodSelector from "../components/PeriodSelector";
import PortfolioRollup from "../components/PortfolioRollup";
import {
  getPeriodOption,
  metricDescriptions,
  metricDisplayOrder,
  type PeriodOption,
  type TeamSummary,
} from "../lib/metrics";

type HomePageProps = {
  teams: TeamSummary[];
  loading: boolean;
  error: string;
  periodOptions: PeriodOption[];
  selectedPeriod: string;
  onSelectPeriod: (periodKey: string) => void;
};

function HomePage({
  teams,
  loading,
  error,
  periodOptions,
  selectedPeriod,
  onSelectPeriod,
}: HomePageProps) {
  const activePeriod = getPeriodOption(periodOptions, selectedPeriod);
  const portfolioTeam = teams.find((team) => team.isPortfolio && team.metrics.length > 0);
  const deliveryTeams = teams.filter((team) => !team.isPortfolio && team.metrics.length > 0);
  const hasAnyMetrics = teams.some((team) => team.metrics.length > 0);
  const heroQualifier =
    activePeriod?.kind === "ytd"
      ? "year-to-date"
      : activePeriod?.isInProgress
        ? "quarter-to-date"
        : "quarter";

  return (
    <main className="hero">
      <section className="hero-card">
        <span className="hero-tag">Executive Delivery Snapshot</span>
        <h2>{activePeriod ? `${activePeriod.label} ${heroQualifier} view for EDU` : "EDU delivery overview"}</h2>
        <p>
          This dashboard summarizes backlog stability, completed sprint velocity, system flow, and actual
          delivery for CXP and Revtrak.
        </p>

        <div className="hero-actions">
          <Link to="/metrics" className="primary-action">
            Open Team Metrics
          </Link>
        </div>
      </section>

      <section className="content-shell home-details">
        <div className="panel">
          <div className="section-heading">
            <span className="hero-tag">Current Scope</span>
            <h2>What the selected period tells us</h2>
            <p>Compare the latest quarter snapshot with prior quarters or a backend-derived YTD rollup.</p>
          </div>

          <section className="period-toolbar" aria-label="Selected reporting period">
            <div className="period-toolbar-copy">
              <p className="metric-explainer-label">Reporting Period</p>
              <h3>{activePeriod?.label ?? "Choose a period"}</h3>
              <p className="metric-reference-intro">
                Quarter views stay isolated. YTD uses backend rollups so portfolio math stays accurate.
              </p>
            </div>
            <PeriodSelector
              options={periodOptions}
              selectedPeriod={selectedPeriod}
              onSelectPeriod={onSelectPeriod}
            />
          </section>

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

          {!loading && !error && portfolioTeam ? (
            <div className="home-portfolio-wrap">
              <PortfolioRollup portfolioTeam={portfolioTeam} deliveryTeams={deliveryTeams} />
            </div>
          ) : null}

          <article className="metric-reference-card">
            <div className="metric-reference-header">
              <div>
                <p className="metric-explainer-label">Metric Reference</p>
                <h3>How to read each metric</h3>
              </div>
            </div>

            <div className="metric-reference-list">
              {metricDisplayOrder.map((metricName) => (
                <div key={metricName} className="metric-reference-item">
                  <h4>{metricName}</h4>
                  <p>{metricDescriptions[metricName]}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}

export default HomePage;

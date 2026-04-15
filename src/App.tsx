import { useEffect, useMemo, useState } from "react";
import TopBar from "./components/TopBar";
import MetricsView, {
  PortfolioRollup,
  buildTeamSummaries,
  metricDescriptions,
  metricDisplayOrder,
  type MetricsPayload,
  type TeamSummary,
} from "./metrics.tsx";

type ViewKey = "home" | "metrics";

function HomeView({
  onOpenMetrics,
  teams,
}: {
  onOpenMetrics: () => void;
  teams: TeamSummary[];
}) {
  const portfolioTeam = teams.find((team) => team.isPortfolio && team.metrics.length > 0);
  const deliveryTeams = teams.filter((team) => !team.isPortfolio && team.metrics.length > 0);

  return (
    <main className="hero">
      <section className="hero-card">
        <span className="hero-tag">Executive Delivery Snapshot</span>
        <h2>Quarter-to-date Jira metrics for CXP and Revtrak</h2>
        <p>
          This dashboard summarizes backlog stability, completed sprint velocity, system flow, and actual delivery.
        </p>

        <div className="hero-actions">
          <button type="button" className="primary-action" onClick={onOpenMetrics}>
            Open Metrics
          </button>
        </div>
      </section>

      <section className="content-shell home-details">
        <div className="panel">
          <div className="section-heading">
            <span className="hero-tag">Current Scope</span>
            <h2>What the current metrics tell us</h2>
            <p>
              These are the current quarter-level measures automated from Jira.
            </p>
          </div>

          {portfolioTeam ? (
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
              {metricDisplayOrder.map((metricName: string) => (
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

function App() {
  const [activeView, setActiveView] = useState<ViewKey>("home");
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("./data/metrics.generated.json");

        if (!response.ok) {
          throw new Error("Published metrics feed is unavailable.");
        }

        const data = (await response.json()) as MetricsPayload;

        if (!cancelled) {
          setPayload(data);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Unable to load the published metrics feed.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMetrics();

    return () => {
      cancelled = true;
    };
  }, []);

  const teamSummaries = useMemo(() => buildTeamSummaries(payload), [payload]);

  const currentView = useMemo(() => {
    if (activeView === "metrics") {
      return <MetricsView teams={teamSummaries} loading={loading} error={error} />;
    }

    return <HomeView onOpenMetrics={() => setActiveView("metrics")} teams={teamSummaries} />;
  }, [activeView, error, loading, teamSummaries]);

  return (
    <div className="app-shell">
      <TopBar activeView={activeView} onNavigate={setActiveView} />
      {currentView}
    </div>
  );
}

export default App;

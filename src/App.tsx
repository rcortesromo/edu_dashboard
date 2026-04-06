import { useEffect, useMemo, useState } from "react";
import TopBar from "./components/TopBar";
import MetricsView, {
  buildTeamSummaries,
  metricDescriptions,
  metricDisplayOrder,
  type MetricsPayload,
} from "./metrics.tsx";

type ViewKey = "home" | "metrics";

function HomeView({
  onOpenMetrics,
}: {
  onOpenMetrics: () => void;
}) {
  return (
    <main className="hero">
      <section className="hero-card">
        <span className="hero-tag">Executive Delivery Snapshot</span>
        <h2>Quarter-to-date Jira metrics for CXP and Revtrak</h2>
        <p>
          This dashboard summarizes backlog stability, system flow, and actual delivery.
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
              These are the three quarter-level measures currently automated from Jira.
            </p>
          </div>

          <div className="metric-summary-grid">
            {metricDisplayOrder.map((metricName: string, index: number) => (
              <article key={metricName} className={`metric-summary-card metric-summary-tone-${(index % 3) + 1}`}>
                <div className="metric-summary-heading">
                  <p className="metric-explainer-label">Metric</p>
                  <h3>{metricName}</h3>
                </div>
                <p className="metric-summary-description">{metricDescriptions[metricName]}</p>
              </article>
            ))}
          </div>
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

    return <HomeView onOpenMetrics={() => setActiveView("metrics")} />;
  }, [activeView, error, loading, teamSummaries]);

  return (
    <div className="app-shell">
      <TopBar activeView={activeView} onNavigate={setActiveView} />
      {currentView}
    </div>
  );
}

export default App;

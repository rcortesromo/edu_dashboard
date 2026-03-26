import { useMemo, useState } from "react";
import TopBar from "./components/TopBar";

type ViewKey = "home" | "metrics";

const metricPreview = [
  {
    name: "Cycle Time Reduction",
    status: "Yes (partial)",
    source: "Jira",
  },
  {
    name: "Jira Card Churn",
    status: "Yes (partial)",
    source: "Jira",
  },
  {
    name: "Customer Satisfaction",
    status: "No",
    source: "Survey tool",
  },
];

function HomeView({ onOpenMetrics }: { onOpenMetrics: () => void }) {
  return (
    <main className="hero">
      <section className="hero-card">
        <span className="hero-tag">Static SharePoint Pilot</span>
        <h2>Executive dashboard landing page</h2>
        <p>
          This React and TypeScript starter mirrors the kind of structure we
          would use for the real dashboard while still compiling to static files
          that can be tested in SharePoint.
        </p>

        <div className="hero-actions">
          <button type="button" className="primary-action" onClick={onOpenMetrics}>
            Open Dashboard
          </button>
          <a href="#" className="secondary-action">
            View Data Sources
          </a>
        </div>
      </section>
    </main>
  );
}

function MetricsView() {
  return (
    <main className="content-shell">
      <section className="panel">
        <div className="section-heading">
          <span className="hero-tag">Preview</span>
          <h2>Metrics coverage preview</h2>
          <p>
            This second view shows how the app can evolve into a modular
            executive dashboard fed by Excel, JSON, or Power Automate later.
          </p>
        </div>

        <div className="kpi-grid">
          <article className="kpi-card">
            <span className="kpi-label">Metrics in scope</span>
            <strong>6</strong>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Automated</span>
            <strong>2</strong>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Partial</span>
            <strong>2</strong>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Manual</span>
            <strong>2</strong>
          </article>
        </div>

        <div className="table-card">
          <div className="table-header">
            <h3>Sample metric registry</h3>
            <span className="table-note">Mock data for SharePoint validation</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Automation</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {metricPreview.map((metric) => (
                  <tr key={metric.name}>
                    <td>{metric.name}</td>
                    <td>
                      <span className="status-pill">{metric.status}</span>
                    </td>
                    <td>{metric.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [activeView, setActiveView] = useState<ViewKey>("home");

  const currentView = useMemo(() => {
    if (activeView === "metrics") {
      return <MetricsView />;
    }

    return <HomeView onOpenMetrics={() => setActiveView("metrics")} />;
  }, [activeView]);

  return (
    <div className="app-shell">
      <TopBar activeView={activeView} onNavigate={setActiveView} />
      {currentView}
    </div>
  );
}

export default App;

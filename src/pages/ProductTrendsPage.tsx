import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatCycleLabel,
  formatNumber,
  useFeatheryCycleSelection,
  useFeatheryProducts,
  type FeatheryClient,
} from "../lib/feathery";

const PALETTE = ["#6d28d9", "#2563eb", "#059669", "#d97706", "#dc2626", "#0891b2", "#7c3aed", "#db2777"];

const TOP_N_OPTIONS = [10, 20, 50, "all"] as const;
type TopCount = (typeof TOP_N_OPTIONS)[number];

const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid rgba(109,40,217,0.14)",
  borderRadius: 12,
  fontSize: 13,
} as const;

function ProductTrendsPage() {
  const { cycles, selectedEntry, setSelectedFolder, productsUrl } = useFeatheryCycleSelection();
  const { payload, loading, error } = useFeatheryProducts(productsUrl);
  const [topMetric, setTopMetric] = useState<"submissions" | "totalForms">("submissions");
  const [topCount, setTopCount] = useState<TopCount>(10);

  const formComposition = useMemo(() => {
    if (!payload) return [];
    const totals = payload.totals;
    return [
      { name: "Active", value: totals.activeForms },
      { name: "Inactive", value: totals.inactiveForms },
    ];
  }, [payload]);

  const featureUsage = useMemo(() => {
    if (!payload) return [];
    const totals = payload.totals;
    return [
      { name: "Multi-step", value: totals.multiStepForms },
      { name: "eSignature", value: totals.formsWithESignature },
      { name: "Upload", value: totals.formsWithUpload },
      { name: "Payments", value: totals.formsWithPayments },
    ];
  }, [payload]);

  const topClients = useMemo(() => {
    if (!payload) return [];
    const key: keyof FeatheryClient = topMetric;
    const sorted = [...payload.clients].sort(
      (a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0)
    );
    const limited =
      topCount === "all"
        ? sorted.filter(
            (client) =>
              (Number(client.submissions) || 0) > 0 &&
              (Number(client.totalForms) || 0) > 0
          )
        : sorted.slice(0, topCount);
    return limited.map((client) => ({
      name: client.name || "(unnamed)",
      value: Number(client[key]) || 0,
    }));
  }, [payload, topMetric, topCount]);

  return (
    <main className="content-shell products-shell trends-shell">
      <section className="panel">
        <div className="section-heading section-heading-with-selector">
          <div>
            <span className="hero-tag">Products</span>
            <h2>RevTrak Forms Usage Charts</h2>
            <p>
              Visual breakdown of client usage of RevTrak Forms.
              {selectedEntry
                ? selectedEntry.folder === "all-time"
                  ? ` Aggregated across all billing cycles (${formatCycleLabel(selectedEntry)}).`
                  : ` Billing cycle: ${formatCycleLabel(selectedEntry)}${selectedEntry.current ? " (current)" : ""}.`
                : ""}
            </p>
          </div>
          <div className="period-toolbar">
            {cycles.length ? (
              <select
                className="period-dropdown"
                value={selectedEntry?.folder ?? ""}
                onChange={(event) => setSelectedFolder(event.target.value)}
                aria-label="Billing cycle"
              >
                {cycles.map((cycle) => (
                  <option key={cycle.folder} value={cycle.folder}>
                    {cycle.current ? `${formatCycleLabel(cycle)} (current)` : formatCycleLabel(cycle)}
                  </option>
                ))}
              </select>
            ) : null}
            <Link to="/business-metrics/feathery" className="primary-action">
              Back to Usage Overview
            </Link>
          </div>
        </div>

        {loading ? <div className="state-card">Loading Feathery products feed.</div> : null}
        {!loading && error ? <div className="state-card state-card-error">{error}</div> : null}

        {!loading && !error && payload ? (
          <div className="trends-grid">
            <article className="trend-chart-card">
              <div className="trend-chart-header">
                <div className="trend-chart-title-row">
                  <h3>Form status</h3>
                </div>
                <p className="trend-chart-description">
                  Active vs inactive forms across all workspaces.
                </p>
              </div>
              <div className="trend-chart-body">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={formComposition}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                    >
                      {formComposition.map((entry, index) => (
                        <Cell key={entry.name} fill={PALETTE[index % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatNumber(Number(value))} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="trend-chart-card">
              <div className="trend-chart-header">
                <div className="trend-chart-title-row">
                  <h3>Forms by feature</h3>
                </div>
                <p className="trend-chart-description">
                  Number of forms embedding each Feathery element type.
                </p>
              </div>
              <div className="trend-chart-body">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={featureUsage} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(109,40,217,0.08)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#6b5a8d" }} axisLine={{ stroke: "rgba(109,40,217,0.14)" }} />
                    <YAxis tick={{ fontSize: 12, fill: "#6b5a8d" }} axisLine={{ stroke: "rgba(109,40,217,0.14)" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatNumber(Number(value))} />
                    <Bar dataKey="value" name="Forms" radius={[4, 4, 0, 0]}>
                      {featureUsage.map((entry, index) => (
                        <Cell key={entry.name} fill={PALETTE[index % PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="trend-chart-card products-chart-wide">
              <div className="trend-chart-header trend-chart-header-row">
                <div>
                  <div className="trend-chart-title-row">
                    <h3>Top clients</h3>
                  </div>
                  <p className="trend-chart-description">
                    {topCount === "all" ? "All" : `Top ${topCount}`} workspaces by the selected metric.
                  </p>
                </div>
                <div className="period-toolbar">
                  <select
                    className="period-dropdown"
                    value={topCount}
                    onChange={(event) =>
                      setTopCount(
                        event.target.value === "all"
                          ? "all"
                          : (Number(event.target.value) as TopCount)
                      )
                    }
                  >
                    {TOP_N_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === "all" ? "All clients" : `Top ${option}`}
                      </option>
                    ))}
                  </select>
                  <select
                    className="period-dropdown"
                    value={topMetric}
                    onChange={(event) => setTopMetric(event.target.value as "submissions" | "totalForms")}
                  >
                    <option value="submissions">Submissions</option>
                    <option value="totalForms">Total forms</option>
                  </select>
                </div>
              </div>
              <div className="trend-chart-body">
                <ResponsiveContainer width="100%" height={Math.max(280, topClients.length * 34)}>
                  <BarChart
                    data={topClients}
                    layout="vertical"
                    margin={{ top: 8, right: 32, left: 24, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(109,40,217,0.08)" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "#6b5a8d" }} axisLine={{ stroke: "rgba(109,40,217,0.14)" }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tick={{ fontSize: 12, fill: "#6b5a8d" }}
                      axisLine={{ stroke: "rgba(109,40,217,0.14)" }}
                    />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatNumber(Number(value))} />
                    <Bar dataKey="value" name={topMetric === "submissions" ? "Submissions" : "Total forms"} fill="#6d28d9" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default ProductTrendsPage;

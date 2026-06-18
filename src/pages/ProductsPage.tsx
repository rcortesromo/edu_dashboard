import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildSummaryMetrics,
  formatCycleLabel,
  formatNumber,
  useFeatheryCheckouts,
  useFeatheryCycleSelection,
  useFeatheryProducts,
  type FeatheryClient,
} from "../lib/feathery";

type SortKey = keyof Pick<
  FeatheryClient,
  | "name"
  | "totalForms"
  | "activeForms"
  | "inactiveForms"
  | "multiStepForms"
  | "formsWithPayments"
  | "formsWithESignature"
  | "formsWithUpload"
  | "submissions"
>;

type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Client" },
  { key: "totalForms", label: "Forms" },
  { key: "activeForms", label: "Active" },
  { key: "inactiveForms", label: "Inactive" },
  { key: "multiStepForms", label: "Multi-step" },
  { key: "formsWithPayments", label: "Payments" },
  { key: "formsWithESignature", label: "eSignature" },
  { key: "formsWithUpload", label: "Upload" },
  { key: "submissions", label: "Submissions" },
];

function ProductsPage() {
  const { cycles, selectedEntry, setSelectedFolder, productsUrl, checkoutsUrl } =
    useFeatheryCycleSelection();
  const { payload, loading, error } = useFeatheryProducts(productsUrl);
  const { payload: checkoutsPayload } = useFeatheryCheckouts(checkoutsUrl);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalForms");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const summaryMetrics = useMemo(
    () =>
      payload
        ? buildSummaryMetrics(payload.totals, checkoutsPayload?.currentCycle?.checkouts ?? null)
        : [],
    [payload, checkoutsPayload],
  );

  const visibleClients = useMemo(() => {
    if (!payload) return [];
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? payload.clients.filter((client) => client.name?.toLowerCase().includes(normalized))
      : payload.clients;

    const sorted = [...filtered].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];

      if (typeof aValue === "string" || typeof bValue === "string") {
        const cmp = String(aValue ?? "").localeCompare(String(bValue ?? ""));
        return sortDir === "asc" ? cmp : -cmp;
      }

      const cmp = (Number(aValue) || 0) - (Number(bValue) || 0);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [payload, query, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function handleExportCsv() {
    if (!visibleClients.length) return;

    const escapeCell = (value: string | number) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const header = COLUMNS.map((column) => escapeCell(column.label)).join(",");
    const rows = visibleClients.map((client) =>
      COLUMNS.map((column) =>
        escapeCell(column.key === "name" ? client.name || "(unnamed)" : Number(client[column.key]) || 0)
      ).join(",")
    );
    const csv = [header, ...rows].join("\r\n");

    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `revtrak-forms-by-client-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const isAllTime = selectedEntry?.folder === "all-time";
  const billingLabel = selectedEntry
    ? formatCycleLabel(selectedEntry)
    : payload?.billingCycle?.start && payload?.billingCycle?.end
      ? `${payload.billingCycle.start} to ${payload.billingCycle.end}`
      : null;

  return (
    <main className="content-shell products-shell">
      <section className="panel">
        <div className="section-heading section-heading-with-selector">
          <div>
            <span className="hero-tag">Products</span>
            <h2>RevTrak Forms Usage Overview</h2>
            <p>
              Form and submission usage across all RevTrak workspaces (clients).
              {billingLabel
                ? isAllTime
                  ? ` Submissions and checkouts are summed across all billing cycles (${billingLabel}).`
                  : ` Submissions and checkouts reflect the ${
                      selectedEntry?.current ? "current " : ""
                    }billing cycle (${billingLabel}).`
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
            <Link to="/business-metrics/feathery/trends" className="primary-action">
              View charts
            </Link>
          </div>
        </div>

        {loading ? <div className="state-card">Loading Feathery products feed.</div> : null}
        {!loading && error ? <div className="state-card state-card-error">{error}</div> : null}

        {!loading && !error && payload ? (
          <>
            <div className="kpi-grid products-kpi-grid">
              {summaryMetrics.map((metric) => (
                <article key={metric.label} className="kpi-card">
                  <span className="kpi-label" title={metric.note}>
                    {metric.label}
                  </span>
                  <strong>{formatNumber(metric.value)}</strong>
                  {metric.note ? <span className="kpi-note">{metric.note}</span> : null}
                </article>
              ))}
            </div>

            <div className="table-card">
              <div className="table-header">
                <div>
                  <h3>By client</h3>
                  <p className="table-note">
                    {formatNumber(visibleClients.length)} of {formatNumber(payload.clients.length)} workspaces
                  </p>
                </div>
                <div className="period-toolbar">
                  <input
                    type="search"
                    className="period-dropdown products-search"
                    placeholder="Search client..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <button
                    type="button"
                    className="primary-action"
                    onClick={handleExportCsv}
                    disabled={!visibleClients.length}
                  >
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="table-wrap products-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {COLUMNS.map((column) => {
                        const isActive = column.key === sortKey;
                        return (
                          <th
                            key={column.key}
                            className={`products-th${column.key === "name" ? "" : " products-th-num"}`}
                          >
                            <button
                              type="button"
                              className={`products-sort-btn${isActive ? " active" : ""}`}
                              onClick={() => handleSort(column.key)}
                            >
                              {column.label}
                              {isActive ? (sortDir === "asc" ? " \u2191" : " \u2193") : ""}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleClients.map((client) => (
                      <tr key={client.id}>
                        <td>{client.name || "(unnamed)"}</td>
                        <td className="products-td-num">{formatNumber(client.totalForms)}</td>
                        <td className="products-td-num">{formatNumber(client.activeForms)}</td>
                        <td className="products-td-num">{formatNumber(client.inactiveForms)}</td>
                        <td className="products-td-num">{formatNumber(client.multiStepForms)}</td>
                        <td className="products-td-num">{formatNumber(client.formsWithPayments)}</td>
                        <td className="products-td-num">{formatNumber(client.formsWithESignature)}</td>
                        <td className="products-td-num">{formatNumber(client.formsWithUpload)}</td>
                        <td className="products-td-num">{formatNumber(client.submissions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

export default ProductsPage;

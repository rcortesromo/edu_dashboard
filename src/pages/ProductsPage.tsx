import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildClientTableRows,
  buildSummaryGroups,
  formatCycleLabel,
  formatCurrency,
  formatNumber,
  useFeatheryCheckouts,
  useFeatheryCycleSelection,
  useFeatheryProducts,
  type ClientTableRow,
} from "../lib/feathery";

type SortKey = keyof Pick<
  ClientTableRow,
  | "name"
  | "totalForms"
  | "activeForms"
  | "inactiveForms"
  | "multiStepForms"
  | "formsWithPayments"
  | "formsWithESignature"
  | "formsWithUpload"
  | "submissions"
  | "activeFormsWithoutPayments"
  | "checkouts"
  | "avgFormCost"
>;

type SortDir = "asc" | "desc";

type TableColumn = {
  key: SortKey;
  label: string;
  exportValue: (client: ClientTableRow) => string | number;
  displayValue: (client: ClientTableRow) => string;
};

const COLUMNS: TableColumn[] = [
  {
    key: "name",
    label: "Client",
    exportValue: (client) => client.name || "(unnamed)",
    displayValue: (client) => client.name || "(unnamed)",
  },
  {
    key: "totalForms",
    label: "Forms",
    exportValue: (client) => client.totalForms,
    displayValue: (client) => formatNumber(client.totalForms),
  },
  {
    key: "activeForms",
    label: "Active",
    exportValue: (client) => client.activeForms,
    displayValue: (client) => formatNumber(client.activeForms),
  },
  {
    key: "inactiveForms",
    label: "Inactive",
    exportValue: (client) => client.inactiveForms,
    displayValue: (client) => formatNumber(client.inactiveForms),
  },
  {
    key: "multiStepForms",
    label: "Multi-step",
    exportValue: (client) => client.multiStepForms,
    displayValue: (client) => formatNumber(client.multiStepForms),
  },
  {
    key: "formsWithPayments",
    label: "Payments",
    exportValue: (client) => client.formsWithPayments,
    displayValue: (client) => formatNumber(client.formsWithPayments),
  },
  {
    key: "formsWithESignature",
    label: "eSignature",
    exportValue: (client) => client.formsWithESignature,
    displayValue: (client) => formatNumber(client.formsWithESignature),
  },
  {
    key: "formsWithUpload",
    label: "Upload",
    exportValue: (client) => client.formsWithUpload,
    displayValue: (client) => formatNumber(client.formsWithUpload),
  },
  {
    key: "submissions",
    label: "Submissions",
    exportValue: (client) => client.submissions,
    displayValue: (client) => formatNumber(client.submissions),
  },
  {
    key: "activeFormsWithoutPayments",
    label: "Active w/o payment",
    exportValue: (client) => client.activeFormsWithoutPayments,
    displayValue: (client) => formatNumber(client.activeFormsWithoutPayments),
  },
  {
    key: "checkouts",
    label: "Checkouts",
    exportValue: (client) => client.checkouts,
    displayValue: (client) => formatNumber(client.checkouts),
  },
  {
    key: "avgFormCost",
    label: "Avg cost",
    exportValue: (client) =>
      client.avgFormCost !== null ? Math.round(client.avgFormCost) : "",
    displayValue: (client) => formatCurrency(client.avgFormCost),
  },
];

function ProductsPage() {
  const { cycles, selectedEntry, setSelectedFolder, productsUrl, checkoutsUrl } =
    useFeatheryCycleSelection();
  const { payload, loading, error } = useFeatheryProducts(productsUrl);
  const { payload: checkoutsPayload } = useFeatheryCheckouts(checkoutsUrl);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalForms");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const summaryGroups = useMemo(
    () =>
      payload
        ? buildSummaryGroups(payload.totals, checkoutsPayload?.currentCycle ?? null)
        : [],
    [payload, checkoutsPayload],
  );

  const clientRows = useMemo(
    () =>
      payload
        ? buildClientTableRows(payload.clients, checkoutsPayload?.perWorkspace)
        : [],
    [payload, checkoutsPayload],
  );

  const visibleClients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? clientRows.filter((client) => client.name?.toLowerCase().includes(normalized))
      : clientRows;

    const sorted = [...filtered].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];

      if (typeof aValue === "string" || typeof bValue === "string") {
        const cmp = String(aValue ?? "").localeCompare(String(bValue ?? ""));
        return sortDir === "asc" ? cmp : -cmp;
      }

      const aNumber = aValue === null || aValue === undefined ? -1 : Number(aValue) || 0;
      const bNumber = bValue === null || bValue === undefined ? -1 : Number(bValue) || 0;
      const cmp = aNumber - bNumber;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [clientRows, query, sortKey, sortDir]);

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
      COLUMNS.map((column) => escapeCell(column.exportValue(client))).join(",")
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
            {summaryGroups.map((group) => (
              <div key={group.title} className="kpi-group">
                <h3 className="kpi-group-title">{group.title}</h3>
                <div className="kpi-grid products-kpi-grid">
                  {group.metrics.map((metric) => (
                    <article key={metric.label} className="kpi-card">
                      <span className="kpi-label" title={metric.note}>
                        {metric.label}
                      </span>
                      <strong>{metric.display ?? formatNumber(metric.value)}</strong>
                      {metric.note ? <span className="kpi-note">{metric.note}</span> : null}
                    </article>
                  ))}
                </div>
              </div>
            ))}

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
                        {COLUMNS.map((column) => (
                          <td
                            key={column.key}
                            className={column.key === "name" ? undefined : "products-td-num"}
                          >
                            {column.displayValue(client)}
                          </td>
                        ))}
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

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const backendDir = path.join(repoRoot, "backend/feathery/generated");
const summaryJsonPath = path.join(backendDir, "feathery-refresh-summary.json");
const productsJsonPath = path.join(backendDir, "feathery-products.generated.json");
const checkoutsJsonPath = path.join(backendDir, "feathery-checkouts.generated.json");

const STATUS_LABEL = {
  completed: "ok",
  skipped: "skipped",
  failed: "error",
  error: "error",
  unknown: "unknown",
};

const numberFmt = new Intl.NumberFormat("en-US");
const currencyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function fmtNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return numberFmt.format(Number(value));
}

function fmtCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return currencyFmt.format(Number(value));
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function renderMarkdown(summary, products, checkouts) {
  const lines = [];
  lines.push("## Refresh Feathery — run log");
  lines.push("");
  lines.push(`- Run at: \`${summary?.runAt ?? new Date().toISOString()}\``);
  lines.push(`- Trigger: \`${summary?.trigger ?? process.env.GITHUB_EVENT_NAME ?? "local"}\``);
  const overall = STATUS_LABEL[summary?.status] ?? summary?.status ?? "unknown";
  lines.push(`- Overall: **${overall}**`);
  if (summary?.note) lines.push(`- Note: ${escapeCell(summary.note)}`);
  lines.push("");

  lines.push("### Steps");
  lines.push("");
  lines.push("| Step | Status | Note |");
  lines.push("| --- | --- | --- |");
  for (const source of summary?.sources ?? []) {
    const status = STATUS_LABEL[source.status] ?? source.status;
    const note = escapeCell(source.note) || "-";
    lines.push(`| ${escapeCell(source.name)} | ${status} | ${note} |`);
  }
  lines.push("");

  if (products?.totals) {
    const t = products.totals;
    lines.push("### Products (current snapshot)");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("| --- | --- |");
    lines.push(`| Clients (workspaces) | ${fmtNumber(t.clientsIdentified)} |`);
    lines.push(`| Total forms | ${fmtNumber(t.totalForms)} |`);
    lines.push(`| Active forms | ${fmtNumber(t.activeForms)} |`);
    lines.push(`| Forms with payments | ${fmtNumber(t.formsWithPayments)} |`);
    lines.push(`| Submissions (cycle) | ${fmtNumber(t.submissions)} |`);
    lines.push("");
  }

  if (checkouts) {
    const cov = checkouts.coverage ?? {};
    const label = checkouts.period?.label ?? "";
    lines.push(`### Checkouts${label ? ` (${label})` : ""}`);
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("| --- | --- |");
    lines.push(`| Checkouts | ${fmtNumber(checkouts.currentCycle?.checkouts)} |`);
    lines.push(`| Amount | ${fmtCurrency(checkouts.currentCycle?.amount)} |`);
    lines.push(`| Workspaces with RevTrak | ${fmtNumber(cov.workspacesWithRevtrak)} |`);
    lines.push(`| Workspaces scanned this run | ${fmtNumber(cov.workspacesScanned)} |`);
    lines.push(`| Skipped (no submissions) | ${fmtNumber(cov.skippedNoSubmissions)} |`);
    lines.push(`| Skipped (no change) | ${fmtNumber(cov.skippedNoChange)} |`);
    if (checkouts.timing?.elapsedSeconds !== undefined) {
      lines.push(`| Checkouts pull elapsed | ${fmtNumber(checkouts.timing.elapsedSeconds)} s |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const [summary, products, checkouts] = await Promise.all([
    readJson(summaryJsonPath),
    readJson(productsJsonPath),
    readJson(checkoutsJsonPath),
  ]);

  const markdown = renderMarkdown(summary, products, checkouts);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    await fs.appendFile(summaryFile, `${markdown}\n`, "utf8");
  }
  console.log(markdown);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const refreshSummaryPath = path.join(repoRoot, "backend/published/refresh-summary.json");

const STATUS_ICON = {
  completed: "ok",
  skipped: "skipped",
  error: "error",
  unknown: "unknown",
};

function renderMarkdown(summary) {
  const lines = [];
  lines.push("## Refresh Metrics — run log");
  lines.push("");
  lines.push(`- Run at: \`${summary.runAt}\``);
  lines.push(`- Trigger: \`${summary.trigger}\``);
  lines.push(`- Data changed: **${summary.dataChanged ? "yes" : "no"}**`);
  lines.push("");
  lines.push("| Source | Status | Note |");
  lines.push("| --- | --- | --- |");
  for (const source of summary.sources ?? []) {
    const status = STATUS_ICON[source.status] ?? source.status;
    const note = (source.note ?? "").replace(/\|/g, "\\|") || "-";
    lines.push(`| ${source.name} | ${status} | ${note} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  let summary;
  try {
    summary = JSON.parse(await fs.readFile(refreshSummaryPath, "utf8"));
  } catch {
    summary = {
      runAt: new Date().toISOString(),
      trigger: process.env.GITHUB_EVENT_NAME || "local",
      dataChanged: false,
      sources: [],
    };
  }

  const markdown = renderMarkdown(summary);
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

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const summaryPath = path.join(
  repoRoot,
  "backend/feathery/generated/feathery-refresh-summary.json",
);

function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`${path.basename(scriptPath)} exited with code ${code ?? "unknown"}.`),
      );
    });
  });
}

// Minimal .env.local reader: the Feathery pulls only need FEATHERY_TOKEN. We
// check it here so a missing token becomes a clean skip instead of two failing
// child processes.
function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

async function writeSummary(status, sources, note = "") {
  const summary = {
    runAt: new Date().toISOString(),
    trigger: process.env.GITHUB_EVENT_NAME || "local",
    status,
    note,
    sources,
  };
  await fs.mkdir(path.dirname(summaryPath), { recursive: true });
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

async function main() {
  const env = parseEnv(await fs.readFile(envPath, "utf8").catch(() => ""));

  if (!env.FEATHERY_TOKEN) {
    // No credentials: skip cleanly so the workflow does not fail.
    await writeSummary(
      "skipped",
      [
        { name: "feathery-products", status: "skipped", note: "missing FEATHERY_TOKEN" },
        { name: "feathery-checkouts", status: "skipped", note: "missing FEATHERY_TOKEN" },
      ],
      "missing FEATHERY_TOKEN in .env.local",
    );
    console.warn("No FEATHERY_TOKEN in .env.local — skipping Feathery refresh.");
    return;
  }

  const forwardedArgs = process.argv.slice(2);
  const sources = [];

  // 1) Products snapshot (forms/submissions aggregates, full snapshot each run).
  await runNodeScript(path.join(__dirname, "pull-feathery-products.mjs"), forwardedArgs);
  sources.push({ name: "feathery-products", status: "completed", note: "" });

  // 2) Checkouts (incremental: no --reset, reuses the committed checkpoint).
  await runNodeScript(path.join(__dirname, "pull-feathery-checkouts.mjs"), forwardedArgs);
  sources.push({ name: "feathery-checkouts", status: "completed", note: "incremental" });

  // 3) Archive the current cycle snapshot + rebuild the cycle index/All-time
  //    aggregate that powers the billing-cycle selector in the dashboard.
  await runNodeScript(path.join(__dirname, "archive-feathery-cycles.mjs"));
  sources.push({ name: "feathery-cycles-archive", status: "completed", note: "" });

  const summary = await writeSummary("completed", sources);
  console.log(JSON.stringify({ summaryPath, sources: summary.sources }, null, 2));
}

main().catch(async (error) => {
  await writeSummary(
    "failed",
    [{ name: "feathery", status: "failed", note: error.message }],
    error.message,
  ).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
});

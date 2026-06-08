import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const generatedJsonPath = path.join(repoRoot, "backend/published/json/metrics.generated.json");
const generatedCsvPath = path.join(repoRoot, "backend/published/generated/json_export_view.csv");
const publicJsonPath = path.join(repoRoot, "public/data/metrics.generated.json");
const refreshSummaryPath = path.join(repoRoot, "backend/published/refresh-summary.json");

const aiSummaryPath = path.join(repoRoot, "backend/ai/generated/github-scope-summary.json");
const cursorSummaryPath = path.join(repoRoot, "backend/cursor/generated/cursor-scope-summary.json");

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

      reject(new Error(`Script failed: ${path.basename(scriptPath)} exited with code ${code ?? "unknown"}.`));
    });
  });
}

// Best-effort runner: logs and swallows failures instead of aborting the whole
// refresh. Used for optional sources (e.g. Feathery) whose credentials may be
// absent in some environments and that are independent of the merged pipeline.
function runNodeScriptBestEffort(scriptPath, args = []) {
  return runNodeScript(scriptPath, args).then(
    () => true,
    (error) => {
      console.warn(`Skipping ${path.basename(scriptPath)}: ${error.message}`);
      return false;
    },
  );
}

function hasArg(argv, name) {
  return argv.some((entry) => entry === name || entry.startsWith(`${name}=`));
}

function getArgValue(argv, name) {
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === name) {
      return argv[index + 1] ?? "";
    }
    if (entry.startsWith(`${name}=`)) {
      return entry.slice(`${name}=`.length);
    }
  }
  return "";
}

function stripArg(argv, name) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === name) {
      index += 1; // also drop the value token
      continue;
    }
    if (entry.startsWith(`${name}=`)) {
      continue;
    }
    result.push(entry);
  }
  return result;
}

// Reads a per-source scope summary file (written by the AI/Cursor pulls) and
// normalizes it into the consolidated refresh log shape. Missing/unreadable
// files are reported rather than throwing, so the log is always complete.
async function readSourceSummary(summaryPath, name) {
  try {
    const parsed = JSON.parse(await fs.readFile(summaryPath, "utf8"));
    return {
      name,
      status: parsed.status ?? "unknown",
      note: parsed.note ?? "",
    };
  } catch {
    return {
      name,
      status: "unknown",
      note: `No summary file at ${path.relative(repoRoot, summaryPath)}`,
    };
  }
}

async function writeRefreshSummary(sources, dataChanged) {
  const summary = {
    runAt: new Date().toISOString(),
    trigger: process.env.GITHUB_EVENT_NAME || "local",
    dataChanged,
    sources,
  };
  await fs.mkdir(path.dirname(refreshSummaryPath), { recursive: true });
  await fs.writeFile(refreshSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

// Sources that support being run in isolation via `--only <source>`.
const ONLY_SOURCES = {
  "defect-leakage": "jira/pull-defect-leakage.mjs",
  mttr: "jira/pull-mttr.mjs",
};

async function main() {
  const rawArgs = process.argv.slice(2);
  const onlySource = getArgValue(rawArgs, "--only");

  if (onlySource) {
    const scriptRelPath = ONLY_SOURCES[onlySource];
    if (!scriptRelPath) {
      throw new Error(
        `Unknown --only source "${onlySource}". Supported: ${Object.keys(ONLY_SOURCES).join(", ")}.`,
      );
    }

    const forwardedArgs = stripArg(rawArgs, "--only");
    await runNodeScript(path.join(__dirname, scriptRelPath), forwardedArgs);
    await runNodeScript(path.join(__dirname, "published/merge-metric-sources.mjs"));
    await runNodeScript(path.join(__dirname, "published/export-metrics-json.mjs"), [
      generatedCsvPath,
      generatedJsonPath,
    ]);

    await fs.mkdir(path.dirname(publicJsonPath), { recursive: true });
    await fs.copyFile(generatedJsonPath, publicJsonPath);

    console.log(
      JSON.stringify({ only: onlySource, generatedJsonPath, publicJsonPath }, null, 2),
    );
    return;
  }

  const pullArgs = rawArgs;
  const isTeamScoped = hasArg(pullArgs, "--team");

  await runNodeScript(path.join(__dirname, "jira/pull-quarterly-metrics.mjs"), pullArgs);
  await runNodeScript(path.join(__dirname, "jira/compute-sprint-level-metrics.mjs"));
  await runNodeScript(path.join(__dirname, "jira/pull-defect-leakage.mjs"), pullArgs);
  await runNodeScript(path.join(__dirname, "jira/pull-mttr.mjs"), pullArgs);

  let featheryRefreshed = false;
  if (!isTeamScoped) {
    await runNodeScript(path.join(__dirname, "ai/pull-adoption-metrics.mjs"), pullArgs);
    await runNodeScript(path.join(__dirname, "cursor/pull-cursor-metrics.mjs"), pullArgs);
    // Feathery is a self-contained snapshot (writes its own public JSON) and is
    // optional: a missing FEATHERY_TOKEN must not fail the rest of the refresh.
    featheryRefreshed = await runNodeScriptBestEffort(
      path.join(__dirname, "feathery/pull-feathery-products.mjs"),
    );
  }

  await runNodeScript(path.join(__dirname, "published/merge-metric-sources.mjs"));
  await runNodeScript(path.join(__dirname, "published/export-metrics-json.mjs"), [
    generatedCsvPath,
    generatedJsonPath,
  ]);

  // Determine whether the published payload actually changed by comparing the
  // freshly generated JSON against the currently published copy before we
  // overwrite it. This drives the conditional commit in CI.
  const dataChanged = await hasPublishedJsonChanged();

  await fs.mkdir(path.dirname(publicJsonPath), { recursive: true });
  await fs.copyFile(generatedJsonPath, publicJsonPath);

  const sources = [
    { name: "jira-quarterly", status: "completed", note: "" },
    { name: "sprint", status: "completed", note: "" },
    { name: "defect-leakage", status: "completed", note: "" },
    { name: "mttr", status: "completed", note: "" },
  ];

  if (isTeamScoped) {
    for (const name of ["ai", "cursor", "feathery"]) {
      sources.push({ name, status: "skipped", note: "team-scoped run" });
    }
  } else {
    sources.push(await readSourceSummary(aiSummaryPath, "ai"));
    sources.push(await readSourceSummary(cursorSummaryPath, "cursor"));
    sources.push({
      name: "feathery",
      status: featheryRefreshed ? "completed" : "skipped",
      note: featheryRefreshed
        ? ""
        : "best-effort skip (missing FEATHERY_TOKEN or fetch failed)",
    });
  }

  const refreshSummary = await writeRefreshSummary(sources, dataChanged);

  console.log(
    JSON.stringify(
      {
        generatedJsonPath,
        publicJsonPath,
        refreshSummaryPath,
        featheryRefreshed,
        dataChanged,
        sources: refreshSummary.sources,
      },
      null,
      2,
    ),
  );
}

// Compares the newly generated JSON against the currently published copy.
// Returns true when content differs (or when there is no published copy yet).
async function hasPublishedJsonChanged() {
  try {
    const [next, current] = await Promise.all([
      fs.readFile(generatedJsonPath, "utf8"),
      fs.readFile(publicJsonPath, "utf8"),
    ]);
    return next !== current;
  } catch {
    return true;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

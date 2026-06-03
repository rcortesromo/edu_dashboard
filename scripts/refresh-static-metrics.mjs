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

  if (!isTeamScoped) {
    await runNodeScript(path.join(__dirname, "ai/pull-adoption-metrics.mjs"), pullArgs);
    await runNodeScript(path.join(__dirname, "cursor/pull-cursor-metrics.mjs"), pullArgs);
  }

  await runNodeScript(path.join(__dirname, "published/merge-metric-sources.mjs"));
  await runNodeScript(path.join(__dirname, "published/export-metrics-json.mjs"), [
    generatedCsvPath,
    generatedJsonPath,
  ]);

  await fs.mkdir(path.dirname(publicJsonPath), { recursive: true });
  await fs.copyFile(generatedJsonPath, publicJsonPath);

  console.log(
    JSON.stringify(
      {
        generatedJsonPath,
        publicJsonPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

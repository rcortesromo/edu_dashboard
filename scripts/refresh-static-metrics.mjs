import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const generatedJsonPath = path.join(repoRoot, "backend/excel/json/metrics.generated.json");
const generatedCsvPath = path.join(repoRoot, "backend/excel/generated/json_export_view.csv");
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

async function main() {
  const pullArgs = process.argv.slice(2);

  await runNodeScript(path.join(__dirname, "pull-jira-quarterly-metrics.mjs"), pullArgs);
  await runNodeScript(path.join(__dirname, "export-jira-metrics-json.mjs"), [
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

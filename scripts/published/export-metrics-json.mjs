import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const inputCsv = path.join(repoRoot, "backend/published/generated/json_export_view.csv");
const outputJson = path.join(repoRoot, "public/data/metrics.generated.json");

process.argv[2] = inputCsv;
process.argv[3] = outputJson;

await import("../export-jira-metrics-json.mjs");

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

if (!process.argv[2]) {
  process.argv[2] = path.join(repoRoot, "backend/published/generated/json_export_view.csv");
}
if (!process.argv[3]) {
  process.argv[3] = path.join(repoRoot, "public/data/metrics.generated.json");
}

await import("../export-jira-metrics-json.mjs");

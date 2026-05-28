import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const generatedDir = path.join(repoRoot, "backend/jira/generated");
const configPath = path.join(repoRoot, "backend/jira/config/jira-field-mapping.template.json");

const headers = [
  "team_name",
  "sprint_id",
  "sprint_name",
  "quarter_label",
  "velocity_points",
  "velocity_source",
  "last_refresh_utc",
];

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') { current += '"'; index += 1; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) { row.push(current); current = ""; continue; }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(current); current = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = []; continue;
    }
    current += char;
  }
  if (current !== "" || row.length > 0) {
    row.push(current);
    if (row.some((c) => c !== "")) rows.push(row);
  }
  if (rows.length === 0) return [];
  const [h, ...d] = rows;
  return d.map((dr) => { const e = {}; h.forEach((hd, i) => { e[hd] = dr[i] ?? ""; }); return e; });
}

function csvEscape(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(h, rows) {
  const lines = [h.join(",")];
  for (const r of rows) lines.push(h.map((hd) => csvEscape(r[hd] ?? "")).join(","));
  return `${lines.join("\n")}\n`;
}

async function readCsvFile(filePath) {
  try { return parseCsv(await fs.readFile(filePath, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return []; throw e; }
}

function round(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  return Number(v.toFixed(d));
}

async function main() {
  const mapping = JSON.parse(await fs.readFile(configPath, "utf8"));
  const teams = mapping.boardsOrProjects.filter((e) => e.teamName && e.boardId);

  const teamsWithVelocityIssueTypes = new Set(
    teams
      .filter((t) => Array.isArray(t?.velocity?.velocityIssueTypes) && t.velocity.velocityIssueTypes.length > 0)
      .map((t) => t.teamName),
  );

  const metricOutputs = await readCsvFile(path.join(generatedDir, "metric_outputs_by_quarter.csv"));

  const years = (await fs.readdir(generatedDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => e.name)
    .sort();

  let totalWritten = 0;

  for (const year of years) {
    const yearDir = path.join(generatedDir, year);
    const files = await fs.readdir(yearDir);

    for (const file of files) {
      const calMatch = /^sprint_calendar_(\d{4}-Q[1-4])\.csv$/.exec(file);
      if (!calMatch) continue;

      const quarterLabel = calMatch[1];
      const velocityFile = path.join(yearDir, `velocity_by_sprint_${quarterLabel}.csv`);

      try {
        await fs.access(velocityFile);
        continue;
      } catch {}

      const calendar = await readCsvFile(path.join(yearDir, file));
      const sprintInputs = await readCsvFile(path.join(yearDir, `metric_inputs_by_sprint_${quarterLabel}.csv`));

      const rows = [];

      for (const team of teams) {
        const teamCalendar = calendar.filter((r) => r.team_name === team.teamName);
        const teamInputs = sprintInputs.filter((r) => r.team_name === team.teamName);

        if (teamsWithVelocityIssueTypes.has(team.teamName)) {
          const quarterOutput = metricOutputs.find(
            (r) => r.team_name === team.teamName && r.quarter_label === quarterLabel,
          );

          const avgVelocity = Number(quarterOutput?.average_velocity_points_per_sprint || 0);
          const sprintCount = teamCalendar.length;

          for (const cal of teamCalendar) {
            rows.push({
              team_name: team.teamName,
              sprint_id: cal.sprint_id,
              sprint_name: cal.sprint_name,
              quarter_label: quarterLabel,
              velocity_points: String(round(avgVelocity)),
              velocity_source: "backfill_quarterly_average",
              last_refresh_utc: quarterOutput?.last_refresh_utc || "",
            });
          }
        } else {
          const velocityScope = team?.velocity?.velocityScope || "all_completed";
          const pointsField = velocityScope === "committed_only" ? "committed_completed_points" : "completed_points";

          for (const cal of teamCalendar) {
            const input = teamInputs.find((r) => r.sprint_id === cal.sprint_id);
            const pts = Number(input?.[pointsField] ?? input?.completed_points ?? 0);

            rows.push({
              team_name: team.teamName,
              sprint_id: cal.sprint_id,
              sprint_name: cal.sprint_name,
              quarter_label: quarterLabel,
              velocity_points: String(round(pts)),
              velocity_source: "calculated_completed_points",
              last_refresh_utc: input?.last_refresh_utc || "",
            });
          }
        }
      }

      if (rows.length > 0) {
        await fs.writeFile(velocityFile, toCsv(headers, rows), "utf8");
        totalWritten += rows.length;
        console.log(`  wrote ${rows.length} rows -> ${path.basename(velocityFile)}`);
      }
    }
  }

  console.log(JSON.stringify({ totalVelocityRowsBackfilled: totalWritten }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

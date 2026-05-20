import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const identityMapPath = path.join(repoRoot, "backend/ai/identity/team-user-map.json");
const outputCsvPath = path.join(repoRoot, "backend/cursor/generated/json_export_view.csv");
const outputSummaryPath = path.join(repoRoot, "backend/cursor/generated/cursor-scope-summary.json");

const API_BASE = "https://api.cursor.com";
const MAX_WINDOW_DAYS = 30;
const REQUEST_DELAY_MS = 3200;

const CSV_HEADERS = [
  "team_name",
  "quarter_label",
  "metric_name",
  "metric_value",
  "metric_unit",
  "source_system",
  "coverage_status",
  "note",
  "last_refresh_utc",
];

const QUARTER_BOUNDARIES = {
  Q1: { start: "01-01", end: "03-31" },
  Q2: { start: "04-01", end: "06-30" },
  Q3: { start: "07-01", end: "09-30" },
  Q4: { start: "10-01", end: "12-31" },
};

function parseEnv(text) {
  const env = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }

  return env;
}

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headersList, rows) {
  const lines = [headersList.join(",")];
  for (const row of rows) {
    lines.push(headersList.map((h) => csvEscape(row[h] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') { current += '"'; i++; } else { inQuotes = !inQuotes; }
      continue;
    }
    if (ch === "," && !inQuotes) { row.push(current); current = ""; continue; }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(current); current = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = []; continue;
    }
    current += ch;
  }

  if (current !== "" || row.length > 0) { row.push(current); if (row.some((c) => c !== "")) rows.push(row); }
  if (rows.length === 0) return [];

  const [headerRow, ...dataRows] = rows;
  return dataRows.map((dr) => {
    const entry = {};
    headerRow.forEach((h, idx) => { entry[h] = dr[idx] ?? ""; });
    return entry;
  });
}

async function readExistingCsv(filePath) {
  try {
    return parseCsv(await fs.readFile(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function latestQuarterInRows(rows) {
  const labels = [...new Set(rows.map((r) => r.quarter_label).filter(Boolean))];
  return labels.sort().pop() ?? null;
}

function parseQuarterLabel(label) {
  const m = /^(\d{4})-Q([1-4])$/.exec(label);
  return m ? { year: Number(m[1]), quarter: Number(m[2]) } : null;
}

function cursorAuthHeader(token) {
  return `Basic ${Buffer.from(`${token}:`).toString("base64")}`;
}

function buildAllQuarterWindows(startYear) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const windows = [];

  for (let year = startYear; year <= currentYear; year++) {
    const maxQ = year === currentYear ? currentQuarter : 4;
    for (let q = 1; q <= maxQ; q++) {
      const key = `Q${q}`;
      const bounds = QUARTER_BOUNDARIES[key];
      windows.push({
        label: `${year}-${key}`,
        start: new Date(`${year}-${bounds.start}T00:00:00Z`),
        end: new Date(`${year}-${bounds.end}T23:59:59Z`),
      });
    }
  }

  return windows;
}

function buildQuarterWindows(isFull, existingRows) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const fullStartYear = Number(process.env.CURSOR_FROM_YEAR) || currentYear - 1;

  if (isFull || existingRows.length === 0) {
    return buildAllQuarterWindows(fullStartYear);
  }

  const latest = latestQuarterInRows(existingRows);
  const parsed = latest ? parseQuarterLabel(latest) : null;

  if (!parsed) {
    return buildAllQuarterWindows(fullStartYear);
  }

  return buildAllQuarterWindows(parsed.year).filter((w) => w.label >= latest);
}

function isUserActiveInPeriod(user, quarterStart, quarterEnd) {
  if (user.activeFrom) {
    const from = new Date(`${user.activeFrom}T00:00:00Z`);
    if (from > quarterEnd) return false;
  }

  if (user.activeTo) {
    const to = new Date(`${user.activeTo}T23:59:59Z`);
    if (to < quarterStart) return false;
  }

  return true;
}

function chunkDateRange(start, end, maxDays) {
  const chunks = [];
  let windowStart = new Date(start.getTime());

  while (windowStart < end) {
    const windowEnd = new Date(
      Math.min(windowStart.getTime() + maxDays * 24 * 60 * 60 * 1000 - 1, end.getTime()),
    );
    chunks.push({ start: windowStart, end: windowEnd });
    windowStart = new Date(windowEnd.getTime() + 1);
  }

  return chunks;
}

async function fetchCursorMembers(token) {
  const response = await fetch(`${API_BASE}/teams/members`, {
    method: "GET",
    headers: { Authorization: cursorAuthHeader(token) },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cursor API ${response.status} for /teams/members: ${body}`);
  }

  const data = await response.json();
  return Array.isArray(data.teamMembers) ? data.teamMembers : [];
}

async function fetchDailyUsage(token, startEpochMs, endEpochMs) {
  const allRecords = [];
  let page = 1;
  const pageSize = 500;

  while (true) {
    const response = await fetch(`${API_BASE}/teams/daily-usage-data`, {
      method: "POST",
      headers: {
        Authorization: cursorAuthHeader(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startDate: startEpochMs, endDate: endEpochMs, page, pageSize }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Cursor API ${response.status} for /teams/daily-usage-data: ${body}`);
    }

    const result = await response.json();
    const records = Array.isArray(result.data) ? result.data : [];
    allRecords.push(...records);

    if (!result.pagination || !result.pagination.hasNextPage) break;
    page++;
  }

  return allRecords;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

async function runDiscover(token, users) {
  console.log("Discover mode: listing Cursor team members and matching to roster...\n");

  const members = await fetchCursorMembers(token);

  if (members.length === 0) {
    console.log("No team members found in Cursor. Verify your CURSOR_TOKEN has admin scope.");
    return;
  }

  console.log(`Found ${members.length} Cursor team member(s):\n`);
  console.log("  %-35s %-35s %s", "EMAIL", "NAME", "ROSTER MATCH");
  console.log("  " + "-".repeat(95));

  const rosterByNorm = new Map();
  for (const user of users) {
    const name = String(user.name ?? "").trim().toLowerCase();
    if (name) rosterByNorm.set(name, user);
  }

  const alreadyMapped = new Map();
  for (const user of users) {
    const email = normEmail(user.cursorEmail);
    if (email) alreadyMapped.set(email, user);
  }

  const suggestions = [];

  for (const member of members) {
    const email = normEmail(member.email);
    const name = String(member.name ?? "").trim();
    let match = "";

    if (alreadyMapped.has(email)) {
      match = `MAPPED -> ${alreadyMapped.get(email).name} (${alreadyMapped.get(email).team})`;
    } else {
      const nameLower = name.toLowerCase();
      const rosterUser = rosterByNorm.get(nameLower);

      if (rosterUser) {
        match = `SUGGEST -> ${rosterUser.name} (${rosterUser.team})`;
        suggestions.push({ cursorEmail: email, rosterName: rosterUser.name, rosterTeam: rosterUser.team });
      } else {
        match = "NO MATCH";
      }
    }

    console.log(`  %-35s %-35s %s`, email, name, match);
  }

  if (suggestions.length > 0) {
    console.log(`\nSuggested cursorEmail updates for team-user-map.json:\n`);

    for (const s of suggestions) {
      console.log(`  ${s.rosterName} (${s.rosterTeam}): cursorEmail -> "${s.cursorEmail}"`);
    }

    console.log("\nTo apply, update cursorEmail fields in backend/ai/identity/team-user-map.json");
  }

  if (alreadyMapped.size === 0 && suggestions.length === 0) {
    console.log("\nNo matches found. Team members may use different names in Cursor vs roster.");
    console.log("Manually set cursorEmail in backend/ai/identity/team-user-map.json for each user.");
  }
}

async function main() {
  const now = new Date().toISOString();
  const args = process.argv.slice(2);
  const isDiscover = args.includes("--discover");
  const isFull = args.includes("--full");

  const envText = await fs.readFile(envPath, "utf8").catch(() => "");
  const env = parseEnv(envText);
  const identityMap = JSON.parse(await fs.readFile(identityMapPath, "utf8"));
  const users = Array.isArray(identityMap.users) ? identityMap.users : [];

  if (!env.CURSOR_TOKEN) {
    console.log("No CURSOR_TOKEN in .env.local — skipping Cursor metrics.");
    await writeOutputs([], {
      refreshedAt: now,
      source: "Cursor",
      status: "skipped",
      note: "Missing CURSOR_TOKEN",
      metrics: [],
    });
    return;
  }

  const token = env.CURSOR_TOKEN;

  if (isDiscover) {
    await runDiscover(token, users);
    return;
  }

  const emailToUser = new Map();
  for (const user of users) {
    const email = normEmail(user.cursorEmail);
    if (email) emailToUser.set(email, user);
  }

  const teamUsers = new Map();
  for (const user of users) {
    const team = String(user.team ?? "").trim();
    if (!team) continue;
    if (!teamUsers.has(team)) teamUsers.set(team, []);
    teamUsers.get(team).push(user);
  }

  const mappedCount = emailToUser.size;

  if (mappedCount === 0) {
    console.log("No cursorEmail values set in team-user-map.json.");
    console.log("Run with --discover to see Cursor members and suggested mappings.");
    await writeOutputs([], {
      refreshedAt: now,
      source: "Cursor",
      status: "skipped",
      note: "No cursorEmail mappings configured",
      metrics: [],
    });
    return;
  }

  console.log(`${mappedCount} roster member(s) have cursorEmail mapped`);

  const existingRows = await readExistingCsv(outputCsvPath);
  const quarters = buildQuarterWindows(isFull, existingRows);
  const fetchedLabels = new Set(quarters.map((q) => q.label));
  const retainedRows = existingRows.filter((r) => !fetchedLabels.has(r.quarter_label));
  const csvRows = [];
  const summary = {
    refreshedAt: now,
    source: "Cursor",
    usersTracked: mappedCount,
    status: "skipped",
    note: "",
    metrics: [],
  };

  if (isFull) {
    console.log(`Full refresh: processing ${quarters.length} quarter(s) for ${teamUsers.size} team(s)`);
  } else {
    console.log(`Incremental refresh: processing ${quarters.length} quarter(s) for ${teamUsers.size} team(s) (${retainedRows.length} existing row(s) retained)`);
  }

  for (const quarter of quarters) {
    console.log(`\nQuarter: ${quarter.label}`);

    const chunks = chunkDateRange(quarter.start, quarter.end, MAX_WINDOW_DAYS);
    const activeEmails = new Set();

    for (let ci = 0; ci < chunks.length; ci++) {
      if (ci > 0) await sleep(REQUEST_DELAY_MS);

      const chunk = chunks[ci];
      const startMs = chunk.start.getTime();
      const endMs = chunk.end.getTime();

      console.log(
        `  Fetching daily usage ${chunk.start.toISOString().slice(0, 10)} to ${chunk.end.toISOString().slice(0, 10)}...`,
      );

      let records;
      try {
        records = await fetchDailyUsage(token, startMs, endMs);
      } catch (error) {
        if (String(error.message).includes("403")) {
          console.error(
            "  Error 403: /teams/daily-usage-data is not available on your plan.\n" +
              "  This endpoint requires a Cursor Business or Enterprise subscription.",
          );
          summary.status = "error";
          summary.note = "403 — daily-usage-data not available on current plan";
          await writeOutputs([], summary);
          return;
        }

        console.error(`  Failed to fetch daily usage: ${error.message}`);
        continue;
      }

      for (const record of records) {
        if (record.isActive) {
          activeEmails.add(normEmail(record.email));
        }
      }

      console.log(`    ${records.length} record(s), ${activeEmails.size} unique active user(s) so far`);
    }

    for (const [team, members] of teamUsers) {
      const eligibleMembers = members.filter((u) => {
        if (!normEmail(u.cursorEmail)) return false;
        return isUserActiveInPeriod(u, quarter.start, quarter.end);
      });

      const activeCount = eligibleMembers.filter((u) => activeEmails.has(normEmail(u.cursorEmail))).length;
      const totalEligible = eligibleMembers.length;
      const adoptionRate = totalEligible > 0 ? (activeCount / totalEligible) * 100 : 0;

      console.log(`  ${team}: ${activeCount} of ${totalEligible} mapped member(s) active`);

      csvRows.push({
        team_name: team,
        quarter_label: quarter.label,
        metric_name: "Cursor Adoption Rate",
        metric_value: adoptionRate.toFixed(4),
        metric_unit: "percent",
        source_system: "Cursor",
        coverage_status: "automated",
        note: `${activeCount} of ${totalEligible} mapped members had Cursor activity`,
        last_refresh_utc: now,
      });

      summary.metrics.push({
        team,
        quarter: quarter.label,
        activeMembers: activeCount,
        eligibleMembers: totalEligible,
        adoptionRate: Number(adoptionRate.toFixed(4)),
      });
    }
  }

  const allTeamRows = [...retainedRows.filter((r) => r.team_name !== "EDU"), ...csvRows];
  const allQuarterWindows = buildAllQuarterWindows(
    Number(process.env.CURSOR_FROM_YEAR) || new Date().getUTCFullYear() - 1,
  );
  const eduRows = buildEduRollup(allTeamRows, allQuarterWindows, now);
  const finalRows = [...allTeamRows, ...eduRows];

  summary.status = "completed";
  summary.note = `Processed ${quarters.length} quarter(s), ${finalRows.length} total row(s) (${retainedRows.length} retained).`;

  await writeOutputs(finalRows, summary);
}

function buildEduRollup(teamRows, quarters, now) {
  const eduRows = [];

  for (const quarter of quarters) {
    const quarterRows = teamRows.filter(
      (r) => r.quarter_label === quarter.label && r.metric_name === "Cursor Adoption Rate",
    );

    if (quarterRows.length === 0) continue;

    let totalActive = 0;
    let totalEligible = 0;

    for (const row of quarterRows) {
      const match = String(row.note).match(/^(\d+) of (\d+)/);
      if (match) {
        totalActive += Number(match[1]);
        totalEligible += Number(match[2]);
      }
    }

    const eduRate = totalEligible > 0 ? (totalActive / totalEligible) * 100 : 0;

    eduRows.push({
      team_name: "EDU",
      quarter_label: quarter.label,
      metric_name: "Cursor Adoption Rate",
      metric_value: eduRate.toFixed(4),
      metric_unit: "percent",
      source_system: "Cursor",
      coverage_status: "automated",
      note: `${totalActive} of ${totalEligible} mapped members had Cursor activity (portfolio rollup)`,
      last_refresh_utc: now,
    });
  }

  return eduRows;
}

async function writeOutputs(csvRows, summary) {
  await fs.mkdir(path.dirname(outputCsvPath), { recursive: true });
  await Promise.all([
    fs.writeFile(outputCsvPath, toCsv(CSV_HEADERS, csvRows), "utf8"),
    fs.writeFile(outputSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  ]);

  console.log(`\nWrote ${csvRows.length} row(s) to ${path.relative(repoRoot, outputCsvPath)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

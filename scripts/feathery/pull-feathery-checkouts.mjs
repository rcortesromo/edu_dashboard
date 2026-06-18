import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const backendDir = path.join(repoRoot, "backend/feathery/generated");
const backendJsonPath = path.join(backendDir, "feathery-checkouts.generated.json");
const clientsCsvPath = path.join(backendDir, "feathery-checkouts-clients.csv");
const checkpointPath = path.join(backendDir, "feathery-checkouts.checkpoint.json");
const publicJsonPath = path.join(repoRoot, "public/data/feathery-checkouts.generated.json");
const reportCachePath = path.join(os.tmpdir(), "feathery-form-report-cache.json");

const API_BASE = "https://api.feathery.io";

// The RevTrak custom component records checkout data in hidden submission
// fields. A submission counts as a "checkout" when the OrderId hidden field is
// populated. We only persist aggregates (count + amount), never raw PII such as
// payer email/name.
const ORDER_FIELD = "OrderId";
const AMOUNT_FIELD = "Amount";
const REVTRAK_KEY = "revtrak_inventory";

const PAGE_DELAY_MS = 700;
const MAX_429_RETRIES = 8;

function parseArgs(argv) {
  // Defaults target the real run: every RevTrak workspace, active forms only.
  // --limit / --sort / --max-forms exist for quick timed test runs.
  const args = {
    limit: 0,
    sort: "revtrak",
    delay: PAGE_DELAY_MS,
    maxForms: 0,
    useCache: false,
    since: "",
    reset: false,
    includeInactive: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--use-cache") args.useCache = true;
    else if (a === "--reset") args.reset = true;
    else if (a === "--include-inactive") args.includeInactive = true;
    else if (a === "--limit") args.limit = Number(argv[++i]) || 0;
    else if (a === "--sort") args.sort = argv[++i] || args.sort;
    else if (a === "--delay") args.delay = Number(argv[++i]) || args.delay;
    else if (a === "--max-forms") args.maxForms = Number(argv[++i]) || 0;
    else if (a === "--since") args.since = argv[++i] || "";
  }
  return args;
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseRetrySeconds(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const match = /available in (\d+) seconds/i.exec(text);
  return match ? Number(match[1]) : null;
}

let apiCalls = 0;

async function fetchJson(url, token) {
  let attempt = 0;
  while (true) {
    apiCalls += 1;
    const response = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (response.status === 429 && attempt < MAX_429_RETRIES) {
      attempt += 1;
      const headerRetry = Number(response.headers.get("retry-after"));
      const waitSeconds = headerRetry || parseRetrySeconds(body) || 30;
      console.log(`   429, waiting ${waitSeconds}s (attempt ${attempt}/${MAX_429_RETRIES})`);
      await sleep((waitSeconds + 1) * 1000);
      continue;
    }
    return { ok: response.ok, status: response.status, body };
  }
}

async function fetchAllPages(baseUrl, token, delay) {
  const all = [];
  let page = 1;
  let meta = null;
  while (true) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${sep}page=${page}&page_size=100`;
    const { ok, status, body } = await fetchJson(url, token);
    if (!ok) throw new Error(`${baseUrl} -> ${status}: ${JSON.stringify(body)}`);
    if (Array.isArray(body)) {
      all.push(...body);
      break;
    }
    all.push(...(body?.results ?? []));
    if (!meta) meta = { cycle_start: body?.cycle_start ?? null, cycle_end: body?.cycle_end ?? null };
    if (!body?.next) break;
    page += 1;
    await sleep(delay);
  }
  return { results: all, meta };
}

function isFilled(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function toNumber(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(since) {
  // Accepts "YYYY-MM-DD" or full ISO; returns an ISO datetime string.
  if (!since) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) return `${since}T00:00:00Z`;
  return since;
}

// Counts checkouts (submissions with a populated OrderId) created after
// `createdAfterIso` for a single form, paging through all matching submissions.
// Only OrderId + Amount fields are requested to minimize payload and avoid PII.
async function countFormCheckouts(formId, apiKey, createdAfterIso, delay) {
  let checkouts = 0;
  let amount = 0;
  let submissions = 0;
  let page = 1;
  while (true) {
    let url =
      `${API_BASE}/api/form/submission/?form_id=${encodeURIComponent(formId)}` +
      `&fields=${ORDER_FIELD},${AMOUNT_FIELD}&page_size=1000&page=${page}`;
    if (createdAfterIso) url += `&created_after=${encodeURIComponent(createdAfterIso)}`;
    const { ok, status, body } = await fetchJson(url, apiKey);
    if (!ok) {
      // A form may be inaccessible or deleted; skip it without failing the run.
      return { checkouts, amount, submissions, error: status };
    }
    const results = body?.results ?? [];
    for (const sub of results) {
      submissions += 1;
      let order;
      let amt;
      for (const v of sub.values ?? []) {
        if (v.id === ORDER_FIELD) order = v.value;
        else if (v.id === AMOUNT_FIELD) amt = v.value;
      }
      if (isFilled(order)) {
        checkouts += 1;
        amount += toNumber(amt);
      }
    }
    if (!body?.next) break;
    page += 1;
    await sleep(delay);
  }
  return { checkouts, amount, submissions };
}

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h] ?? "")).join(","));
  return `${lines.join("\n")}\n`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function loadCheckpoint() {
  const raw = await fs.readFile(checkpointPath, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveCheckpoint(cp) {
  await fs.mkdir(backendDir, { recursive: true });
  await fs.writeFile(checkpointPath, `${JSON.stringify(cp, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const runAt = new Date().toISOString();
  const env = parseEnv(await fs.readFile(envPath, "utf8").catch(() => ""));
  const token = env.FEATHERY_TOKEN;

  if (!token) {
    console.error("No FEATHERY_TOKEN in .env.local — skipping checkouts pull.");
    process.exitCode = 1;
    return;
  }

  // 1) Workspace form report -> RevTrak workspaces + their forms (cacheable).
  let workspaces;
  if (args.useCache) {
    const cached = await fs.readFile(reportCachePath, "utf8").catch(() => null);
    if (cached) {
      workspaces = JSON.parse(cached);
      console.log(`Using cached form report (${workspaces.length} workspaces).`);
    }
  }
  if (!workspaces) {
    console.log("Fetching workspace form report ...");
    const { results } = await fetchAllPages(`${API_BASE}/api/workspace/report/form/`, token, args.delay);
    workspaces = results;
    await fs.writeFile(reportCachePath, JSON.stringify(workspaces), "utf8");
  }

  // 2) Submission report -> per-workspace cycle submission counts + billing cycle.
  console.log("Fetching workspace submission report ...");
  const { results: subWorkspaces, meta: subMeta } = await fetchAllPages(
    `${API_BASE}/api/workspace/report/submissions/?billing_cycle_offset=0`,
    token,
    args.delay,
  );
  const submissionsById = new Map();
  for (const ws of subWorkspaces) submissionsById.set(ws.id, Number(ws.submissions) || 0);

  const periodSince = toIsoDate(args.since) || toIsoDate(subMeta?.cycle_start) || null;
  const periodLabel =
    subMeta?.cycle_start && subMeta?.cycle_end
      ? `${subMeta.cycle_start}..${subMeta.cycle_end}`
      : periodSince || "all";

  // 3) Build the RevTrak workspace list (active forms only by default).
  let revtrakWorkspaces = workspaces
    .map((ws) => {
      const forms = (ws.forms ?? []).filter((f) => f.id);
      const activeForms = args.includeInactive ? forms : forms.filter((f) => f.active);
      return {
        id: ws.id,
        name: ws.name,
        revtrakForms: ws.form_field_stats?.[REVTRAK_KEY]?.form_count ?? 0,
        forms: activeForms,
        totalForms: forms.length,
        cycleSubmissions: submissionsById.get(ws.id) ?? 0,
      };
    })
    .filter((ws) => ws.revtrakForms > 0);

  revtrakWorkspaces.sort((a, b) =>
    args.sort === "forms" ? b.forms.length - a.forms.length : b.revtrakForms - a.revtrakForms,
  );

  const selected = args.limit > 0 ? revtrakWorkspaces.slice(0, args.limit) : revtrakWorkspaces;

  // 4) Load / initialize checkpoint. A new billing cycle freezes the prior one
  // into `history` so the accumulated all-time total keeps growing.
  let cp = args.reset ? null : await loadCheckpoint();
  if (!cp) {
    cp = { period: { since: periodSince, label: periodLabel }, history: [], workspaces: {}, lastRunAt: null };
  } else if (cp.period?.label !== periodLabel) {
    const closed = Object.values(cp.workspaces || {}).reduce(
      (acc, w) => ({ checkouts: acc.checkouts + (w.checkouts || 0), amount: acc.amount + (w.amount || 0) }),
      { checkouts: 0, amount: 0 },
    );
    cp.history = cp.history || [];
    cp.history.push({ period: cp.period, checkouts: closed.checkouts, amount: round2(closed.amount), closedAt: runAt });
    cp.period = { since: periodSince, label: periodLabel };
    cp.workspaces = {};
  }

  console.log(
    `${revtrakWorkspaces.length} RevTrak workspaces; processing ${selected.length}` +
      `${args.limit > 0 ? ` (top ${args.limit} by ${args.sort})` : " (all)"}.`,
  );
  console.log(`Period: ${periodLabel} | created_after >= ${periodSince ?? "(none)"}\n`);

  let processed = 0;
  let scanned = 0;
  let skippedZero = 0;
  let skippedNoChange = 0;

  for (const ws of selected) {
    processed += 1;
    const prev = cp.workspaces[ws.id];
    const cycleSubs = ws.cycleSubmissions;

    // Skip workspaces with no submissions this cycle (no checkouts possible).
    if (cycleSubs === 0) {
      cp.workspaces[ws.id] = {
        name: ws.name,
        checkouts: prev?.checkouts ?? 0,
        amount: prev?.amount ?? 0,
        cycleSubmissions: 0,
        formsScanned: prev?.formsScanned ?? 0,
        lastScanAt: prev?.lastScanAt ?? null,
        firstSweepDone: true,
      };
      skippedZero += 1;
      await saveCheckpoint(cp);
      continue;
    }

    // Incremental skip: already swept and no new submissions since last run.
    if (prev?.firstSweepDone && prev.cycleSubmissions === cycleSubs) {
      skippedNoChange += 1;
      continue;
    }

    // Determine the lower bound: first sweep uses the period start; incremental
    // runs only look at submissions created since the previous scan.
    const createdAfter = prev?.firstSweepDone ? prev.lastScanAt : periodSince;

    const wsRes = await fetchJson(`${API_BASE}/api/workspace/${ws.id}/`, token);
    const apiKey = wsRes.body?.live_api_key;
    if (!wsRes.ok || !apiKey) {
      console.log(`  [${processed}/${selected.length}] ${ws.name}: no live_api_key (status ${wsRes.status})`);
      cp.workspaces[ws.id] = {
        name: ws.name,
        checkouts: prev?.checkouts ?? 0,
        amount: prev?.amount ?? 0,
        cycleSubmissions: cycleSubs,
        formsScanned: prev?.formsScanned ?? 0,
        lastScanAt: prev?.lastScanAt ?? null,
        firstSweepDone: prev?.firstSweepDone ?? false,
        error: "no_api_key",
      };
      await saveCheckpoint(cp);
      await sleep(args.delay);
      continue;
    }

    let newCheckouts = 0;
    let newAmount = 0;
    let formsScanned = 0;
    const formsToScan = args.maxForms > 0 ? ws.forms.slice(0, args.maxForms) : ws.forms;
    for (const form of formsToScan) {
      const res = await countFormCheckouts(form.id, apiKey, createdAfter, args.delay);
      formsScanned += 1;
      newCheckouts += res.checkouts;
      newAmount += res.amount;
      await sleep(args.delay);
    }

    cp.workspaces[ws.id] = {
      name: ws.name,
      checkouts: (prev?.checkouts ?? 0) + newCheckouts,
      amount: round2((prev?.amount ?? 0) + newAmount),
      cycleSubmissions: cycleSubs,
      formsScanned,
      lastScanAt: runAt,
      firstSweepDone: true,
    };
    scanned += 1;
    await saveCheckpoint(cp);

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(
      `  [${processed}/${selected.length}] ${ws.name}: +${newCheckouts} checkouts (total ${cp.workspaces[ws.id].checkouts}) across ${formsScanned} active forms (t=${elapsed}s)`,
    );
  }

  cp.lastRunAt = runAt;
  await saveCheckpoint(cp);

  // 5) Build published payload from the checkpoint (current cycle + all-time).
  const perWorkspace = Object.entries(cp.workspaces)
    .map(([id, w]) => ({ id, name: w.name, checkouts: w.checkouts || 0, amount: w.amount || 0, cycleSubmissions: w.cycleSubmissions || 0 }))
    .filter((w) => w.checkouts > 0 || w.cycleSubmissions > 0)
    .sort((a, b) => b.checkouts - a.checkouts);

  const cycleTotals = perWorkspace.reduce(
    (acc, w) => ({ checkouts: acc.checkouts + w.checkouts, amount: acc.amount + w.amount }),
    { checkouts: 0, amount: 0 },
  );
  const historyTotals = (cp.history || []).reduce(
    (acc, h) => ({ checkouts: acc.checkouts + (h.checkouts || 0), amount: acc.amount + (h.amount || 0) }),
    { checkouts: 0, amount: 0 },
  );

  const elapsedMs = Date.now() - startedAt;
  const payload = {
    generatedAt: runAt,
    source: "Feathery",
    definition: "checkout = submission with a populated RevTrak OrderId hidden field",
    period: { since: periodSince, label: periodLabel },
    currentCycle: { checkouts: cycleTotals.checkouts, amount: round2(cycleTotals.amount) },
    accumulated: {
      checkouts: cycleTotals.checkouts + historyTotals.checkouts,
      amount: round2(cycleTotals.amount + historyTotals.amount),
      closedCycles: cp.history?.length ?? 0,
    },
    coverage: {
      workspacesWithRevtrak: revtrakWorkspaces.length,
      workspacesProcessed: selected.length,
      workspacesScanned: scanned,
      skippedNoSubmissions: skippedZero,
      skippedNoChange,
      activeFormsOnly: !args.includeInactive,
    },
    timing: { elapsedMs, elapsedSeconds: Math.round(elapsedMs / 1000), apiCalls },
    perWorkspace,
  };

  const csvHeaders = ["workspace_id", "client_name", "checkouts", "amount", "cycle_submissions", "billing_cycle", "source_system", "last_refresh_utc"];
  const csvRows = perWorkspace.map((w) => ({
    workspace_id: w.id,
    client_name: w.name,
    checkouts: w.checkouts,
    amount: w.amount,
    cycle_submissions: w.cycleSubmissions,
    billing_cycle: periodLabel,
    source_system: "Feathery",
    last_refresh_utc: runAt,
  }));

  await fs.mkdir(backendDir, { recursive: true });
  await fs.writeFile(backendJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(clientsCsvPath, toCsv(csvHeaders, csvRows), "utf8");
  await fs.mkdir(path.dirname(publicJsonPath), { recursive: true });
  await fs.copyFile(backendJsonPath, publicJsonPath);

  console.log("\n=== Summary ===");
  console.log(
    JSON.stringify(
      { currentCycle: payload.currentCycle, accumulated: payload.accumulated, coverage: payload.coverage },
      null,
      2,
    ),
  );
  console.log(`Elapsed: ${payload.timing.elapsedSeconds}s | API calls: ${apiCalls}`);
  console.log(`Wrote ${path.relative(repoRoot, backendJsonPath)}`);
  console.log(`Checkpoint: ${path.relative(repoRoot, checkpointPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

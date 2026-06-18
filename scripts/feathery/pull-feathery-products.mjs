import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const backendDir = path.join(repoRoot, "backend/feathery/generated");
const backendJsonPath = path.join(backendDir, "feathery-products.generated.json");
const clientsCsvPath = path.join(backendDir, "feathery-products-clients.csv");
const totalsCsvPath = path.join(backendDir, "feathery-products-totals.csv");
const publicJsonPath = path.join(repoRoot, "public/data/feathery-products.generated.json");

const API_BASE = "https://api.feathery.io";

// Candidate field-type keys in form_field_stats that map to the metrics we care
// about. Feathery may use slightly different keys, so we match against a list.
// Payments are embedded via the RevTrak custom component, which the form report
// exposes under the custom field key `revtrak_inventory` (not `payment_method`,
// which stays at 0 because these workspaces don't use Feathery's native payment
// element).
const PAYMENT_FIELD_TYPES = ["revtrak_inventory", "payment_method", "payment", "stripe", "checkout"];
const SIGNATURE_FIELD_TYPES = ["signature", "esignature", "e_signature"];
const UPLOAD_FIELD_TYPES = ["file_upload", "upload", "file"];

const PAGE_DELAY_MS = 1200;
const MAX_429_RETRIES = 8;

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

function authHeader(token) {
  return `Token ${token}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetrySeconds(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const match = /available in (\d+) seconds/i.exec(text);
  return match ? Number(match[1]) : null;
}

async function fetchJson(url, token) {
  let attempt = 0;

  while (true) {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader(token) },
    });

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
      console.log(
        `   Rate limited (429). Waiting ${waitSeconds}s then retrying (attempt ${attempt}/${MAX_429_RETRIES})...`,
      );
      await sleep((waitSeconds + 1) * 1000);
      continue;
    }

    if (!response.ok) {
      const err = new Error(
        `Feathery API ${response.status} for ${url}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
      );
      err.status = response.status;
      throw err;
    }

    return body;
  }
}

async function fetchAllPages(baseUrl, token) {
  const all = [];
  let page = 1;
  let meta = null;

  while (true) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${sep}page=${page}&page_size=100`;
    const body = await fetchJson(url, token);

    if (Array.isArray(body)) {
      all.push(...body);
      break;
    }

    const results = Array.isArray(body?.results) ? body.results : [];
    all.push(...results);

    if (!meta) {
      meta = {
        count: body?.count ?? null,
        total_pages: body?.total_pages ?? null,
        field_types: body?.field_types ?? null,
        cycle_start: body?.cycle_start ?? null,
        cycle_end: body?.cycle_end ?? null,
      };
    }

    if (!body?.next) break;
    page += 1;
    await sleep(PAGE_DELAY_MS);
  }

  return { results: all, meta };
}

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function matchFieldCount(formFieldStats, candidates) {
  if (!formFieldStats) return 0;
  for (const key of candidates) {
    if (formFieldStats[key]) {
      return Number(formFieldStats[key].form_count) || 0;
    }
  }
  return 0;
}

async function main() {
  const now = new Date().toISOString();
  const envText = await fs.readFile(envPath, "utf8").catch(() => "");
  const env = parseEnv(envText);
  const token = env.FEATHERY_TOKEN;

  if (!token) {
    console.error("No FEATHERY_TOKEN in .env.local — skipping Feathery products pull.");
    process.exitCode = 1;
    return;
  }

  console.log("Fetching Workspace Form Report (/api/workspace/report/form/) ...");
  const { results: formWorkspaces, meta: formMeta } = await fetchAllPages(
    `${API_BASE}/api/workspace/report/form/`,
    token,
  );
  console.log(`  ${formWorkspaces.length} workspace(s).`);

  console.log("\nFetching Workspace Submission Report (/api/workspace/report/submissions/) ...");
  const { results: submissionWorkspaces, meta: submissionMeta } = await fetchAllPages(
    `${API_BASE}/api/workspace/report/submissions/?billing_cycle_offset=0`,
    token,
  );
  console.log(`  ${submissionWorkspaces.length} workspace(s).`);

  const submissionsById = new Map();
  for (const ws of submissionWorkspaces) {
    submissionsById.set(ws.id, Number(ws.submissions) || 0);
  }

  const clients = [];
  const totals = {
    clientsIdentified: formWorkspaces.length,
    totalForms: 0,
    activeForms: 0,
    inactiveForms: 0,
    multiStepForms: 0,
    formsWithESignature: 0,
    formsWithUpload: 0,
    formsWithPayments: 0,
    formsWithoutPayments: 0,
    submissions: 0,
    checkouts: null,
  };

  for (const ws of formWorkspaces) {
    const forms = Array.isArray(ws.forms) ? ws.forms : [];
    const activeForms = forms.filter((f) => f.active).length;
    const inactiveForms = forms.length - activeForms;
    const multiStepForms = forms.filter((f) => Number(f.step_count) > 1).length;
    const formsWithPayments = matchFieldCount(ws.form_field_stats, PAYMENT_FIELD_TYPES);
    const formsWithESignature = matchFieldCount(ws.form_field_stats, SIGNATURE_FIELD_TYPES);
    const formsWithUpload = matchFieldCount(ws.form_field_stats, UPLOAD_FIELD_TYPES);
    const submissions = submissionsById.get(ws.id) ?? 0;

    totals.totalForms += forms.length;
    totals.activeForms += activeForms;
    totals.inactiveForms += inactiveForms;
    totals.multiStepForms += multiStepForms;
    totals.formsWithESignature += formsWithESignature;
    totals.formsWithUpload += formsWithUpload;
    totals.formsWithPayments += formsWithPayments;
    totals.submissions += submissions;

    clients.push({
      id: ws.id,
      name: ws.name,
      createdAt: ws.created_at ?? null,
      totalForms: forms.length,
      activeForms,
      inactiveForms,
      multiStepForms,
      formsWithPayments,
      formsWithESignature,
      formsWithUpload,
      submissions,
    });
  }

  totals.formsWithoutPayments = totals.totalForms - totals.formsWithPayments;

  clients.sort((a, b) => b.totalForms - a.totalForms || b.submissions - a.submissions);

  const payload = {
    generatedAt: now,
    source: "Feathery",
    billingCycle: {
      start: submissionMeta?.cycle_start ?? null,
      end: submissionMeta?.cycle_end ?? null,
    },
    fieldTypes: formMeta?.field_types ?? null,
    totals,
    clients,
  };

  const cycleLabel =
    payload.billingCycle.start && payload.billingCycle.end
      ? `${payload.billingCycle.start}..${payload.billingCycle.end}`
      : "";

  const clientCsvHeaders = [
    "workspace_id",
    "client_name",
    "created_at",
    "total_forms",
    "active_forms",
    "inactive_forms",
    "multi_step_forms",
    "forms_with_payments",
    "forms_with_esignature",
    "forms_with_upload",
    "submissions",
    "billing_cycle",
    "source_system",
    "last_refresh_utc",
  ];

  const clientCsvRows = clients.map((client) => ({
    workspace_id: client.id,
    client_name: client.name,
    created_at: client.createdAt,
    total_forms: client.totalForms,
    active_forms: client.activeForms,
    inactive_forms: client.inactiveForms,
    multi_step_forms: client.multiStepForms,
    forms_with_payments: client.formsWithPayments,
    forms_with_esignature: client.formsWithESignature,
    forms_with_upload: client.formsWithUpload,
    submissions: client.submissions,
    billing_cycle: cycleLabel,
    source_system: "Feathery",
    last_refresh_utc: now,
  }));

  const totalsCsvHeaders = [
    "metric_name",
    "metric_value",
    "metric_unit",
    "billing_cycle",
    "source_system",
    "coverage_status",
    "note",
    "last_refresh_utc",
  ];

  const totalsMetrics = [
    { metric_name: "Clients identified", metric_value: totals.clientsIdentified, note: "Feathery workspaces" },
    { metric_name: "Submissions", metric_value: totals.submissions, note: "Current billing cycle" },
    { metric_name: "Total forms", metric_value: totals.totalForms, note: "" },
    { metric_name: "Active forms", metric_value: totals.activeForms, note: "" },
    { metric_name: "Inactive forms", metric_value: totals.inactiveForms, note: "" },
    { metric_name: "Forms with multiple steps", metric_value: totals.multiStepForms, note: "step_count > 1" },
    { metric_name: "Forms with eSignature", metric_value: totals.formsWithESignature, note: "signature field" },
    { metric_name: "Forms with upload", metric_value: totals.formsWithUpload, note: "file_upload field" },
    { metric_name: "Forms with payments embedded", metric_value: totals.formsWithPayments, note: "revtrak_inventory (RevTrak) element — includes inactive forms (every form that ever embedded RevTrak)" },
    { metric_name: "Forms without payments", metric_value: totals.formsWithoutPayments, note: "" },
    { metric_name: "Checkouts", metric_value: totals.checkouts, note: "Not exposed by report endpoints" },
  ];

  const totalsCsvRows = totalsMetrics.map((m) => ({
    metric_name: m.metric_name,
    metric_value: m.metric_value === null || m.metric_value === undefined ? "" : m.metric_value,
    metric_unit: "count",
    billing_cycle: cycleLabel,
    source_system: "Feathery",
    coverage_status: m.metric_value === null || m.metric_value === undefined ? "unavailable" : "automated",
    note: m.note,
    last_refresh_utc: now,
  }));

  await fs.mkdir(backendDir, { recursive: true });
  await fs.writeFile(backendJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(clientsCsvPath, toCsv(clientCsvHeaders, clientCsvRows), "utf8");
  await fs.writeFile(totalsCsvPath, toCsv(totalsCsvHeaders, totalsCsvRows), "utf8");

  await fs.mkdir(path.dirname(publicJsonPath), { recursive: true });
  await fs.copyFile(backendJsonPath, publicJsonPath);

  console.log("\nTotals:", JSON.stringify(totals, null, 2));
  console.log(`\nWrote ${path.relative(repoRoot, backendJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, clientsCsvPath)} (${clientCsvRows.length} rows)`);
  console.log(`Wrote ${path.relative(repoRoot, totalsCsvPath)} (${totalsCsvRows.length} rows)`);
  console.log(`Copied to ${path.relative(repoRoot, publicJsonPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

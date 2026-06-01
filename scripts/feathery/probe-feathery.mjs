import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const outputDir = path.join(repoRoot, "backend/feathery/generated");
const outputSummaryPath = path.join(outputDir, "feathery-probe.json");

const API_BASE = "https://api.feathery.io";

// Field type keys in form_field_stats that map to the metrics we care about.
// Feathery may use slightly different keys per workspace, so we match against
// a list of candidates and report which one actually matched.
const PAYMENT_FIELD_TYPES = ["payment_method", "payment", "stripe", "checkout"];
const SIGNATURE_FIELD_TYPES = ["signature", "esignature", "e_signature"];
const UPLOAD_FIELD_TYPES = ["file_upload", "upload", "file"];

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

const PAGE_DELAY_MS = 1200;
const MAX_429_RETRIES = 5;

function parseRetrySeconds(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const match = /available in (\d+) seconds/i.exec(text);
  return match ? Number(match[1]) : null;
}

async function fetchJson(url, token, { retryOn429 = true } = {}) {
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

    if (response.status === 429 && retryOn429 && attempt < MAX_429_RETRIES) {
      attempt += 1;
      const headerRetry = Number(response.headers.get("retry-after"));
      const waitSeconds = headerRetry || parseRetrySeconds(body) || 30;
      console.log(`   Rate limited (429). Waiting ${waitSeconds}s then retrying (attempt ${attempt}/${MAX_429_RETRIES})...`);
      await sleep((waitSeconds + 1) * 1000);
      continue;
    }

    return { ok: response.ok, status: response.status, body };
  }
}

async function fetchAllPages(baseUrl, token) {
  const all = [];
  let page = 1;
  let meta = null;

  while (true) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${sep}page=${page}&page_size=100`;
    const { ok, status, body } = await fetchJson(url, token);

    if (!ok) {
      const err = new Error(
        `Feathery API ${status} for ${url}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
      );
      err.status = status;
      throw err;
    }

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

function matchFieldType(formFieldStats, candidates) {
  if (!formFieldStats) return null;
  for (const key of candidates) {
    if (formFieldStats[key]) {
      return { key, ...formFieldStats[key] };
    }
  }
  return null;
}

function summarizeFormReport(workspaces) {
  let totalForms = 0;
  let activeForms = 0;
  let inactiveForms = 0;
  let multiStepForms = 0;
  let formsWithPayments = 0;
  let formsWithSignature = 0;
  let formsWithUpload = 0;

  const clients = [];
  const matchedFieldKeys = { payment: new Set(), signature: new Set(), upload: new Set() };

  for (const ws of workspaces) {
    const forms = Array.isArray(ws.forms) ? ws.forms : [];
    const wsActive = forms.filter((f) => f.active).length;
    const wsInactive = forms.length - wsActive;
    const wsMultiStep = forms.filter((f) => Number(f.step_count) > 1).length;

    const payment = matchFieldType(ws.form_field_stats, PAYMENT_FIELD_TYPES);
    const signature = matchFieldType(ws.form_field_stats, SIGNATURE_FIELD_TYPES);
    const upload = matchFieldType(ws.form_field_stats, UPLOAD_FIELD_TYPES);

    if (payment) matchedFieldKeys.payment.add(payment.key);
    if (signature) matchedFieldKeys.signature.add(signature.key);
    if (upload) matchedFieldKeys.upload.add(upload.key);

    totalForms += forms.length;
    activeForms += wsActive;
    inactiveForms += wsInactive;
    multiStepForms += wsMultiStep;
    formsWithPayments += payment?.form_count ?? 0;
    formsWithSignature += signature?.form_count ?? 0;
    formsWithUpload += upload?.form_count ?? 0;

    clients.push({
      id: ws.id,
      name: ws.name,
      created_at: ws.created_at,
      total_forms: forms.length,
      active_forms: wsActive,
      inactive_forms: wsInactive,
      multi_step_forms: wsMultiStep,
      forms_with_payments: payment?.form_count ?? 0,
      forms_with_signature: signature?.form_count ?? 0,
      forms_with_upload: upload?.form_count ?? 0,
    });
  }

  return {
    totals: {
      clients_identified: workspaces.length,
      total_forms: totalForms,
      forms_with_payments: formsWithPayments,
      forms_without_payments: totalForms - formsWithPayments,
      active_forms: activeForms,
      inactive_forms: inactiveForms,
      multi_step_forms: multiStepForms,
      forms_with_esignature: formsWithSignature,
      forms_with_upload: formsWithUpload,
    },
    matched_field_keys: {
      payment: [...matchedFieldKeys.payment],
      signature: [...matchedFieldKeys.signature],
      upload: [...matchedFieldKeys.upload],
    },
    clients,
  };
}

function summarizeSubmissionReport(workspaces) {
  let totalSubmissions = 0;
  const perClient = [];

  for (const ws of workspaces) {
    const submissions = Number(ws.submissions) || 0;
    totalSubmissions += submissions;
    perClient.push({ id: ws.id, name: ws.name, submissions });
  }

  return { total_submissions: totalSubmissions, per_client: perClient };
}

async function main() {
  const now = new Date().toISOString();
  const envText = await fs.readFile(envPath, "utf8").catch(() => "");
  const env = parseEnv(envText);
  const token = env.FEATHERY_TOKEN;

  const summary = {
    probedAt: now,
    source: "Feathery",
    apiBase: API_BASE,
    status: "unknown",
    checks: {},
    notes: [],
  };

  if (!token) {
    summary.status = "error";
    summary.notes.push("Missing FEATHERY_TOKEN in .env.local");
    await writeSummary(summary);
    console.error("No FEATHERY_TOKEN found in .env.local");
    process.exitCode = 1;
    return;
  }

  // 1. Basic connectivity / auth check via the account endpoint.
  console.log("1) Checking auth via /api/account/ ...");
  try {
    const account = await fetchJson(`${API_BASE}/api/account/`, token);
    summary.checks.account = { status: account.status, ok: account.ok };
    if (account.ok) {
      console.log("   OK — token authenticated.");
    } else {
      console.log(`   Status ${account.status}.`);
    }
  } catch (error) {
    summary.checks.account = { error: error.message };
    console.error(`   Failed: ${error.message}`);
  }

  // 2. Workspace Form Report (white-label only).
  console.log("\n2) Fetching Workspace Form Report (/api/workspace/report/form/) ...");
  try {
    const { results, meta } = await fetchAllPages(
      `${API_BASE}/api/workspace/report/form/`,
      token,
    );
    const formSummary = summarizeFormReport(results);
    summary.checks.formReport = {
      ok: true,
      workspaceCount: results.length,
      meta,
      summary: formSummary,
    };
    console.log(`   OK — ${results.length} workspace(s).`);
    console.log("   Available field_types:", meta?.field_types ?? "(not returned)");
    console.log("   Matched field keys:", JSON.stringify(formSummary.matched_field_keys));
    console.log("   Totals:", JSON.stringify(formSummary.totals, null, 2));
  } catch (error) {
    summary.checks.formReport = { ok: false, status: error.status ?? null, error: error.message };
    console.error(`   Failed: ${error.message}`);
    if (error.status === 403 || error.status === 404) {
      summary.notes.push(
        "Form Report endpoint not available — it requires Feathery's white label product.",
      );
    }
  }

  // 3. Workspace Submission Report (white-label only).
  console.log("\n3) Fetching Workspace Submission Report (/api/workspace/report/submissions/) ...");
  try {
    const { results, meta } = await fetchAllPages(
      `${API_BASE}/api/workspace/report/submissions/?billing_cycle_offset=0`,
      token,
    );
    const subSummary = summarizeSubmissionReport(results);
    summary.checks.submissionReport = {
      ok: true,
      workspaceCount: results.length,
      meta,
      summary: subSummary,
    };
    console.log(`   OK — ${results.length} workspace(s).`);
    console.log(`   Billing cycle: ${meta?.cycle_start} -> ${meta?.cycle_end}`);
    console.log(`   Total submissions: ${subSummary.total_submissions}`);
  } catch (error) {
    summary.checks.submissionReport = {
      ok: false,
      status: error.status ?? null,
      error: error.message,
    };
    console.error(`   Failed: ${error.message}`);
    if (error.status === 403 || error.status === 404) {
      summary.notes.push(
        "Submission Report endpoint not available — it requires Feathery's white label product.",
      );
    }
  }

  // 4. Fallback: plain form list (works on non-white-label accounts).
  if (!summary.checks.formReport?.ok) {
    console.log("\n4) Fallback: fetching plain form list (/api/form/) ...");
    try {
      const forms = await fetchJson(`${API_BASE}/api/form/`, token);
      const list = Array.isArray(forms.body) ? forms.body : [];
      summary.checks.formList = { ok: forms.ok, status: forms.status, formCount: list.length };
      console.log(`   Status ${forms.status} — ${list.length} form(s).`);
    } catch (error) {
      summary.checks.formList = { ok: false, error: error.message };
      console.error(`   Failed: ${error.message}`);
    }
  }

  const anyOk =
    summary.checks.formReport?.ok ||
    summary.checks.submissionReport?.ok ||
    summary.checks.account?.ok;
  summary.status = anyOk ? "completed" : "error";

  await writeSummary(summary);
  console.log(`\nProbe summary written to ${path.relative(repoRoot, outputSummaryPath)}`);
}

async function writeSummary(summary) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const backendDir = path.join(repoRoot, "backend/feathery/generated");
const productsJsonPath = path.join(backendDir, "feathery-products.generated.json");
const checkoutsJsonPath = path.join(backendDir, "feathery-checkouts.generated.json");

// Per-cycle archives live under a dedicated folder so each billing cycle keeps
// its own immutable snapshot. The current cycle is re-written every run; once a
// cycle rolls over its folder is never touched again, freezing the history.
const backendCyclesDir = path.join(backendDir, "cycles");
const publicCyclesDir = path.join(repoRoot, "public/data/feathery-cycles");
const PUBLIC_URL_BASE = "/data/feathery-cycles";

const backendIndexPath = path.join(backendDir, "feathery-cycles.generated.json");
const publicIndexPath = path.join(repoRoot, "public/data/feathery-cycles.generated.json");

const ALL_TIME_FOLDER = "all-time";

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Derives the cycle window from the products payload (preferred) or the
// checkouts payload. Returns null when neither exposes a billing cycle.
function resolveCycle(products, checkouts) {
  const start = products?.billingCycle?.start ?? null;
  const end = products?.billingCycle?.end ?? null;
  if (start && end) {
    return { start, end, label: `${start} to ${end}`, folder: `${start}_${end}` };
  }
  const label = checkouts?.period?.label ?? null;
  if (label && label.includes("..")) {
    const [s, e] = label.split("..");
    return { start: s, end: e, label: `${s} to ${e}`, folder: `${s}_${e}` };
  }
  return null;
}

// Aggregates structural form metrics from the newest cycle a client appears in,
// while summing cyclical metrics (submissions, checkouts) across every cycle.
// Structural counts (forms) are point-in-time, so summing them would double
// count the same forms; cyclical counts are additive.
function buildAllTimeProducts(cycleSnapshots) {
  // cycleSnapshots: [{ start, end, products }], assumed sorted oldest -> newest.
  const byId = new Map();
  let latestStructuralCycleByClient = new Map();

  for (const snap of cycleSnapshots) {
    const products = snap.products;
    if (!products?.clients) continue;
    for (const client of products.clients) {
      const prev = byId.get(client.id);
      const summedSubmissions = (prev?.submissions ?? 0) + (Number(client.submissions) || 0);
      // Structural fields from the newest cycle seen so far (snapshots are in
      // ascending order, so the last write wins).
      byId.set(client.id, {
        id: client.id,
        name: client.name,
        createdAt: client.createdAt ?? prev?.createdAt ?? null,
        totalForms: Number(client.totalForms) || 0,
        activeForms: Number(client.activeForms) || 0,
        inactiveForms: Number(client.inactiveForms) || 0,
        multiStepForms: Number(client.multiStepForms) || 0,
        formsWithPayments: Number(client.formsWithPayments) || 0,
        formsWithESignature: Number(client.formsWithESignature) || 0,
        formsWithUpload: Number(client.formsWithUpload) || 0,
        submissions: summedSubmissions,
      });
      latestStructuralCycleByClient.set(client.id, snap.end);
    }
  }

  const clients = [...byId.values()].sort(
    (a, b) => b.totalForms - a.totalForms || b.submissions - a.submissions,
  );

  const totals = clients.reduce(
    (acc, c) => ({
      clientsIdentified: acc.clientsIdentified + 1,
      totalForms: acc.totalForms + c.totalForms,
      activeForms: acc.activeForms + c.activeForms,
      inactiveForms: acc.inactiveForms + c.inactiveForms,
      multiStepForms: acc.multiStepForms + c.multiStepForms,
      formsWithESignature: acc.formsWithESignature + c.formsWithESignature,
      formsWithUpload: acc.formsWithUpload + c.formsWithUpload,
      formsWithPayments: acc.formsWithPayments + c.formsWithPayments,
      submissions: acc.submissions + c.submissions,
    }),
    {
      clientsIdentified: 0,
      totalForms: 0,
      activeForms: 0,
      inactiveForms: 0,
      multiStepForms: 0,
      formsWithESignature: 0,
      formsWithUpload: 0,
      formsWithPayments: 0,
      submissions: 0,
    },
  );

  return { clients, totals, latestStructuralCycleByClient };
}

function buildAllTimeCheckouts(cycleSnapshots) {
  const byId = new Map();
  let checkouts = 0;
  let amount = 0;
  for (const snap of cycleSnapshots) {
    const co = snap.checkouts;
    for (const w of co?.perWorkspace ?? []) {
      const prev = byId.get(w.id) ?? { id: w.id, name: w.name, checkouts: 0, amount: 0, cycleSubmissions: 0 };
      prev.name = w.name || prev.name;
      prev.checkouts += Number(w.checkouts) || 0;
      prev.amount = round2(prev.amount + (Number(w.amount) || 0));
      prev.cycleSubmissions += Number(w.cycleSubmissions) || 0;
      byId.set(w.id, prev);
    }
    checkouts += Number(co?.currentCycle?.checkouts) || 0;
    amount += Number(co?.currentCycle?.amount) || 0;
  }
  const perWorkspace = [...byId.values()].sort((a, b) => b.checkouts - a.checkouts);
  return { checkouts, amount: round2(amount), perWorkspace };
}

async function listCycleFolders() {
  const entries = await fs.readdir(backendCyclesDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && e.name !== ALL_TIME_FOLDER)
    .map((e) => e.name);
}

async function main() {
  const products = await readJson(productsJsonPath);
  const checkouts = await readJson(checkoutsJsonPath);

  if (!products && !checkouts) {
    console.error(
      "No Feathery products/checkouts payloads found — run the pulls before archiving.",
    );
    process.exitCode = 1;
    return;
  }

  const cycle = resolveCycle(products, checkouts);
  if (!cycle) {
    console.error("Could not resolve a billing cycle from the payloads — skipping archive.");
    process.exitCode = 1;
    return;
  }

  // 1) Upsert the current cycle snapshot (overwrites this cycle's folder only).
  const backendCycleDir = path.join(backendCyclesDir, cycle.folder);
  const publicCycleDir = path.join(publicCyclesDir, cycle.folder);
  if (products) {
    await writeJson(path.join(backendCycleDir, "products.json"), products);
    await writeJson(path.join(publicCycleDir, "products.json"), products);
  }
  if (checkouts) {
    await writeJson(path.join(backendCycleDir, "checkouts.json"), checkouts);
    await writeJson(path.join(publicCycleDir, "checkouts.json"), checkouts);
  }

  // 2) Load every archived cycle (ascending by start date) for All-time aggregation.
  const folders = await listCycleFolders();
  const snapshots = [];
  for (const folder of folders) {
    const p = await readJson(path.join(backendCyclesDir, folder, "products.json"));
    const c = await readJson(path.join(backendCyclesDir, folder, "checkouts.json"));
    const start = p?.billingCycle?.start ?? folder.split("_")[0] ?? "";
    const end = p?.billingCycle?.end ?? folder.split("_")[1] ?? "";
    snapshots.push({ folder, start, end, products: p, checkouts: c });
  }
  snapshots.sort((a, b) => String(a.start).localeCompare(String(b.start)));

  // 3) Build the All-time aggregate snapshot (one file the front loads directly).
  const now = new Date().toISOString();
  const allStart = snapshots[0]?.start ?? cycle.start;
  const allEnd = snapshots[snapshots.length - 1]?.end ?? cycle.end;

  const atProducts = buildAllTimeProducts(snapshots);
  const allTimeProducts = {
    generatedAt: now,
    source: "Feathery",
    billingCycle: { start: allStart, end: allEnd },
    fieldTypes: products?.fieldTypes ?? null,
    totals: {
      ...atProducts.totals,
      formsWithoutPayments: Math.max(
        0,
        atProducts.totals.totalForms - atProducts.totals.formsWithPayments,
      ),
      checkouts: buildAllTimeCheckouts(snapshots).checkouts,
    },
    clients: atProducts.clients,
  };

  const atCheckouts = buildAllTimeCheckouts(snapshots);
  const allTimeCheckouts = {
    generatedAt: now,
    source: "Feathery",
    definition: "checkout = submission with a populated RevTrak OrderId hidden field",
    period: { since: allStart ? `${allStart}T00:00:00Z` : null, label: "All-time" },
    currentCycle: { checkouts: atCheckouts.checkouts, amount: atCheckouts.amount },
    accumulated: {
      checkouts: atCheckouts.checkouts,
      amount: atCheckouts.amount,
      closedCycles: snapshots.length,
    },
    coverage: checkouts?.coverage ?? null,
    perWorkspace: atCheckouts.perWorkspace,
  };

  await writeJson(path.join(backendCyclesDir, ALL_TIME_FOLDER, "products.json"), allTimeProducts);
  await writeJson(path.join(publicCyclesDir, ALL_TIME_FOLDER, "products.json"), allTimeProducts);
  await writeJson(path.join(backendCyclesDir, ALL_TIME_FOLDER, "checkouts.json"), allTimeCheckouts);
  await writeJson(path.join(publicCyclesDir, ALL_TIME_FOLDER, "checkouts.json"), allTimeCheckouts);

  // 4) Build the index that drives the front dropdown (newest cycle first,
  //    then All-time as a synthetic option).
  const cycleEntries = snapshots
    .map((s) => ({
      folder: s.folder,
      label: s.start && s.end ? `${s.start} to ${s.end}` : s.folder,
      start: s.start,
      end: s.end,
      current: s.folder === cycle.folder,
      productsUrl: `${PUBLIC_URL_BASE}/${s.folder}/products.json`,
      checkoutsUrl: `${PUBLIC_URL_BASE}/${s.folder}/checkouts.json`,
      generatedAt: s.products?.generatedAt ?? s.checkouts?.generatedAt ?? null,
    }))
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));

  const allTimeEntry = {
    folder: ALL_TIME_FOLDER,
    label: "All-time",
    start: allStart,
    end: allEnd,
    current: false,
    productsUrl: `${PUBLIC_URL_BASE}/${ALL_TIME_FOLDER}/products.json`,
    checkoutsUrl: `${PUBLIC_URL_BASE}/${ALL_TIME_FOLDER}/checkouts.json`,
    generatedAt: now,
  };

  const index = {
    generatedAt: now,
    current: cycle.folder,
    cycles: [...cycleEntries, allTimeEntry],
  };

  await writeJson(backendIndexPath, index);
  await writeJson(publicIndexPath, index);

  console.log("=== Feathery cycle archive ===");
  console.log(`Current cycle: ${cycle.label} (${cycle.folder})`);
  console.log(`Archived cycles: ${snapshots.length}`);
  console.log(`Index: ${path.relative(repoRoot, publicIndexPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

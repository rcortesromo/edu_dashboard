import { useEffect, useMemo, useState } from "react";

export type FeatheryClient = {
  id: string;
  name: string;
  createdAt: string | null;
  totalForms: number;
  activeForms: number;
  inactiveForms: number;
  multiStepForms: number;
  formsWithPayments: number;
  formsWithESignature: number;
  formsWithUpload: number;
  submissions: number;
};

export type FeatheryTotals = {
  clientsIdentified: number;
  totalForms: number;
  activeForms: number;
  inactiveForms: number;
  multiStepForms: number;
  formsWithESignature: number;
  formsWithUpload: number;
  formsWithPayments: number;
  formsWithoutPayments: number;
  submissions: number;
  checkouts: number | null;
};

export type FeatheryProductsPayload = {
  generatedAt: string;
  source: string;
  billingCycle: { start: string | null; end: string | null };
  fieldTypes: string[] | null;
  totals: FeatheryTotals;
  clients: FeatheryClient[];
};

export type FeatheryProductsState = {
  payload: FeatheryProductsPayload | null;
  loading: boolean;
  error: string;
};

export const FEATHERY_PRODUCTS_FEED_URL = "/data/feathery-products.generated.json";

export function useFeatheryProducts(url: string = FEATHERY_PRODUCTS_FEED_URL): FeatheryProductsState {
  const [payload, setPayload] = useState<FeatheryProductsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error("Feathery products feed is unavailable. Run npm run pull:feathery-products.");
        }

        const data = (await response.json()) as FeatheryProductsPayload;

        if (!cancelled) {
          setPayload(data);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Unable to load the Feathery products feed.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { payload, loading, error };
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-US").format(value);
}

export type SummaryMetric = {
  label: string;
  value: number | null;
  note?: string;
};

export function buildSummaryMetrics(
  totals: FeatheryTotals,
  checkouts?: number | null,
): SummaryMetric[] {
  return [
    { label: "Clients identified", value: totals.clientsIdentified, note: "Feathery workspaces" },
    { label: "Submissions", value: totals.submissions, note: "Current billing cycle" },
    { label: "Total forms", value: totals.totalForms },
    { label: "Active forms", value: totals.activeForms },
    { label: "Inactive forms", value: totals.inactiveForms },
    { label: "Forms with multiple steps", value: totals.multiStepForms },
    { label: "Forms with eSignature", value: totals.formsWithESignature },
    { label: "Forms with upload", value: totals.formsWithUpload },
    {
      label: "Forms with payments embedded",
      value: totals.formsWithPayments,
      note: "Includes inactive forms — every form that ever embedded RevTrak",
    },
    { label: "Forms without payments", value: totals.formsWithoutPayments },
    {
      label: "Checkouts",
      value: checkouts ?? null,
      note: "RevTrak orders, current billing cycle",
    },
  ];
}

export type FeatheryCheckoutsClient = {
  id: string;
  name: string;
  checkouts: number;
  amount: number;
  cycleSubmissions: number;
};

export type FeatheryCheckoutsPayload = {
  generatedAt: string;
  source: string;
  definition: string;
  period: { since: string | null; label: string };
  currentCycle: { checkouts: number; amount: number };
  accumulated: { checkouts: number; amount: number; closedCycles: number };
  coverage: {
    workspacesWithRevtrak: number;
    workspacesProcessed: number;
    workspacesScanned: number;
    skippedNoSubmissions: number;
    skippedNoChange: number;
    activeFormsOnly: boolean;
  };
  perWorkspace: FeatheryCheckoutsClient[];
};

export type FeatheryCheckoutsState = {
  payload: FeatheryCheckoutsPayload | null;
  loading: boolean;
  error: string;
};

export const FEATHERY_CHECKOUTS_FEED_URL = "/data/feathery-checkouts.generated.json";

export function useFeatheryCheckouts(
  url: string = FEATHERY_CHECKOUTS_FEED_URL,
): FeatheryCheckoutsState {
  const [payload, setPayload] = useState<FeatheryCheckoutsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error("Feathery checkouts feed is unavailable.");
        }

        const data = (await response.json()) as FeatheryCheckoutsPayload;

        if (!cancelled) {
          setPayload(data);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Unable to load the Feathery checkouts feed.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { payload, loading, error };
}

export type FeatheryCycleEntry = {
  folder: string;
  label: string;
  start: string | null;
  end: string | null;
  current: boolean;
  productsUrl: string;
  checkoutsUrl: string;
  generatedAt: string | null;
};

export type FeatheryCyclesIndex = {
  generatedAt: string;
  current: string;
  cycles: FeatheryCycleEntry[];
};

// Presentation label for a billing cycle: month + year derived from the cycle
// start date (e.g. "June 2026"). The All-time aggregate keeps its own label.
export function formatCycleLabel(entry: FeatheryCycleEntry): string {
  if (entry.folder === "all-time") return "All-time";
  if (!entry.start) return entry.label;
  const date = new Date(`${entry.start}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return entry.label;
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export type FeatheryCyclesState = {
  index: FeatheryCyclesIndex | null;
  loading: boolean;
  error: string;
};

export const FEATHERY_CYCLES_INDEX_URL = "/data/feathery-cycles.generated.json";

export function useFeatheryCycles(): FeatheryCyclesState {
  const [index, setIndex] = useState<FeatheryCyclesIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(FEATHERY_CYCLES_INDEX_URL);

        if (!response.ok) {
          throw new Error("Feathery cycles index is unavailable.");
        }

        const data = (await response.json()) as FeatheryCyclesIndex;

        if (!cancelled) {
          setIndex(data);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Unable to load the Feathery cycles index.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return { index, loading, error };
}

export type FeatheryCycleSelection = {
  cycles: FeatheryCycleEntry[];
  selectedFolder: string;
  setSelectedFolder: (folder: string) => void;
  selectedEntry: FeatheryCycleEntry | null;
  productsUrl: string;
  checkoutsUrl: string;
};

// Shared billing-cycle selector state for the Feathery pages. Defaults to the
// current cycle and falls back to the canonical feed URLs until the index loads
// (so the page still renders before the cycle list is available).
export function useFeatheryCycleSelection(): FeatheryCycleSelection {
  const { index } = useFeatheryCycles();
  const [selectedFolder, setSelectedFolder] = useState("");

  const cycles = index?.cycles ?? [];

  const selectedEntry = useMemo(() => {
    if (!cycles.length) return null;
    const chosen = selectedFolder
      ? cycles.find((c) => c.folder === selectedFolder)
      : undefined;
    return chosen ?? cycles.find((c) => c.current) ?? cycles[0];
  }, [cycles, selectedFolder]);

  return {
    cycles,
    selectedFolder,
    setSelectedFolder,
    selectedEntry,
    productsUrl: selectedEntry?.productsUrl ?? FEATHERY_PRODUCTS_FEED_URL,
    checkoutsUrl: selectedEntry?.checkoutsUrl ?? FEATHERY_CHECKOUTS_FEED_URL,
  };
}

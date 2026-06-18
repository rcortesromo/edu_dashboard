import { useEffect, useState } from "react";

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

const FEED_URL = "/data/feathery-products.generated.json";

export function useFeatheryProducts(): FeatheryProductsState {
  const [payload, setPayload] = useState<FeatheryProductsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(FEED_URL);

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
  }, []);

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

const CHECKOUTS_FEED_URL = "/data/feathery-checkouts.generated.json";

export function useFeatheryCheckouts(): FeatheryCheckoutsState {
  const [payload, setPayload] = useState<FeatheryCheckoutsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(CHECKOUTS_FEED_URL);

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
  }, []);

  return { payload, loading, error };
}

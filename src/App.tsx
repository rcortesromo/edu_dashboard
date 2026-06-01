import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import TopBar from "./components/TopBar";
import {
  buildTeamSummaries,
  buildPeriodOptions,
  defaultPeriodKey,
  getPeriodOption,
  getSprintsForQuarter,
  type MetricsPayload,
} from "./lib/metrics";
import HomePage from "./pages/HomePage";
import MetricsPage from "./pages/MetricsPage";
import TrendsPage from "./pages/TrendsPage";
import ProductsPage from "./pages/ProductsPage";
import ProductTrendsPage from "./pages/ProductTrendsPage";

function App() {
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [selectedSprint, setSelectedSprint] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/data/metrics.generated.json");

        if (!response.ok) {
          throw new Error("Published metrics feed is unavailable.");
        }

        const data = (await response.json()) as MetricsPayload;

        if (!cancelled) {
          setPayload(data);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Unable to load the published metrics feed.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMetrics();

    return () => {
      cancelled = true;
    };
  }, []);

  const periodOptions = useMemo(() => buildPeriodOptions(payload), [payload]);
  const activePeriod = useMemo(
    () => getPeriodOption(periodOptions, selectedPeriod),
    [periodOptions, selectedPeriod],
  );
  const teamSummaries = useMemo(
    () => buildTeamSummaries(payload, activePeriod?.key ?? selectedPeriod, selectedSprint || undefined),
    [activePeriod?.key, payload, selectedPeriod, selectedSprint],
  );
  const availableSprints = useMemo(
    () => getSprintsForQuarter(payload, activePeriod?.key ?? selectedPeriod),
    [payload, activePeriod?.key, selectedPeriod],
  );

  useEffect(() => {
    if (periodOptions.length === 0) {
      if (selectedPeriod) {
        setSelectedPeriod("");
      }
      return;
    }

    if (!selectedPeriod || !periodOptions.some((period) => period.key === selectedPeriod)) {
      setSelectedPeriod(defaultPeriodKey(periodOptions));
      setSelectedSprint("");
    }
  }, [periodOptions, selectedPeriod]);

  function handleSelectPeriod(key: string) {
    setSelectedPeriod(key);
    setSelectedSprint("");
  }

  return (
    <div className="app-shell">
      <TopBar />
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              teams={teamSummaries}
              loading={loading}
              error={error}
              periodOptions={periodOptions}
              selectedPeriod={selectedPeriod}
              onSelectPeriod={handleSelectPeriod}
            />
          }
        />
        <Route
          path="/metrics"
          element={
            <MetricsPage
              teams={teamSummaries}
              loading={loading}
              error={error}
              periodOptions={periodOptions}
              selectedPeriod={selectedPeriod}
              onSelectPeriod={handleSelectPeriod}
              availableSprints={availableSprints}
              selectedSprint={selectedSprint}
              onSelectSprint={setSelectedSprint}
            />
          }
        />
        <Route
          path="/trends"
          element={
            <TrendsPage
              payload={payload}
              loading={loading}
              error={error}
            />
          }
        />
        <Route path="/business-metrics/feathery" element={<ProductsPage />} />
        <Route path="/business-metrics/feathery/trends" element={<ProductTrendsPage />} />
        <Route path="/products" element={<Navigate to="/business-metrics/feathery" replace />} />
        <Route
          path="/products/trends"
          element={<Navigate to="/business-metrics/feathery/trends" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;

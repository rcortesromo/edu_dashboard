import type { PeriodOption } from "../lib/metrics";

type PeriodSelectorProps = {
  options: PeriodOption[];
  selectedPeriod: string;
  onSelectPeriod: (periodKey: string) => void;
};

function PeriodSelector({ options, selectedPeriod, onSelectPeriod }: PeriodSelectorProps) {
  if (options.length <= 1) {
    return null;
  }

  const quarters = options.filter((o) => o.kind === "quarter");
  const ytdOptions = options.filter((o) => o.kind === "ytd");

  return (
    <div className="period-selector">
      <select
        className="period-dropdown"
        value={selectedPeriod}
        onChange={(e) => onSelectPeriod(e.target.value)}
        aria-label="Reporting period"
      >
        {quarters.length > 0 && (
          <optgroup label="Quarters">
            {quarters.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
                {option.isInProgress ? " (in progress)" : ""}
              </option>
            ))}
          </optgroup>
        )}
        {ytdOptions.length > 0 && (
          <optgroup label="Year to Date">
            {ytdOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

export default PeriodSelector;

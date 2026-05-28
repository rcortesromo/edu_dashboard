import { formatDateRange, type SprintInfo } from "../lib/metrics";

type SprintSelectorProps = {
  sprints: SprintInfo[];
  selectedSprint: string;
  onSelectSprint: (sprintKey: string) => void;
};

function SprintSelector({ sprints, selectedSprint, onSelectSprint }: SprintSelectorProps) {
  if (sprints.length === 0) {
    return null;
  }

  return (
    <div className="sprint-selector">
      <label className="trends-toolbar-label" htmlFor="sprint-select">Sprint</label>
      <select
        id="sprint-select"
        className="period-dropdown"
        value={selectedSprint}
        onChange={(e) => onSelectSprint(e.target.value)}
        aria-label="Sprint filter"
      >
        <option value="">All sprints (quarter)</option>
        {sprints.map((sprint) => {
          const dateLabel = formatDateRange(sprint.start, sprint.end);
          return (
            <option key={sprint.key} value={sprint.key}>
              Sprint {sprint.sequence}{dateLabel ? ` (${dateLabel})` : ""}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export default SprintSelector;

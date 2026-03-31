# EDU Dashboard Documentation

## Purpose

This project is building an executive dashboard for SDLC and delivery efficiency reporting.

The current implementation focus is the backend data pipeline for Jira-based metrics. The backend is designed around:

- Jira as the source system
- Excel-compatible CSV layers as the reporting backend
- JSON as the frontend handoff format
- quarter-level executive reporting
- sprint-level raw calculations underneath

## Current Scope

The first version currently targets these two metrics:

1. `Jira Card Churn %`
2. `Estimated Cycle Time (weeks)`

These metrics are reported by:

- `team x quarter`

But are calculated from:

- `team x sprint`

## Teams In Scope

The tracked teams for v1 are:

- `Team Webstore`
- `Team Connexpoint`

These teams are configured in:

- `backend/excel/jira-field-mapping.template.json`

Current team-to-board mapping:

- `Team Webstore` -> board `175`
- `Team Connexpoint` -> board `170`

Both currently use:

- project `OV`
- the same shared workflow assumptions
- the same team field in Jira

## Jira Field Mapping

The confirmed Jira fields for the current implementation are:

- `Sprint` -> `customfield_10020`
- `Team` -> `customfield_10032`
- `Story Points` -> `customfield_10043`

These are currently represented in:

- `.env.local`
- `.env.example`
- `backend/excel/jira-field-mapping.template.json`
- `backend/excel/templates/config.csv`

## Metric Definitions

### Jira Card Churn %

Sprint-level formula:

```text
((Cards removed + Cards re-estimated + Cards sent backward after sprint start) / Cards committed at sprint start) * 100
```

Quarter-level rollup:

```text
((Sum removed + Sum re-estimated + Sum sent backward) / Sum committed at sprint start) * 100
```

Important design choices:

- count sprint churn from sprint events, not by averaging sprint percentages
- count each issue once per churn category per sprint
- use changelog timestamps to determine if the event happened after sprint start

### Estimated Cycle Time (weeks)

Formula:

```text
(Average WIP / Average Throughput per Sprint) * 2
```

Current unit choice for v1:

- `Average WIP` = cards
- `Average Throughput per Sprint` = completed cards

So the current interpretation is:

```text
Estimated Cycle Time (weeks) = (Average WIP in cards / Average completed cards per sprint) * 2
```

This remains a proxy until true timestamp-based cycle time is introduced.

## Core Business Rules

### Committed At Sprint Start

For v1:

- a card is committed if it belonged to the sprint at the exact sprint start timestamp
- late-added cards are not part of the committed baseline

### Re-estimation

For v1:

- re-estimation means story points changed after sprint start
- multiple changes to the same issue in the same sprint count once for churn

### Sent Backward

For v1:

- an issue is counted as sent backward when its status transitions to an earlier workflow stage after sprint start

### Completed Status

Current shared completed status:

- `Closed`

This uses Jira `Status`, not `Resolution`.

## Shared Workflow Order

The current shared workflow order for both tracked teams is:

1. `New`
2. `Ready For Refinement`
3. `Ready for Sprint`
4. `In Development`
5. `Awaiting Build`
6. `In Secure Code Review`
7. `Ready To Test`
8. `In Test`
9. `In Verification`
10. `Closed`

This ordering is currently configured in:

- `backend/excel/templates/config.csv`

## Reporting Period Logic

The reporting model is quarter-based, including partial current quarters.

This means:

- the quarter does not need to be closed
- the current quarter can be calculated quarter-to-date
- the script should be able to refresh the current quarter multiple times
- the latest run should only pull what is needed, but recalculate the current quarter completely

Example:

- if `Q1` is still in progress, the script can still calculate `Q1`
- if `Q2` starts later, the script creates a new incremental checkpoint for `Q2`
- if the script runs again during the same quarter, it should update that quarter with the newest Jira data

## Incremental Refresh Design

Incremental quarter tracking is handled with:

- `refresh_control.csv`

Template:

- `backend/excel/templates/refresh_control.csv`

Generated output:

- `backend/excel/generated/refresh_control.csv`

Purpose:

- track the quarter being processed
- track latest successful refresh
- track latest issue update timestamp already captured
- track latest sprint end processed
- identify whether the current quarter should be recalculated fully

## Excel Backend Structure

The backend currently uses CSV templates that mirror the workbook structure.

Workbook-compatible tabs:

1. `config`
2. `jira_issues_raw`
3. `jira_changelog_raw`
4. `sprint_calendar`
5. `metric_inputs_by_sprint`
6. `metric_outputs_by_quarter`
7. `json_export_view`
8. `refresh_control` (added for incremental quarter tracking)

Template files:

- `backend/excel/templates/config.csv`
- `backend/excel/templates/jira_issues_raw.csv`
- `backend/excel/templates/jira_changelog_raw.csv`
- `backend/excel/templates/sprint_calendar.csv`
- `backend/excel/templates/metric_inputs_by_sprint.csv`
- `backend/excel/templates/metric_outputs_by_quarter.csv`
- `backend/excel/templates/json_export_view.csv`
- `backend/excel/templates/refresh_control.csv`

## Generated CSV Outputs

The Jira pipeline writes generated files to:

- `backend/excel/generated/`

Current generated output targets:

- `jira_issues_raw.csv`
- `jira_changelog_raw.csv`
- `sprint_calendar.csv`
- `metric_inputs_by_sprint.csv`
- `metric_outputs_by_quarter.csv`
- `json_export_view.csv`
- `refresh_control.csv`

This folder is ignored by git.

## Script Architecture

### Jira Extraction And Calculation Script

Main script:

- `scripts/pull-jira-quarterly-metrics.mjs`

What it does:

1. reads `.env.local`
2. reads Jira team scope and field mapping from `backend/excel/jira-field-mapping.template.json`
3. reads rules from `backend/excel/templates/config.csv`
4. determines the current quarter
5. fetches sprints for the configured boards
6. fetches Jira issues for the current quarter
7. fetches changelog for relevant issues
8. writes raw issue and changelog CSV outputs
9. calculates sprint-level metric inputs
10. calculates quarter-level outputs
11. updates `refresh_control.csv`
12. produces `json_export_view.csv`

### JSON Export Script

JSON export helper:

- `scripts/export-jira-metrics-json.mjs`

What it does:

- takes the flattened `json_export_view` CSV
- converts it into the JSON payload used by the frontend

## Package Scripts

Current package scripts:

- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run export:metrics-json`
- `npm run pull:jira-quarterly-metrics`

## Environment Variables

Local Jira credentials are stored in:

- `.env.local`

Template:

- `.env.example`

Current relevant variables:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_SPRINT_FIELD_ID`
- `JIRA_TEAM_FIELD_ID`
- `JIRA_STORY_POINTS_FIELD_ID`
- `JIRA_COMPLETED_STATUSES`
- `JIRA_INCLUDED_ISSUE_TYPES`
- `JIRA_EXCLUDED_ISSUE_TYPES`
- `JIRA_BOARD_IDS`
- `JIRA_PROJECT_KEYS`

Important rule:

- secrets live in `.env.local`
- frontend code must not consume Jira credentials directly
- React should only consume the final JSON output

## Current File Responsibilities

### Configuration

- `backend/excel/jira-field-mapping.template.json`
- `backend/excel/templates/config.csv`
- `.env.example`
- `.env.local`

### Rules And Documentation

- `backend/excel/README.md`
- `backend/excel/rules.md`

### Raw And Calculated Reporting Layers

- `backend/excel/templates/*.csv`
- `backend/excel/generated/*.csv`

### Scripts

- `scripts/pull-jira-quarterly-metrics.mjs`
- `scripts/export-jira-metrics-json.mjs`

### Frontend Handoff

- `backend/excel/json/metrics.schema.json`
- `backend/excel/json/metrics.sample.json`

## Current End-To-End Flow

The current intended flow is:

```text
Jira -> pull-jira-quarterly-metrics.mjs -> generated CSVs -> Excel-compatible reporting layers -> export-jira-metrics-json.mjs -> JSON -> React dashboard
```

Or more specifically:

```text
Jira API
  -> jira_issues_raw.csv
  -> jira_changelog_raw.csv
  -> sprint_calendar.csv
  -> metric_inputs_by_sprint.csv
  -> metric_outputs_by_quarter.csv
  -> json_export_view.csv
  -> metrics JSON
  -> frontend
```

## Current Assumptions

These assumptions are currently in effect:

- quarter convention is `calendar`
- metrics are calculated for the selected quarter, including the current quarter if incomplete
- the current quarter is recalculated on each run
- two teams are in scope
- both teams share the same workflow
- throughput is based on completed cards
- cycle time is a proxy, not true Jira timestamp cycle time

## Known Limitations

- the current pipeline is focused on Jira only
- the cycle time metric is still a proxy
- the current implementation depends on Jira changelog access
- generated files are CSV-first, not direct `.xlsx` output
- the local execution environment used by the coding agent did not have `node` available for runtime smoke testing, so execution must be validated on the user machine

## Recommended Run Order

1. Fill `.env.local`
2. Review `backend/excel/jira-field-mapping.template.json`
3. Review `backend/excel/templates/config.csv`
4. Run in automatic mode for the current quarter:

```bash
npm run pull:jira-quarterly-metrics
```

1. Or run for a specific quarter:

```bash
npm run pull:jira-quarterly-metrics -- --quarter 2026-Q1
```

1. Accepted quarter format:
   - `YYYY-Q#`
   - example: `2026-Q1`

1. Review:
   - `backend/excel/generated/*.csv`
1. Run:

```bash
npm run export:metrics-json -- "backend/excel/generated/json_export_view.csv" "backend/excel/json/metrics.generated.json"
```

## Next Logical Enhancements

Possible next steps after the current foundation:

- connect the React dashboard directly to generated JSON
- automate direct `.xlsx` writing if needed later
- add additional metrics beyond churn and cycle time
- add quarter locking rules
- expand from Jira to Aha! or other systems

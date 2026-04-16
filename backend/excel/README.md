# Excel Backend For Jira Metrics

This folder defines the first Excel-based backend for the executive dashboard.

The design uses sprint-level Jira data as the raw layer, then rolls the metrics up to quarter-level executive reporting.

## V1 scope

- `Jira Card Churn %`
- `Average Velocity (points per sprint)`
- `Flow-based Cycle Time Proxy (weeks)`
- `Actual Cycle Time (weeks)`

## Reporting model

- Raw ingestion grain: `issue`, `change event`, and `team x sprint`
- Executive reporting grain: `team x quarter`
- Source system: `Jira`
- Data handoff to frontend: `JSON`
- Work-item unit can be team-specific when one board flows on subtasks

## EDU portfolio layer

The reporting layer now also supports a derived portfolio row named `EDU`.

`EDU` is not a Jira-native team.

It is a synthetic quarter-level rollup built from the tracked in-scope teams.

Current frontend labels:

- `Team Connexpoint` -> `CXP`
- `Team Webstore` -> `Revtrak`

Current portfolio composition:

- `CXP`
- `Revtrak`

The `EDU` row is emitted alongside the team rows in:

- `metric_outputs_by_quarter.csv`
- `json_export_view.csv`
- the exported frontend JSON payload

This allows the frontend to render one portfolio summary card group above the team-level breakdown.

## Workbook tabs

The workbook should contain these tabs in this order:

1. `config`
2. `jira_issues_raw`
3. `jira_changelog_raw`
4. `sprint_calendar`
5. `metric_inputs_by_sprint`
6. `cycle_time_issue_level`
7. `metric_outputs_by_quarter`
8. `json_export_view`

CSV templates for each tab live in `templates/`.

The Jira extraction script writes generated quarter data to `backend/excel/generated/`.
That generated folder is intentionally ignored by git.

## Required Jira definitions

Fill these before automating the Jira pull:

- sprint field id or name
- team field id or team-mapping rule
- story points field id or name
- issue types included in scope
- completed statuses
- workflow order used to detect backward movement

These placeholders live in `jira-field-mapping.template.json` and `templates/config.csv`.

## Default business rules

Unless you override them later, this implementation assumes:

- `committed at sprint start` means the issue belongs to the sprint at the exact sprint start timestamp
- `re-estimated` means story points changed after sprint start
- `sent backward` means a post-start status transition to an earlier configured workflow stage
- `Average WIP` is tracked in cards
- `Average Throughput per Sprint` is tracked as completed cards per sprint
- quarter labels use calendar quarter format such as `2026-Q1`

## Metric formulas

### Jira Card Churn %

Sprint-level formula:

`((Cards removed + Cards re-estimated + Cards sent backward after sprint start) / Cards committed at sprint start) * 100`

Quarter-level rollup:

`((Sum removed + Sum re-estimated + Sum sent backward) / Sum committed at sprint start) * 100`

This avoids distorting quarter results by averaging sprint percentages directly.

`EDU` rollup rule:

`((sum removed + sum re-estimated + sum sent backward) / sum committed at sprint start) * 100`

Do not average team churn percentages directly.

### Flow-based Cycle Time Proxy (weeks)

Sprint-level proxy:

`(Average WIP / Average Throughput per Sprint) * 2`

Quarter-level rollup:

`(Average sprint WIP across the quarter / Average sprint throughput across the quarter) * 2`

This is a system-flow proxy, not true elapsed issue duration.

`EDU` rollup rule:

`(sum(team average WIP * team sprint count) / sum(team average throughput * team sprint count)) * 2`

Equivalent interpretation:

- rebuild from total portfolio WIP and total portfolio throughput
- do not average team proxy values directly

### Average Velocity (points per sprint)

Sprint-level value:

`completed story points in the sprint`

Quarter-level rollup:

`sum of completed story points across quarter sprints / number of sprints in quarter`

This is a sprint-output metric for the team, not a flow-time metric.

Current source rule:

- `Team Webstore`: calculated completed points from in-scope issues
- `Team Connexpoint`: Jira board velocity report

`EDU` rollup rule:

`sum(team average velocity * team sprint count) / sum(team sprint count)`

Equivalent interpretation:

- total completed points across in-scope teams
- divided by total counted sprints across in-scope teams

Do not average team velocity values directly.

### Actual Cycle Time (weeks)

True cycle time is calculated per completed issue from a team-specific start rule until the Jira Done category, but only when the issue resolution at that closing timestamp is `Done`.

Current v1 team rules:

- `Team Webstore`: `In Development -> Done category`
- `Team Connexpoint`: `In Development -> Done category`

Quarter rollup:

- average the completed-item cycle times whose end timestamp falls inside the target quarter
- for each completed item, use the last matching start-state transition before the valid close

Flow-based completion rule:

- completed cards used for throughput only count when the issue also has resolution `Done`

`EDU` rollup rule:

`sum(team actual cycle time * team completed-item count) / sum(team completed-item count)`

Do not average team actual cycle time values directly.

## Current EDU example

Current `2026-Q1` quarter output after sprint-name filtering:

- `CXP`
  - `sprints_in_quarter` = `6`
  - `cards_committed_at_start_total` = `349`
  - `cards_removed_after_start_total` = `0`
  - `cards_reestimated_after_start_total` = `0`
  - `cards_sent_backward_after_start_total` = `12`
  - `average_velocity_points_per_sprint` = `51.3333`
  - `average_wip_cards` = `10.4956`
  - `average_throughput_cards_per_sprint` = `22.6667`
  - `actual_cycle_time_weeks` = `0.5925`
  - `actual_cycle_time_issue_count` = `146`
- `Revtrak`
  - `sprints_in_quarter` = `6`
  - `cards_committed_at_start_total` = `255`
  - `cards_removed_after_start_total` = `2`
  - `cards_reestimated_after_start_total` = `22`
  - `cards_sent_backward_after_start_total` = `8`
  - `average_velocity_points_per_sprint` = `27.0000`
  - `average_wip_cards` = `18.4339`
  - `average_throughput_cards_per_sprint` = `5.8333`
  - `actual_cycle_time_weeks` = `2.5786`
  - `actual_cycle_time_issue_count` = `37`

Published `EDU` results:

- `EDU Jira Card Churn %` = `7.28%`
- `EDU Average Velocity (points per sprint)` = `39.17`
- `EDU Flow-based Cycle Time Proxy (weeks)` = `2.03`
- `EDU Actual Cycle Time (weeks)` = `0.99`

### Jira Card Churn % example

`EDU` churn is rebuilt from total churn counts and total committed baseline:

`((2 + 22 + 20) / 604) * 100 = (44 / 604) * 100 = 7.2847%`

Rounded published value:

- `7.28%`

This is not:

`(3.44% + 12.55%) / 2`

### Average Velocity (points per sprint) example

`EDU` velocity is weighted by counted sprint count:

`((51.3333 * 6) + (27.0000 * 6)) / 12 = (307.9998 + 162.0000) / 12 = 39.1666`

Rounded published value:

- `39.17`

Because both teams currently have `6` counted sprints, this quarter happens to align with the simple average of the two team values.

### Flow-based Cycle Time Proxy (weeks) example

`EDU` flow proxy is rebuilt from total WIP and total throughput, not from averaging team proxy values.

Using the current quarter sprint totals:

- `CXP total WIP across counted sprints` = `62.9735`
- `Revtrak total WIP across counted sprints` = `110.6035`
- `Portfolio WIP total` = `173.5770`
- `CXP total throughput across counted sprints` = `136`
- `Revtrak total throughput across counted sprints` = `35`
- `Portfolio throughput total` = `171`

Calculation:

`(173.5770 / 171) * 2 = 2.0301`

Rounded published value:

- `2.03`

This is not:

`(0.93 + 6.32) / 2`

### Actual Cycle Time (weeks) example

`EDU` actual cycle time is weighted by completed item count using exact issue-level cycle-time rows.

Using the current quarter issue-level totals:

- `CXP cycle time sum` = `86.50` weeks across `146` completed items
- `Revtrak cycle time sum` = `95.41` weeks across `37` completed items
- `Portfolio cycle time sum` = `181.91` weeks across `183` completed items

Calculation:

`181.91 / 183 = 0.9940`

Rounded published value:

- `0.99`

This is not:

`(0.59 + 2.58) / 2`

## File roles

- `templates/`: workbook tab templates
- `jira-field-mapping.template.json`: Jira API field mapping placeholders
- `json/metrics.schema.json`: JSON contract for the frontend
- `json/metrics.sample.json`: example exported payload

## Secrets and environment variables

Keep Jira credentials in a root-level `.env.local` file and do not expose them to the React app.

- `.env.example`: committed template with variable names only
- `.env.local`: real local credentials, ignored by git

Recommended variables:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`

Configuration source of truth:

- Jira field IDs and tracked team settings live in `jira-field-mapping.template.json`
- issue type scope, completed statuses, and workflow rules live in `templates/config.csv`

Separation of responsibilities in the same repo:

- `src/`: frontend code, should only consume the final JSON output
- `scripts/`: private extraction or transformation scripts, can read `.env.local`
- `backend/excel/`: workbook templates, rules, and export structure

Do not pass Jira secrets into `src/`, `public/`, or any `VITE_*` variable unless the value is explicitly safe for browser exposure.

## Export flow

1. Pull raw Jira issue and changelog data.
2. Populate the raw tabs.
3. Calculate `metric_inputs_by_sprint`.
4. Roll up to `metric_outputs_by_quarter`.
5. Flatten into `json_export_view`.
6. Export that view to a JSON payload matching `json/metrics.schema.json`.
7. Copy the generated JSON into `public/data/metrics.generated.json` when publishing through the frontend.

## JSON export helper

Use the included script after exporting the `json_export_view` tab to CSV:

```bash
npm run export:metrics-json -- "backend/excel/examples/json_export_view.sample.csv" "backend/excel/json/metrics.generated.json"
```

Replace the sample CSV path with the real CSV export from Excel.

## Static App refresh helper

To refresh both the internal JSON contract and the public frontend JSON in one step:

```bash
npm run refresh:static-metrics -- --quarter 2026-Q1
```

This updates:

- `backend/excel/json/metrics.generated.json`
- `public/data/metrics.generated.json`

Use this command when you want the dashboard UI to reflect the latest pulled quarter data.

## Jira extraction helper

Use the Node.js pipeline to pull the current quarter for the configured teams and calculate the current v1 metrics:

```bash
npm run pull:jira-quarterly-metrics
```

Run a specific quarter:

```bash
npm run pull:jira-quarterly-metrics -- --quarter 2026-Q1
```

This command refreshes backend generated CSV outputs, but it does not update `public/data/metrics.generated.json`.

Backfill all quarters from a starting year through the current quarter:

```bash
npm run pull:jira-quarterly-metrics -- --from-year 2024
```

Period argument behavior:

- no argument: current quarter only
- `--quarter YYYY-Q#`: only that quarter
- `--from-year YYYY`: all quarters from `YYYY-Q1` through the current quarter
- `--quarter` and `--from-year` are mutually exclusive

## Yearly charting guidance

For annual reporting views, keep quarter outputs as the primary source of truth.

- generate quarter metrics first
- chart them grouped by year in Excel or the frontend
- do not replace the quarter model with direct yearly calculations yet

This is especially important for `Jira Card Churn %`, because the yearly view should be derived from correctly aggregated quarter data rather than from averaging already-rolled percentages.

Generated files:

- `backend/excel/generated/<year>/jira_issues_raw_<quarter>.csv`
- `backend/excel/generated/<year>/jira_changelog_raw_<quarter>.csv`
- `backend/excel/generated/<year>/sprint_calendar_<quarter>.csv`
- `backend/excel/generated/<year>/metric_inputs_by_sprint_<quarter>.csv`
- `backend/excel/generated/<year>/cycle_time_issue_level_<quarter>.csv`
- `backend/excel/generated/metric_outputs_by_quarter.csv`
- `backend/excel/generated/json_export_view.csv`
- `backend/excel/generated/refresh_control.csv`

Example:

- `backend/excel/generated/2026/jira_issues_raw_2026-Q2.csv`
- `backend/excel/generated/2026/cycle_time_issue_level_2026-Q2.csv`

The partitioned quarter files are the heavy raw/audit layer. The consolidated root-level files remain the reporting layer used by JSON export and frontend refresh.

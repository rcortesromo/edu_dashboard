# EDU Dashboard Documentation

## Purpose

This project is building an executive dashboard for SDLC and delivery efficiency reporting.

The current implementation focus is the backend data pipeline for Jira-based metrics. The backend is designed around:

- Jira as the source system
- Excel-compatible CSV layers as the reporting backend
- JSON as the frontend handoff format
- quarter-level executive reporting
- sprint-level and issue-level raw calculations underneath

## Current Scope

The first version currently targets these four metrics:

1. `Jira Card Churn %`
2. `Average Velocity (points per sprint)`
3. `Flow-based Cycle Time Proxy (weeks)`
4. `Actual Cycle Time (weeks)`

These metrics are reported by:

- `team x quarter`

But are calculated from:

- `team x sprint` and completed-issue history

## Teams In Scope

The tracked teams for v1 are:

- `Team Webstore`
- `Team Connexpoint`

Frontend display labels currently used:

- `Team Webstore` -> `Revtrak`
- `Team Connexpoint` -> `CXP`

## EDU Portfolio Rollup

The frontend now includes an `EDU` portfolio rollup.

`EDU` is not a separate Jira team or board.

It is a derived quarter-level aggregate built from the in-scope delivery teams:

- `CXP`
- `Revtrak`

Today that means:

- `Team Connexpoint`
- `Team Webstore`

In the future, more teams can be added to the same portfolio rollup without changing the frontend structure.

### Why EDU Is Derived

`EDU` must not be calculated by taking a simple average of already-rolled team metrics.

Some metrics are ratios and some are weighted averages, so averaging the visible team values would distort the portfolio result.

Instead, the pipeline rebuilds `EDU` from the correct denominators or weights.

### EDU Aggregation Rules

#### Jira Card Churn %

`EDU` churn is rebuilt from the total churn-event counts and the total committed baseline across all in-scope teams.

Formula:

```text
EDU Jira Card Churn % =
((sum removed + sum re-estimated + sum sent backward) / sum committed at sprint start) * 100
```

This is a weighted portfolio ratio, not the average of team churn percentages.

#### Average Velocity (points per sprint)

`EDU` velocity is weighted by the number of counted sprints across the in-scope teams.

Formula:

```text
EDU Average Velocity =
sum(team average velocity * team sprint count) / sum(team sprint count)
```

Equivalent interpretation:

```text
EDU Average Velocity =
total completed points across in-scope teams / total counted sprints across in-scope teams
```

This is not the simple average of team velocity values.

#### Flow-based Cycle Time Proxy (weeks)

`EDU` flow-based cycle time proxy is rebuilt from total WIP and total throughput across the included teams.

Formula:

```text
EDU Flow-based Cycle Time Proxy =
(sum portfolio WIP across counted sprints / sum portfolio throughput across counted sprints) * 2
```

Equivalent implementation using the current quarter output rows:

```text
((sum(team average WIP * team sprint count)) / (sum(team average throughput * team sprint count))) * 2
```

This is not the average of team proxy values.

#### Actual Cycle Time (weeks)

`EDU` actual cycle time is weighted by the completed issue count from each team.

Formula:

```text
EDU Actual Cycle Time =
sum(team actual cycle time * team completed-item count) / sum(team completed-item count)
```

This preserves the true portfolio average elapsed time for completed work.

### Current Example: 2026-Q1

Using the current `CXP + Revtrak` quarter output:

- `EDU Jira Card Churn %` = `10.79%`
- `EDU Average Velocity` = `37.65 points per sprint`
- `EDU Flow-based Cycle Time Proxy` = `1.80 weeks`
- `EDU Actual Cycle Time` = `1.01 weeks`

These values are published into the same frontend JSON feed as the team-level rows, with `team = EDU`.

These teams are configured in:

- `backend/excel/jira-field-mapping.template.json`

Current team-to-board mapping:

- `Team Webstore` -> board `175`
- `Team Connexpoint` -> board `170`

Both currently use:

- project `OV`
- the same shared workflow assumptions
- the same team field in Jira

Actual cycle time rules are also stored per team in the same mapping file so the pipeline can support different start points by team.

Work-item unit by team:

- `Team Webstore`: parent delivery items (`Story`, `Bug`, `Task`)
- `Team Connexpoint`: board-moving subtasks (`Sub-task`)

## Jira Field Mapping

The confirmed Jira fields for the current implementation are:

- `Sprint` -> `customfield_10020`
- `Team` -> `customfield_10032`
- `Story Points` -> `customfield_10043`

These are currently represented in:

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
- the work-item unit can differ by team when the board flow is driven by subtasks instead of parent items

### Flow-based Cycle Time Proxy (weeks)

Formula:

```text
(Average WIP / Average Throughput per Sprint) * 2
```

Current unit choice for v1:

- `Average WIP` = cards
- `Average Throughput per Sprint` = completed cards

So the current interpretation is:

```text
Flow-based Cycle Time Proxy (weeks) = (Average WIP in cards / Average completed cards per sprint) * 2
```

What it means:

- this is not per-card elapsed time
- it is a flow-health signal for the team’s delivery system
- lower usually means less congestion, lower WIP, higher throughput, or a combination of those
- higher usually means more congestion, higher WIP, lower throughput, or a combination of those

Executive reading:

- `lower = better flow`
- `higher = more work accumulating in the system`

### Average Velocity (points per sprint)

This is the team's average completed story points per sprint across the quarter.

Definition:

```text
Average Velocity (points per sprint) = sum of completed story points across quarter sprints / number of sprints in quarter
```

What it means:

- this is a sprint-capacity output signal, not a flow-time metric
- higher usually means the team completed more story points per sprint
- lower usually means fewer story points were completed per sprint

Important design choices:

- the base sprint value comes from `completed_points`
- only completed work that passes the existing completion gate is counted
- the quarter value is the average across the sprints included in that quarter
- `Team Webstore` currently uses calculated completed points from in-scope issues
- `Team Connexpoint` currently uses the Jira board velocity report because its subtasks do not reliably carry sprint points for this metric

### Actual Cycle Time (weeks)

This is the true elapsed-time metric for completed items.

Definition:

```text
Actual Cycle Time (weeks) = average elapsed weeks from the configured team start point until the item enters the Jira Done category with resolution Done
```

Team-specific start definitions:

- `Team Webstore`: `In Development -> Done category`
- `Team Connexpoint`: `In Development -> Done category`

Completion gate for both teams:

- the closing event must land in the Jira `Done` category
- the issue resolution at that closing timestamp must be `Done`

Important design choices:

- this metric is calculated per completed issue first
- for each valid close, the start used is the last matching start-state transition before that close, not the first historical one
- the quarter value is the average of completed-item cycle times whose completion happened inside that quarter
- it uses Jira changelog timestamps, not WIP or throughput ratios

How to read it:

- this is the closest metric to "how long does it actually take to finish a card once work starts?"
- if it drops, completed work is moving faster from active work to done
- if it rises, completed work is spending more elapsed time in the delivery system

### Completion Rule Shared By Both Cycle Time Metrics

For this implementation, both cycle-time metrics now use the same completion gate for counting finished work:

- the issue must reach the configured closed / done status logic
- the issue resolution must be exactly `Done`
- when a valid completion is found, the related start point is the last matching active-work start before that close

For `Flow-based Cycle Time Proxy`, this affects the throughput denominator because `completed_cards` only counts those valid `Done` completions.

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
6. `cycle_time_issue_level`
7. `metric_outputs_by_quarter`
8. `json_export_view`
9. `refresh_control` (added for incremental quarter tracking)

Template files:

- `backend/excel/templates/config.csv`
- `backend/excel/templates/jira_issues_raw.csv`
- `backend/excel/templates/jira_changelog_raw.csv`
- `backend/excel/templates/sprint_calendar.csv`
- `backend/excel/templates/metric_inputs_by_sprint.csv`
- `backend/excel/templates/cycle_time_issue_level.csv`
- `backend/excel/templates/metric_outputs_by_quarter.csv`
- `backend/excel/templates/json_export_view.csv`
- `backend/excel/templates/refresh_control.csv`

## Generated CSV Outputs

The Jira pipeline writes generated files to:

- `backend/excel/generated/`

Current generated output targets:

- partitioned raw outputs under year folders, for example:
  - `2026/jira_issues_raw_2026-Q1.csv`
  - `2026/jira_changelog_raw_2026-Q1.csv`
  - `2026/sprint_calendar_2026-Q1.csv`
  - `2026/metric_inputs_by_sprint_2026-Q1.csv`
  - `2026/cycle_time_issue_level_2026-Q1.csv`
- consolidated reporting outputs at the root:
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
4. determines the target reporting period
5. fetches Jira statuses to resolve status categories such as `In Progress` and `Done`
6. fetches sprints for the configured boards
7. fetches Jira issues for each target quarter in the reporting period
8. fetches changelog for relevant issues
9. writes quarter-specific raw CSV outputs inside the target year folder
10. calculates sprint-level metric inputs
11. calculates issue-level actual cycle time for completed work
12. calculates quarter-level outputs
13. updates `refresh_control.csv`
14. produces `json_export_view.csv`

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
- `npm run refresh:static-metrics`

## Environment Variables

Local Jira credentials are stored in:

- `.env.local`

Template:

- `.env.example`

Current relevant variables:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`

The following are not read from `.env.local` anymore and are now sourced from project config files instead:

- Jira field IDs and tracked team/board definitions: `backend/excel/jira-field-mapping.template.json`
- issue type scope, completed statuses, and workflow rules: `backend/excel/templates/config.csv`

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
- `backend/excel/json/metrics.generated.json`
- `public/data/metrics.generated.json`

The Azure-hosted frontend should read the deployed public file at:

- `/data/metrics.generated.json`

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
  -> cycle_time_issue_level.csv
  -> metric_outputs_by_quarter.csv
  -> json_export_view.csv
  -> backend/excel/json/metrics.generated.json
  -> public/data/metrics.generated.json
  -> frontend
```

## Azure Static Web Apps Flow

Recommended deployment split:

- GitHub Actions workflow `refresh-metrics-json.yml` runs the private Jira pull using repository secrets
- that workflow writes `backend/excel/json/metrics.generated.json` and copies it to `public/data/metrics.generated.json`
- GitHub Actions workflow `azure-static-web-apps.yml` builds and deploys the frontend to Azure Static Web Apps
- the deployed site serves the JSON at `/data/metrics.generated.json`

Required GitHub secrets:

- `AZURE_STATIC_WEB_APPS_API_TOKEN`
- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`

## Current Assumptions

These assumptions are currently in effect:

- quarter convention is `calendar`
- metrics are calculated for the selected quarter, including the current quarter if incomplete
- the current quarter is recalculated on each run
- two teams are in scope
- both teams share the same workflow
- throughput is based on completed cards
- the dashboard now carries two different cycle time metrics on purpose:
- `Flow-based Cycle Time Proxy` for system congestion / flow health
- `Actual Cycle Time` for true elapsed time on completed items

## Known Limitations

- the current pipeline is focused on Jira only
- actual cycle time depends on reliable Jira changelog history and status-category mapping
- actual cycle time is only available for items that reached the Jira Done category with resolution `Done`
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

1. Or backfill multiple quarters from a starting year through the current quarter:

```bash
npm run pull:jira-quarterly-metrics -- --from-year 2024
```

1. Accepted year format:
   - `YYYY`
   - example: `2024`

1. Period selection behavior:
   - `--quarter 2026-Q1` processes only that quarter
   - `--from-year 2024` processes `2024-Q1` through the current quarter
   - no period argument defaults to the current quarter
   - `--quarter` and `--from-year` cannot be used together in the same run

1. Review:
   - `backend/excel/generated/*.csv`
   - `backend/excel/generated/<year>/*.csv`
1. Run:

```bash
npm run export:metrics-json -- "backend/excel/generated/json_export_view.csv" "backend/excel/json/metrics.generated.json"
```

## Yearly Charting Approach

For yearly visuals, the recommended source of truth remains quarter-level outputs.

- the script still calculates and stores metrics at `team x quarter`
- a chart for `2024 to today` should plot quarter points grouped by year
- for example, `2024-Q1`, `2024-Q2`, `2024-Q3`, `2024-Q4`, `2025-Q1`, and so on
- this avoids distorting `Jira Card Churn %` by averaging already-aggregated percentages at the wrong level
- it also preserves the existing interpretation of `Flow-based Cycle Time Proxy (weeks)` and `Actual Cycle Time (weeks)`

If leadership later wants a single annual KPI like `2024`, `2025`, or `2026 YTD`, that should be added as a separate derived annual layer built from quarter outputs rather than replacing the quarter model.

## Partitioned Raw Storage

Raw and issue-level generated files are now partitioned by year folder and quarter-specific filename.

Example structure:

```text
backend/excel/generated/
  2026/
    jira_issues_raw_2026-Q1.csv
    jira_changelog_raw_2026-Q1.csv
    sprint_calendar_2026-Q1.csv
    metric_inputs_by_sprint_2026-Q1.csv
    cycle_time_issue_level_2026-Q1.csv
  2027/
    jira_issues_raw_2027-Q1.csv
    ...
  metric_outputs_by_quarter.csv
  json_export_view.csv
  refresh_control.csv
```

This keeps large raw datasets partitioned over time, while the smaller consolidated reporting files remain in one place for JSON export and frontend refresh.

## Next Logical Enhancements

Possible next steps after the current foundation:

- connect the React dashboard directly to generated JSON
- automate direct `.xlsx` writing if needed later
- add additional metrics beyond churn and cycle time
- add quarter locking rules
- expand from Jira to Aha! or other systems

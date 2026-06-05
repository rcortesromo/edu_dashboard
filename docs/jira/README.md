# Jira Metrics

Sprint-level and quarter-level delivery health metrics extracted from Jira Cloud.

## Metrics

| Metric | Unit | Description |
|--------|------|-------------|
| **Jira Card Churn %** | percent | Share of sprint-committed work that left the plan, was re-pointed, or moved backward after sprint start. |
| **Average Velocity (points per sprint)** | points | Average completed story points per sprint across the period. |
| **Flow-based Cycle Time Proxy (weeks)** | weeks | Flow-health signal from average WIP vs completed cards per sprint. Lower is healthier. |
| **Actual Cycle Time (weeks)** | weeks | Average real elapsed time from "In Development" status until Done resolution. |
| **MTTR (Sev 1 + Sev 2)** | hours | **Median** time to resolve for Sev 1/2 OV issues (Bug, Story, Task): business time (weekends excluded) from issue creation until its status changes to `Closed`. Median is the headline because it is robust to the long tail of months-old issues. |
| **MTTR Avg (Sev 1 + Sev 2)** | hours | Same definition as above but the **mean**. Plotted as a lighter reference line so outlier-driven spikes stay visible without distorting the headline. |
| **MTTR Tickets (Sev 1 + Sev 2)** | count | Number of Sev 1/2 OV issues Closed in the period (the bars in the MTTR combo chart). |

### MTTR (Sev 1 + Sev 2)

Time a high-severity OV issue spends from creation until it is Closed.

- **Source script**: `scripts/jira/pull-mttr.mjs` -> `backend/jira/generated/mttr_export.csv`.
- **Population**: `OV` issues of type `Bug` / `Story` / `Task` whose `Severity` field is `Level 1` / `Level 2`. The Severity filter always applies.
- **Teams**: grouped by the Jira `Team` field into Connexpoint, Webstore, ASAP, and Smartcare (same mapping as defect leakage), with an `EDU` portfolio rollup.
- **Start of clock**: the issue `created` date.
- **End of clock**: the changelog timestamp at which the issue's status changed to `Closed` (the latest such transition when an issue was reopened and re-closed). If an issue is `Closed` but has no recorded transition, it falls back to `resolutiondate`. Issues that have not reached `Closed` have no end yet and are skipped.
- **Duration**: business time excluding Saturdays and Sundays, stored in hours. The UI shows hours under a day and days (24 business-hours = 1 day) from a day up.
- **Statistic**: the headline series is the **median** (robust to the long tail of months-old issues); the **average** is emitted as a second series (`MTTR Avg`) and drawn as a lighter reference line. Both are computed from the same per-issue samples in the bucket.
- **Bucketing**: by the close date, into quarter / YTD / sprint, with an `EDU` rollup. The rollup concatenates the per-team samples (ticket-weighted), not an average of team averages.
- **Config**: the `mttr` block in `jira-field-mapping.template.json` (`projectKeys`, `issueTypes`, `severityLevels`, `endStatus`, `teams`, `businessDaysOnly`).
- **Note**: all closures count regardless of resolution (including `Declined` / `Duplicate` / `Abandoned`), since the metric measures time-to-Closed.

Run it standalone:

```bash
# Incremental refresh (current config createdFrom)
npm run refresh:static-metrics -- --only mttr

# One-time backfill from 2025
node scripts/jira/pull-mttr.mjs --from-year 2025
```

## Teams and Boards

Configured in `backend/jira/config/jira-field-mapping.template.json`:

| Team | Board ID | Project | Sprint Name Pattern | Cycle Time Start |
|------|----------|---------|---------------------|------------------|
| Team Webstore | 175 | OV | `WS##Q#S#` | "In Development" |
| Team Connexpoint | 170 | OV | `CXP##Q# - Sprint #` | "In Development" |

Team Webstore tracks Stories, Bugs, and Tasks. Team Connexpoint tracks Sub-tasks.

## Quarter Windows

Quarters follow the calendar convention:

| Quarter | Start | End |
|---------|-------|-----|
| Q1 | January 1 | March 31 |
| Q2 | April 1 | June 30 |
| Q3 | July 1 | September 30 |
| Q4 | October 1 | December 31 |

Sprints are assigned to the quarter of their **close date**. If a sprint straddles two quarters, it belongs to the quarter in which it closed.

YTD rollups are built from the backend by re-aggregating from sprint-level data, not by averaging quarter-level values.

## EDU Portfolio Rollup

EDU is a derived aggregate from Team Connexpoint and Team Webstore.

Rollup rules vary by metric:

- **Churn %**: Rebuilt from total churn-event counts and total committed baselines across teams (not an average of team percentages).
- **Velocity**: Weighted average by sprint count per team in the quarter.
- **Cycle Time Proxy**: Weighted average by completed card count per team.
- **Actual Cycle Time**: Weighted average by resolved issue count per team.

## Jira API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/rest/agile/1.0/board/{boardId}/sprint` | List sprints for a board |
| `/rest/agile/1.0/sprint/{sprintId}/issue` | Issues in a sprint |
| `/rest/api/3/search/jql` | JQL search for velocity/cycle time |
| `/rest/api/3/issue/{issueKey}/changelog` | Issue change history for churn detection |
| `/rest/api/3/status` | Status metadata |
| `/rest/greenhopper/1.0/rapid/charts/velocity` | Board velocity report |

## Running

```bash
npm run pull:jira-quarterly-metrics
```

Scope to a single team for faster iteration:

```bash
npm run pull:jira-quarterly-metrics -- --team "Team Connexpoint"
```

When `--team` is used, per-quarter CSV files (sprint calendar, metric inputs, cycle time, velocity, etc.) are merged so that data from other teams is preserved. Cross-quarter files (metric outputs, json export view, refresh control) already merge by design.

Output lands in `backend/jira/generated/json_export_view.csv`.

## Adding a New Team

1. Add a new entry to `boardsOrProjects` in `backend/jira/config/jira-field-mapping.template.json` with the team name, board ID, project keys, sprint name regex, and cycle time status rules.
2. Add a display label in `src/lib/metrics.ts` under `teamDisplayMap`.
3. Add the team to `preferredTeamOrder` in `src/lib/metrics.ts`.
4. Run `npm run pull:jira-quarterly-metrics` to verify.

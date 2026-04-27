# Jira Metrics

Sprint-level and quarter-level delivery health metrics extracted from Jira Cloud.

## Metrics

| Metric | Unit | Description |
|--------|------|-------------|
| **Jira Card Churn %** | percent | Share of sprint-committed work that left the plan, was re-pointed, or moved backward after sprint start. |
| **Average Velocity (points per sprint)** | points | Average completed story points per sprint across the period. |
| **Flow-based Cycle Time Proxy (weeks)** | weeks | Flow-health signal from average WIP vs completed cards per sprint. Lower is healthier. |
| **Actual Cycle Time (weeks)** | weeks | Average real elapsed time from "In Development" status until Done resolution. |

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

Output lands in `backend/jira/generated/json_export_view.csv`.

## Adding a New Team

1. Add a new entry to `boardsOrProjects` in `backend/jira/config/jira-field-mapping.template.json` with the team name, board ID, project keys, sprint name regex, and cycle time status rules.
2. Add a display label in `src/lib/metrics.ts` under `teamDisplayMap`.
3. Add the team to `preferredTeamOrder` in `src/lib/metrics.ts`.
4. Run `npm run pull:jira-quarterly-metrics` to verify.

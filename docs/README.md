# EDU Dashboard Documentation

Executive delivery dashboard for SDLC metrics, sprint health, and AI adoption tracking across EDU teams.

## Data Sources

| Source | Metrics | Docs |
|--------|---------|------|
| **Jira** | Card Churn %, Velocity, Cycle Time Proxy, Actual Cycle Time | [jira/README.md](jira/README.md) |
| **GitHub** | AI-assisted PR Coverage, AI Active Developers | [ai/README.md](ai/README.md) |
| **Cursor** | Cursor Adoption Rate | [cursor/README.md](cursor/README.md) |

## Teams

| Team Key | Display Label | Org |
|----------|---------------|-----|
| Team Connexpoint | CXP | vancopayments |
| Team Webstore | Revtrak | vancopayments |
| ASAP | ASAP | vancopayments |
| Smartcare | Smartcare | SmartTuition |
| EDU | EDU (portfolio) | Derived rollup |

EDU is a portfolio-level aggregate derived from delivery team data. It is not a Jira board or GitHub org.

## Pipeline

### Incremental refresh (default)

```bash
npm run refresh:static-metrics
```

By default, each script picks up where it left off:

- **Jira**: re-fetches the current quarter only; older quarters are preserved in the CSV.
- **GitHub AI**: reads the existing CSV, finds the latest quarter, re-fetches from that quarter onward.
- **Cursor**: same as GitHub AI -- re-fetches from the latest existing quarter onward.

This is fast and safe for daily/weekly updates since historical data is never lost.

### Team-scoped refresh

Pass `--team` to refresh only one Jira team. AI and Cursor pulls are skipped automatically since they don't support team filtering.

```bash
npm run refresh:static-metrics -- --team "Team Connexpoint"
```

The team name must match exactly as configured in `jira-field-mapping.template.json` (`teamName` field). Available teams: **Team Connexpoint**, **Team Webstore**.

This is useful for quick mid-sprint checks or when fixing data for a single team (~1 min vs ~4 min for a full refresh). Per-quarter CSV files preserve data from other teams through an automatic merge.

`--team` can be combined with quarter flags:

```bash
npm run refresh:static-metrics -- --team "Team Connexpoint" --quarter 2026-Q1
```

### Full refresh (all quarters from scratch)

Pass `--full` to re-fetch everything from `currentYear - 1`:

```bash
npm run refresh:static-metrics -- --full
```

Or run each script individually:

```bash
npm run pull:jira-quarterly-metrics -- --full
npm run pull:ai-adoption-metrics -- --full
npm run pull:cursor-metrics -- --full
npm run merge:metrics-sources
npm run export:metrics-json
```

Then copy to public: `cp backend/published/json/metrics.generated.json public/data/metrics.generated.json`

### Jira-specific flags

| Flag | Example | Effect |
|------|---------|--------|
| (none) | `npm run pull:jira-quarterly-metrics` | Current quarter only (incremental) |
| `--full` | `-- --full` | All quarters from `currentYear - 1` to now |
| `--from-year` | `-- --from-year 2025` | All quarters from the specified year |
| `--quarter` | `-- --quarter 2026-Q1` | One specific quarter |
| `--team` | `-- --team "Team Connexpoint"` | Scope to a single team (preserves other teams' data) |

### AI & Cursor flags

| Flag | Example | Effect |
|------|---------|--------|
| (none) | `npm run pull:ai-adoption-metrics` | From latest existing quarter onward (incremental) |
| `--full` | `-- --full` | All quarters from `currentYear - 1` to now |

## Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
|----------|---------|
| `JIRA_BASE_URL` | Atlassian Cloud instance URL |
| `JIRA_EMAIL` | Jira account email for Basic auth |
| `JIRA_API_TOKEN` | Jira API token |
| `GITHUB_TOKEN` | GitHub PAT with `repo` and `read:org` scopes for vancopayments and SmartTuition |
| `CURSOR_TOKEN` | Cursor Admin API key with `admin:*` scope (from team settings) |

## Output

The dashboard reads `public/data/metrics.generated.json` at runtime. This file contains:

- `reportDate` -- date of the latest data refresh
- `teams` -- list of team keys with data
- `quarters` -- list of period labels (e.g. `2026-Q1`, `2026-Q2`, `2026-YTD`)
- `sprintCalendar` -- nested map of sprint metadata by team and quarter, used by the sprint selector
- `metrics[]` -- flat array of metric records, each with team, quarter, metric name, value, unit, and source

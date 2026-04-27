# EDU Dashboard Documentation

Executive delivery dashboard for SDLC metrics, sprint health, and AI adoption tracking across EDU teams.

## Data Sources

| Source | Metrics | Docs |
|--------|---------|------|
| **Jira** | Card Churn %, Velocity, Cycle Time Proxy, Actual Cycle Time | [jira/README.md](jira/README.md) |
| **GitHub** | AI-assisted PR Coverage, AI Active Developers | [ai/README.md](ai/README.md) |

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

### Quick refresh (current quarter only)

```bash
npm run refresh:static-metrics
```

This runs Jira (current quarter only) + AI + merge + export in sequence. Good for routine updates within the same quarter.

### Full refresh (all quarters)

For a complete refresh that includes historical quarters:

```bash
npm run pull:jira-quarterly-metrics -- --from-year 2026   # Jira Q1+Q2+YTD
npm run pull:ai-adoption-metrics                            # GitHub Q1+Q2 (auto-detects)
npm run merge:metrics-sources                               # Merge Jira + AI CSVs
npm run export:metrics-json                                 # CSV -> JSON final
```

Then copy to public: `cp backend/published/json/metrics.generated.json public/data/metrics.generated.json`

### Jira quarter flags

| Flag | Example | Effect |
|------|---------|--------|
| (none) | `npm run pull:jira-quarterly-metrics` | Current quarter only |
| `--from-year` | `-- --from-year 2026` | All quarters from that year to now |
| `--quarter` | `-- --quarter 2026-Q1` | One specific quarter |

### AI metrics

The AI script auto-detects all quarters from Q1 to the current quarter. No flags needed.

## Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
|----------|---------|
| `JIRA_BASE_URL` | Atlassian Cloud instance URL |
| `JIRA_EMAIL` | Jira account email for Basic auth |
| `JIRA_API_TOKEN` | Jira API token |
| `GITHUB_TOKEN` | GitHub PAT with `repo` and `read:org` scopes for vancopayments and SmartTuition |

## Output

The dashboard reads `public/data/metrics.generated.json` at runtime. This file contains:

- `reportDate` -- date of the latest data refresh
- `teams` -- list of team keys with data
- `quarters` -- list of period labels (e.g. `2026-Q1`, `2026-Q2`, `2026-YTD`)
- `metrics[]` -- flat array of metric records, each with team, quarter, metric name, value, unit, and source

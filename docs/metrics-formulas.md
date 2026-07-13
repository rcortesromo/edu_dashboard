# Metric Formulas

Reference of every metric shown in the dashboard: exact formula, population, unit, and how the `EDU` portfolio rollup is built. This is the single source of truth to cross-check against the pull scripts if a number ever looks off.

General rule used across **every** metric here: percentages/rollups are always computed **once from summed raw totals**, never by averaging smaller percentages (weeks, sprints, or teams). Averaging percentages was the bias in the old manual process this dashboard replaces.

---

## Work Type (Maintain / Run / Growth)

**Source**: `scripts/jira/pull-work-type-mix.mjs` · Unit: percent

**Population**: every `OV` issue (any issue type) with at least one worklog whose `started` date falls in the period. Bucketing uses each worklog's own date, not the issue's `created` date.

**Categories** (Jira `Work Type` field, `customfield_10371`):
- **Maintain**: M - Prod (Sev 1), M - Maintenance, M - Tech Hardening
- **Run**: R - Client Request, R - Strategic
- **Growth**: G - Experiment/Growth

**Formula**:

```
Maintain % = Maintain hours / (Maintain + Run + Growth hours) × 100
Run %      = Run hours      / (Maintain + Run + Growth hours) × 100
Growth %   = Growth hours   / (Maintain + Run + Growth hours) × 100
```

Computed once from the whole period's total hours. Worklogs on issues with no Work Type (or an unrecognized value) are excluded from numerator and denominator ("unmapped hours" — mostly PTO, ceremonies, general OPEX/CAPEX).

**EDU rollup**: sum Maintain/Run/Growth hours across all teams first, then apply the same formula once on the combined totals.

---

## Delivery Flow

### Jira Card Churn %

**Source**: `scripts/pull-jira-quarterly-metrics.mjs` (+ sprint-level compute) · Unit: percent

**Sprint-level formula**:

```
((Cards removed + Cards re-estimated + Cards sent backward after sprint start) / Cards committed at sprint start) × 100
```

**Quarter-level rollup** (sum of sprint-level events, not average of sprint %):

```
((Sum removed + Sum re-estimated + Sum sent backward) / Sum committed at sprint start) × 100
```

Definitions:
- **Committed at sprint start**: card belonged to the sprint at the exact sprint-start timestamp (late adds don't count as committed).
- **Re-estimated**: story points changed after sprint start (multiple changes to the same issue in the same sprint count once).
- **Sent backward**: status transitioned to an earlier workflow stage after sprint start.

**EDU rollup**:

```
EDU Churn % = (sum removed + sum re-estimated + sum sent backward across teams) / (sum committed across teams) × 100
```

### Average Velocity (points per sprint)

**Formula**:

```
Average Velocity = sum of completed story points across quarter sprints / number of sprints in quarter
```

- Team Webstore: calculated completed points from in-scope issues.
- Team Connexpoint: Jira board velocity report (subtasks don't reliably carry sprint points).

**EDU rollup** (weighted by sprint count, not a simple average of team velocities):

```
EDU Velocity = sum(team average velocity × team sprint count) / sum(team sprint count)
             = total completed points across teams / total counted sprints across teams
```

### Flow-based Cycle Time Proxy (weeks)

**Formula**:

```
Flow-based Cycle Time Proxy (weeks) = (Average WIP in cards / Average completed cards per sprint) × 2
```

Flow-health signal, not per-card elapsed time. Lower = better flow (less congestion / higher throughput).

**EDU rollup** (weighted by sprint count):

```
EDU Flow-based Cycle Time Proxy = (sum(team avg WIP × team sprint count) / sum(team avg throughput × team sprint count)) × 2
```

### Actual Cycle Time (weeks)

**Formula**:

```
Actual Cycle Time (weeks) = average elapsed weeks from the team's configured start point until the item reaches the Jira Done category with resolution "Done"
```

- Start point (both teams currently): `In Development → Done category`.
- Calculated per completed issue first: for each valid close, uses the **last** matching start-state transition before that close (not the first historical one).
- Completion gate: status lands in Jira `Done` category **and** resolution is exactly `Done`.

**EDU rollup** (weighted by completed-issue count, not a simple average):

```
EDU Actual Cycle Time = sum(team actual cycle time × team completed-item count) / sum(team completed-item count)
```

---

## Severities & MTTR

### Defect Leakage %

**Source**: `scripts/jira/pull-defect-leakage.mjs` · Unit: percent

**Population**: `OV` issues of type `Bug`.

**Formula**:

```
Defect Leakage % = Sev-High bugs / (Total bugs + Distinct reopened bugs) × 100
```

Where:
- **Sev-High bugs** = count of bugs with Severity `Level 1` or `Level 2`.
- **Total bugs** = all bugs created in the period, any severity.
- **Distinct reopened bugs** = bugs that had at least one changelog transition into a "Reopened" status (counted once per issue, regardless of how many times it reopened).

### Sev 1 Bugs / Sev 2 Bugs / Sev 1 + Sev 2 Bugs

Raw counts (unit: `count`) of bugs created in the period with Severity `Level 1`, `Level 2`, or their sum. Same population as Defect Leakage.

### Sev 1/2 Bugs (Internal / External)

Same Sev 1 / Sev 2 counts, split by the `Root Cause Category` field:
- **External**: Root Cause = "Third Party".
- **Internal**: any other value, including empty/null.

### MTTR (Sev 1 + Sev 2)

**Source**: `scripts/jira/pull-mttr.mjs` · Unit: hours (business time)

**Population**: `OV` issues of type `Bug` / `Story` / `Task` with Severity `Level 1` or `Level 2`.

**Formula**:

```
MTTR (per issue) = business hours from issue `created` until the changelog transition where status → "Closed"
                    (the latest such transition if reopened/re-closed; falls back to `resolutiondate` if no
                    transition is recorded)
```

"Business hours" excludes Saturdays and Sundays. Issues that never reached `Closed` are skipped (no end date yet). All resolutions count (including Declined/Duplicate/Abandoned) — the metric measures time-to-Closed, not "fixed correctly."

**Headline statistic**: **median** of all per-issue MTTR values closed in the period (robust to a long tail of old issues).
**MTTR Avg**: **mean** of the same per-issue samples — a lighter reference line, since the mean is pulled up by outliers.
**MTTR Tickets**: count of Sev 1/2 issues Closed in the period (the bars in the combo chart).

**EDU rollup**: concatenates the per-team per-issue samples into one pool (ticket-weighted) and re-computes median/mean on that pool — **not** an average of each team's median.

---

## AI & Cursor Adoption

### Cursor Adoption Rate

**Source**: `scripts/cursor/pull-cursor-metrics.mjs` (Cursor Admin API) · Unit: percent

**Formula**:

```
Cursor Adoption Rate = (mapped members with ≥1 active day in Cursor during the period) / (total mapped members with a cursorEmail set) × 100
```

"Active day" = the Cursor Admin API's daily usage record marked `isActive: true` for that user.

**EDU rollup** (raw counts, not average of team %):

```
EDU Cursor Adoption Rate = total active members across teams / total mapped members across teams × 100
```

### AI-assisted Pull Request Coverage

**Source**: `scripts/ai/pull-adoption-metrics.mjs` (GitHub) · Unit: percent

**Formula**:

```
AI-assisted PR Coverage = (merged PRs flagged as AI-assisted) / (total merged PRs by mapped authors) × 100
```

A PR is "AI-assisted" if its title, body, or any commit message matches an AI-signal pattern (e.g. `Co-authored-by: Copilot`, mentions of `cursor`, `copilot`, `claude`, `chatgpt`, `ai-generated`, etc. — see `docs/ai/README.md` for the full regex list). Only merged PRs by GitHub logins in the team roster count; unmapped authors are excluded entirely (not just from the numerator).

**EDU rollup** (raw counts):

```
EDU Coverage = total AI-flagged PRs across teams / total PRs across teams × 100
```

### AI Active Developers

**Formula**: count of unique GitHub logins (mapped to the roster) who authored at least one AI-flagged merged PR in the period.

**EDU rollup**: sum of each team's AI Active Developers count (not deduplicated across teams, since a person belongs to one team).

---

## EDU Portfolio Rollup — General Rule

`EDU` is not a Jira team/board; it's a derived aggregate over the delivery teams (Connexpoint, Webstore, ASAP, Smartcare). It is **never** a simple average of the visible team percentages/values — each metric rebuilds EDU from its correct underlying numerator/denominator or weight, as detailed per metric above. This is what keeps ratio metrics (Churn %, Defect Leakage %, Maintain/Run/Growth %, Cursor Adoption %, AI Coverage %) statistically correct at the portfolio level, and keeps weighted-average metrics (Velocity, Cycle Time) properly weighted by sprint/issue counts instead of by team count.

## Quarter / YTD Rule

Quarters follow the calendar convention (Q1 = Jan–Mar, … Q4 = Oct–Dec). YTD values are rebuilt by re-aggregating the underlying raw counts/hours for the year's quarters — never by averaging the quarter-level percentages.

# Cursor Adoption Metrics

Cursor usage metrics extracted from the Cursor Admin API (`api.cursor.com`).

## Metrics

| Metric | Unit | Description |
|--------|------|-------------|
| **Cursor Adoption Rate** | percent | Share of mapped team members with at least one active day in Cursor during the period. |

## How the Pipeline Works

The script `scripts/cursor/pull-cursor-metrics.mjs` runs the following steps:

### 1. Build quarter windows

Same logic as the AI metrics pipeline. Generates quarter boundaries (Q1-Q4) for each year from `CURSOR_FROM_YEAR` (default: previous year) up to the current quarter.

### 2. Fetch daily usage data

For each quarter window, the script chunks the date range into 30-day windows (the API maximum) and calls:

```
POST /teams/daily-usage-data
Body: { "startDate": <epoch_ms>, "endDate": <epoch_ms>, "page": 1, "pageSize": 500 }
```

Authentication uses Basic Auth with `CURSOR_TOKEN` as the username and an empty password. This endpoint is available on Cursor Business and Enterprise plans.

The script paginates through all pages for each window and collects every user record where `isActive: true` (user used at least one AI feature that day).

### 3. Match active users to team members

Each active user's email from the API response is matched against the `cursorEmail` field in `backend/ai/identity/team-user-map.json`. If a user's `cursorEmail` is not set, they are excluded from both the numerator and denominator.

If a team member has `activeFrom` or `activeTo` dates, they are only counted if the quarter window overlaps with their active period.

### 4. Calculate Cursor Adoption Rate per team per quarter

**Cursor Adoption Rate** = `(members with at least 1 active day) / (total mapped members with cursorEmail set) x 100`

### 5. EDU portfolio rollup

The EDU row aggregates across all delivery teams using raw counts (not averaging percentages):

**Cursor Adoption Rate** = `total active members across all teams / total mapped members across all teams x 100`

## Discover Mode

To map Cursor team members to the roster, run:

```bash
node scripts/cursor/pull-cursor-metrics.mjs --discover
```

This:

1. Calls `GET /teams/members` to list all Cursor team members
2. Prints each member's email and name
3. Attempts name matching against `team-user-map.json`
4. Outputs suggested `cursorEmail` mappings for manual review

Apply the suggestions by editing `cursorEmail` fields in `backend/ai/identity/team-user-map.json`.

## Running

```bash
npm run pull:cursor-metrics                  # Incremental: from latest existing quarter onward
npm run pull:cursor-metrics -- --full        # Full: re-fetch all quarters from scratch
npm run pull:cursor-metrics -- --discover    # List Cursor members and suggest mappings
```

By default the script reads the existing CSV, finds the latest quarter already present, and only re-fetches from that quarter onward (since it may have been in-progress). Historical data from earlier quarters is preserved. Pass `--full` to re-fetch everything from `currentYear - 1`.

Output lands in `backend/cursor/generated/json_export_view.csv`.

## Rate Limiting

The Cursor Admin API enforces 20 requests per minute. The script inserts a 3.2-second delay between API calls to stay under the limit. A full run across 6 quarters makes approximately 20 requests.

## Adding a New Team Member

1. Add entry to `backend/ai/identity/team-user-map.json` with `cursorEmail` set to their Cursor account email.
2. Run `npm run pull:cursor-metrics` to include the member in metrics.

To find a member's Cursor email, run `npm run pull:cursor-metrics -- --discover` and look for their name in the output.

## Config Files

| File | Purpose |
|------|---------|
| `backend/ai/identity/team-user-map.json` | Team member roster with `cursorEmail` mappings |
| `backend/cursor/generated/json_export_view.csv` | Generated metric rows (auto-populated by pull) |
| `backend/cursor/generated/cursor-scope-summary.json` | Summary of last metrics pull |

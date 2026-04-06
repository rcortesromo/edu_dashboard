# Jira Metric Rules

This file turns the v1 assumptions into explicit workbook rules.

## Workflow ordering

Backward movement is detected from the ordered workflow stages stored in `templates/config.csv`.

Default order:

1. `Backlog`
2. `Ready for Refinement`
3. `Ready for Sprint`
4. `In Development`
5. `In Review`
6. `Testing`
7. `Done`

If an issue moves from a higher-order stage to a lower-order stage after sprint start, count it as `sent backward`.

Example:

- `In Development -> Ready for Sprint` after sprint start: count as backward
- `In Review -> In Development` after sprint start: count as backward
- `Ready for Sprint -> In Development` after sprint start: do not count as backward

## Churn rules

For v1, calculate sprint churn per issue once per churn category:

- `removed_after_start`
- `reestimated_after_start`
- `sent_backward_after_start`

If the same issue changes story points multiple times in the same sprint, count it once in `cards_reestimated_after_start`.

Team-specific work-item scope:

- `Team Webstore`: `Story`, `Bug`, `Task`
- `Team Connexpoint`: `Sub-task`

Quarter churn should be calculated from summed components, not from the average of sprint percentages:

`((sum removed + sum re-estimated + sum sent backward) / sum committed at start) * 100`

## Sprint scope rules

### Committed at sprint start

An issue is counted as `committed at sprint start` when:

- it belongs to the sprint at the sprint start timestamp
- it is inside the team and issue-type scope for the workbook

### Late-added cards

Default v1 rule:

- late-added cards count toward churn if they represent sprint scope instability
- they do not affect throughput unless the team chooses to include them later

### Throughput for flow-based cycle time proxy

Default v1 throughput unit:

- `completed_cards`

This matches the default WIP assumption of `average_wip_cards`.

If the team later wants a points-based proxy instead, both WIP and throughput should be shifted to the same unit family before calculating the proxy.

## Actual cycle time rules

Actual cycle time is calculated from Jira changelog timestamps, not from WIP or throughput.

Completion gate:

- the issue must enter the Jira Done category
- the issue resolution at that same completion timestamp must be `Done`

Current v1 team rules:

- `Team Webstore`: last transition into `In Development` before a valid Jira Done-category close
- `Team Connexpoint`: last transition into `In Development` before a valid Jira Done-category close

Quarter rollup rule:

- calculate cycle time per completed issue first
- assign the issue to the quarter where it entered the Done category
- for each valid close, pair it to the last matching start-state transition before that close
- average those completed-item cycle times for the executive quarter metric

Flow-based proxy throughput rule:

- `completed_cards` only counts issues that satisfy the same `resolution = Done` completion gate and valid latest-start-to-close pairing

## Quarterly rollup rules

The workbook should preserve sprint-level normalization first, then roll up into quarter outputs:

- `metric_inputs_by_sprint`: operational calculation layer
- `metric_outputs_by_quarter`: executive reporting layer

Quarter labels should use a stable naming rule such as `YYYY-Q#`, for example `2026-Q1`.

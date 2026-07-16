import test from "node:test";
import assert from "node:assert/strict";
import {
  findSprintForDate,
  matchDeploymentTeam,
  parseDeploymentDate,
  periodLabelsFrom,
  quarterLabelForDate,
} from "./deployment-metrics-utils.mjs";

const teams = [
  { titlePrefix: "ASAP", outputTeamName: "ASAP" },
  { titlePrefix: "Webstore", outputTeamName: "Team Webstore" },
  { titlePrefix: "CXP", outputTeamName: "Team Connexpoint" },
  { titlePrefix: "Smartcare", outputTeamName: "Smartcare" },
];

test("parses complete deployment dates observed in RMM titles", () => {
  const cases = [
    ["ASAP - Release 5.2.22.c 07/14/2026", "2026-07-14"],
    ["ASAP 5.0.1 - 2025/04/22", "2025-04-22"],
    ["CXP Release - July 9th, 2026", "2026-07-09"],
    ["ASAP Releases May, 7th 2024", "2024-05-07"],
    ["Smartcare release - 7th June 2025", "2025-06-07"],
    ["CXP Sardine - 08/21/24", "2024-08-21"],
  ];

  for (const [summary, expected] of cases) {
    assert.equal(parseDeploymentDate(summary)?.date.toISOString().slice(0, 10), expected);
  }
});

test("uses the last complete date instead of a dotted release version", () => {
  const parsed = parseDeploymentDate("Webstore 2026.07.01 07/16/2026");
  assert.equal(parsed?.date.toISOString().slice(0, 10), "2026-07-16");
});

test("rejects incomplete, invalid, and version-only dates", () => {
  assert.equal(parseDeploymentDate("CXP Release - July XX, 2026"), null);
  assert.equal(parseDeploymentDate("Webstore 2025.11.01 : 11/0/2025"), null);
  assert.equal(parseDeploymentDate("ASAP - Release 5.2.22, February 5"), null);
  assert.equal(parseDeploymentDate("Webstore.2024.01.1 Hotfix Release"), null);
});

test("matches only configured team prefixes at the start", () => {
  assert.equal(matchDeploymentTeam("SmartCare 6.55.0 - July 21st, 2026", teams)?.outputTeamName, "Smartcare");
  assert.equal(matchDeploymentTeam("Webstore 2026.07: 07/1/2026", teams)?.outputTeamName, "Team Webstore");
  assert.equal(matchDeploymentTeam("Release for CXP - July 9th, 2026", teams), null);
});

test("maps deployment dates to quarter and canonical CXP sprint", () => {
  const date = new Date("2026-07-16T00:00:00.000Z");
  const windows = [
    { key: "2026-Q3-S1", quarter: "2026-Q3", start: "2026-07-01", end: "2026-07-14" },
    { key: "2026-Q3-S2", quarter: "2026-Q3", start: "2026-07-15", end: "2026-07-28" },
  ];
  assert.equal(quarterLabelForDate(date), "2026-Q3");
  assert.equal(findSprintForDate(windows, date)?.key, "2026-Q3-S2");
});

test("assigns S0 and transition-gap dates to a visible sprint in the same quarter", () => {
  const windows = [
    { key: "2026-Q3-S1", quarter: "2026-Q3", start: "2026-07-10", end: "2026-07-22" },
    { key: "2026-Q3-S2", quarter: "2026-Q3", start: "2026-07-24", end: "2026-08-05" },
  ];
  assert.equal(
    findSprintForDate(windows, new Date("2026-07-09T00:00:00.000Z"))?.key,
    "2026-Q3-S1",
  );
  assert.equal(
    findSprintForDate(windows, new Date("2026-07-23T00:00:00.000Z"))?.key,
    "2026-Q3-S2",
  );
});

test("builds every quarter and YTD label from 2025 through today", () => {
  assert.deepEqual(
    periodLabelsFrom(new Date("2025-01-01T00:00:00.000Z"), new Date("2026-07-16T00:00:00.000Z")),
    {
      quarters: ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"],
      years: ["2025-YTD", "2026-YTD"],
    },
  );
});

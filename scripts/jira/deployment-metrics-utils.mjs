const MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

const MONTH_TOKEN =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

function normalizeYear(value) {
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

function validUtcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function collectMatches(summary, pattern, toParts) {
  const matches = [];
  for (const match of summary.matchAll(pattern)) {
    const parts = toParts(match);
    const date = validUtcDate(parts.year, parts.month, parts.day);
    if (date) {
      matches.push({ date, raw: match[0], index: match.index ?? 0 });
    }
  }
  return matches;
}

export function parseDeploymentDate(summary) {
  const text = String(summary ?? "");
  const candidates = [
    ...collectMatches(
      text,
      /\b(20\d{2})[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])\b/g,
      (match) => ({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }),
    ),
    ...collectMatches(
      text,
      /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{2}|20\d{2})\b/g,
      (match) => ({
        year: normalizeYear(match[3]),
        month: Number(match[1]),
        day: Number(match[2]),
      }),
    ),
    ...collectMatches(
      text,
      new RegExp(
        `\\b(${MONTH_TOKEN})\\.?\\s*,?\\s*(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})\\b`,
        "gi",
      ),
      (match) => ({
        year: Number(match[3]),
        month: MONTHS.get(match[1].toLowerCase().replace(/\.$/, "")),
        day: Number(match[2]),
      }),
    ),
    ...collectMatches(
      text,
      new RegExp(
        `\\b(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(${MONTH_TOKEN})\\.?\\s*,?\\s*(20\\d{2})\\b`,
        "gi",
      ),
      (match) => ({
        year: Number(match[3]),
        month: MONTHS.get(match[2].toLowerCase().replace(/\.$/, "")),
        day: Number(match[1]),
      }),
    ),
  ];

  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => left.index - right.index).at(-1) ?? null;
}

export function matchDeploymentTeam(summary, teams) {
  const text = String(summary ?? "").trimStart();
  return (
    teams.find((team) => {
      const escaped = team.titlePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${escaped}(?=$|[\\s:.,-])`, "i").test(text);
    }) ?? null
  );
}

export function quarterLabelForDate(date) {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export function ytdLabelForDate(date) {
  return `${date.getUTCFullYear()}-YTD`;
}

export function findSprintForDate(windows, date) {
  const quarter = quarterLabelForDate(date);
  const quarterWindows = windows
    .filter((window) => window.quarter === quarter)
    .sort((left, right) => left.start.localeCompare(right.start));
  const exact = quarterWindows.find((window) => {
      const start = new Date(`${window.start}T00:00:00.000Z`);
      const end = new Date(`${window.end}T23:59:59.999Z`);
      return date >= start && date <= end;
    });
  if (exact) return exact;
  if (quarterWindows.length === 0) return null;

  // S0 is intentionally hidden in the dashboard and Jira calendars occasionally leave a one-day
  // gap between named sprints. Keep the reporting buckets exhaustive by assigning a transition
  // day to the next visible sprint, or to the last visible sprint at quarter end.
  return (
    quarterWindows.find(
      (window) => date < new Date(`${window.start}T00:00:00.000Z`),
    ) ?? quarterWindows.at(-1) ?? null
  );
}

export function periodLabelsFrom(startDate, endDate) {
  const quarters = [];
  const years = [];
  for (let year = startDate.getUTCFullYear(); year <= endDate.getUTCFullYear(); year += 1) {
    years.push(`${year}-YTD`);
    const lastQuarter =
      year === endDate.getUTCFullYear() ? Math.floor(endDate.getUTCMonth() / 3) + 1 : 4;
    const firstQuarter =
      year === startDate.getUTCFullYear() ? Math.floor(startDate.getUTCMonth() / 3) + 1 : 1;
    for (let quarter = firstQuarter; quarter <= lastQuarter; quarter += 1) {
      quarters.push(`${year}-Q${quarter}`);
    }
  }
  return { quarters, years };
}

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const identityMapPath = path.join(repoRoot, "backend/ai/identity/team-user-map.json");
const repoScopePath = path.join(repoRoot, "backend/ai/config/github-repo-scope.json");
const outputCsvPath = path.join(repoRoot, "backend/ai/generated/json_export_view.csv");
const outputSummaryPath = path.join(repoRoot, "backend/ai/generated/github-scope-summary.json");

const headers = [
  "team_name",
  "quarter_label",
  "metric_name",
  "metric_value",
  "metric_unit",
  "source_system",
  "coverage_status",
  "note",
  "last_refresh_utc",
];

function parseEnv(text) {
  const env = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }

  return env;
}

function csvEscape(value) {
  const stringValue = value === undefined || value === null ? "" : String(value);

  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function toCsv(headersList, rows) {
  const lines = [headersList.join(",")];

  for (const row of rows) {
    lines.push(headersList.map((header) => csvEscape(row[header] ?? "")).join(","));
  }

  return `${lines.join("\n")}\n`;
}

async function readOptionalText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function teamCounts(users) {
  const counts = new Map();

  for (const user of users) {
    const teamName = String(user.team ?? "").trim();
    if (!teamName) {
      continue;
    }

    counts.set(teamName, (counts.get(teamName) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([team, count]) => ({ team, count }));
}

async function validateGithubToken(token) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub token validation failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  return {
    login: payload.login ?? "",
    id: payload.id ?? null,
  };
}

async function main() {
  const now = new Date().toISOString();
  const [envText, identityText, repoScopeText] = await Promise.all([
    readOptionalText(envPath),
    fs.readFile(identityMapPath, "utf8"),
    fs.readFile(repoScopePath, "utf8"),
  ]);

  const env = parseEnv(envText);
  const identityMap = JSON.parse(identityText);
  const repoScope = JSON.parse(repoScopeText);
  const users = Array.isArray(identityMap.users) ? identityMap.users : [];
  const repos = Array.isArray(repoScope.repos) ? repoScope.repos : [];
  const summary = {
    refreshedAt: now,
    source: "GitHub",
    usersTracked: users.length,
    teamsTracked: teamCounts(users),
    reposConfigured: repos.length,
    status: "skipped",
    note: "",
  };

  if (repos.length === 0) {
    summary.note =
      "No GitHub repository scope is configured yet. Wrote an empty AI metrics view and kept the team roster ready for later enrichment.";
  } else if (!env.GITHUB_TOKEN) {
    throw new Error("Missing GITHUB_TOKEN in .env.local for GitHub AI adoption pull.");
  } else {
    const viewer = await validateGithubToken(env.GITHUB_TOKEN);
    summary.status = "ready";
    summary.note =
      "GitHub token validated and repository scope detected. Metric extraction can now be implemented on top of this roster and repo scope.";
    summary.viewer = viewer;
  }

  await fs.mkdir(path.dirname(outputCsvPath), { recursive: true });
  await Promise.all([
    fs.writeFile(outputCsvPath, toCsv(headers, []), "utf8"),
    fs.writeFile(outputSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  ]);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

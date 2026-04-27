import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const envPath = path.join(repoRoot, ".env.local");
const identityMapPath = path.join(repoRoot, "backend/ai/identity/team-user-map.json");
const repoScopePath = path.join(repoRoot, "backend/ai/config/github-repo-scope.json");
const mappingOutputPath = path.join(repoRoot, "backend/ai/generated/repo-team-mapping.json");

const ORGS = ["vancopayments", "SmartTuition"];
const STALE_MONTHS = 6;
const API_BASE = "https://api.github.com";

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

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchAllPages(url, token) {
  const results = [];
  let nextUrl = url;

  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: githubHeaders(token) });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status} for ${nextUrl}: ${body}`);
    }

    const data = await response.json();
    results.push(...data);

    const linkHeader = response.headers.get("link") ?? "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] : null;
  }

  return results;
}

async function listOrgRepos(org, token) {
  const url = `${API_BASE}/orgs/${org}/repos?per_page=100&sort=pushed&direction=desc`;
  return fetchAllPages(url, token);
}

async function listContributors(fullName, token) {
  const url = `${API_BASE}/repos/${fullName}/contributors?per_page=100&anon=false`;

  try {
    return await fetchAllPages(url, token);
  } catch (error) {
    if (error.message.includes("204") || error.message.includes("409")) {
      return [];
    }
    throw error;
  }
}

function isRecentlyActive(repo) {
  if (!repo.pushed_at) {
    return false;
  }

  const pushed = new Date(repo.pushed_at);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - STALE_MONTHS);
  return pushed >= cutoff;
}

async function searchOrgRepos(org, token) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - STALE_MONTHS);
  const since = cutoff.toISOString().slice(0, 10);

  const results = [];
  let page = 1;

  while (true) {
    const url = `${API_BASE}/search/repositories?q=org:${org}+pushed:>${since}&per_page=100&page=${page}&sort=updated`;
    const response = await fetch(url, { headers: githubHeaders(token) });

    if (!response.ok) break;

    const data = await response.json();
    if (!data.items || data.items.length === 0) break;

    results.push(...data.items);
    if (results.length >= (data.total_count ?? 0)) break;

    page++;
  }

  return results;
}

async function main() {
  const envText = await fs.readFile(envPath, "utf8").catch(() => "");
  const env = parseEnv(envText);

  if (!env.GITHUB_TOKEN) {
    throw new Error("Missing GITHUB_TOKEN in .env.local");
  }

  const identityMap = JSON.parse(await fs.readFile(identityMapPath, "utf8"));
  const users = Array.isArray(identityMap.users) ? identityMap.users : [];
  const loginToUser = new Map();

  for (const user of users) {
    const login = String(user.githubLogin ?? "").trim().toLowerCase();
    if (login) {
      loginToUser.set(login, user);
    }
  }

  console.log(`Loaded ${loginToUser.size} tracked GitHub logins across ${new Set(users.map((u) => u.team)).size} teams`);

  const discoveredRepos = [];

  for (const org of ORGS) {
    console.log(`\nScanning org: ${org}`);

    let repos = [];

    try {
      repos = await listOrgRepos(org, env.GITHUB_TOKEN);
    } catch (error) {
      console.warn(`  Org repos API failed for ${org}: ${error.message}`);
    }

    let activeRepos = repos.filter((r) => !r.archived && !r.disabled && isRecentlyActive(r));

    if (activeRepos.length === 0) {
      console.log(`  Org repos API returned 0 results, falling back to search API...`);
      try {
        const searchResults = await searchOrgRepos(org, env.GITHUB_TOKEN);
        activeRepos = searchResults.filter((r) => !r.archived && !r.disabled);
        console.log(`  Search API found ${activeRepos.length} repos with recent activity`);
      } catch (error) {
        console.error(`  Search fallback also failed for ${org}: ${error.message}`);
      }
    } else {
      console.log(`  Found ${repos.length} repos, ${activeRepos.length} active in last ${STALE_MONTHS} months`);
    }

    for (const repo of activeRepos) {
      const fullName = repo.full_name;
      let contributors;

      try {
        contributors = await listContributors(fullName, env.GITHUB_TOKEN);
      } catch (error) {
        console.error(`  Skipping ${fullName}: ${error.message}`);
        continue;
      }

      const contributorLogins = contributors.map((c) => String(c.login ?? "").toLowerCase());
      const matchedContributors = [];
      const matchedTeams = new Set();

      for (const login of contributorLogins) {
        const user = loginToUser.get(login);
        if (user) {
          matchedContributors.push(user.githubLogin);
          matchedTeams.add(user.team);
        }
      }

      if (matchedContributors.length > 0) {
        discoveredRepos.push({
          fullName,
          teams: [...matchedTeams].sort(),
          matchedContributors: matchedContributors.sort(),
          lastPushed: repo.pushed_at,
          defaultBranch: repo.default_branch ?? "main",
        });

        console.log(`  ${fullName}: ${matchedContributors.length} matched contributors -> [${[...matchedTeams].join(", ")}]`);
      }
    }
  }

  discoveredRepos.sort((a, b) => a.fullName.localeCompare(b.fullName));

  const mapping = {
    discoveredAt: new Date().toISOString(),
    orgs: ORGS,
    totalReposWithMatches: discoveredRepos.length,
    repos: discoveredRepos,
  };

  await fs.mkdir(path.dirname(mappingOutputPath), { recursive: true });
  await fs.writeFile(mappingOutputPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
  console.log(`\nWrote repo-team-mapping.json with ${discoveredRepos.length} repos`);

  const scopeRepos = discoveredRepos.map((r) => r.fullName);
  const repoScope = { version: 1, repos: scopeRepos };
  await fs.writeFile(repoScopePath, `${JSON.stringify(repoScope, null, 2)}\n`, "utf8");
  console.log(`Updated github-repo-scope.json with ${scopeRepos.length} repos`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

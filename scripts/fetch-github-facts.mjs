#!/usr/bin/env node

/**
 * GitHub Facts Collector
 *
 * Fetches public GitHub datapoints for tools with publicProof: true.
 * Best-effort: missing permissions or API errors produce errors[] entries
 * in the output, never crash the build.
 *
 * Output: site/src/data/github-facts/<slug>.json
 *
 * Usage:
 *   node scripts/fetch-github-facts.mjs
 *
 * Environment:
 *   GITHUB_TOKEN — optional, for authenticated requests (higher rate limit)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const OVERRIDES_PATH = path.join(SITE, "src", "data", "overrides.json");
const OUTPUT_DIR = path.join(SITE, "src", "data", "github-facts");
const ORG = "mcp-tool-shop-org";
const TOKEN = process.env.GITHUB_TOKEN || "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function ghApi(endpoint) {
  const url = `https://api.github.com/${endpoint}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) headers["Authorization"] = `token ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function ghApiSafe(endpoint, label) {
  try {
    return { data: await ghApi(endpoint), error: null };
  } catch (err) {
    return { data: null, error: `${label}: ${err.message}` };
  }
}

// ─── Load overrides ───────────────────────────────────────────────────────────

const overrides = readJson(OVERRIDES_PATH);
if (!overrides) {
  console.error("Failed to load overrides.json");
  process.exit(1);
}

const enabledSlugs = Object.entries(overrides)
  .filter(([, v]) => v.publicProof === true)
  .map(([k]) => k);

if (enabledSlugs.length === 0) {
  console.log("No tools with publicProof enabled. Nothing to fetch.");
  process.exit(0);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log(`Fetching GitHub facts for: ${enabledSlugs.join(", ")}\n`);

// ─── Collect ──────────────────────────────────────────────────────────────────

for (const slug of enabledSlugs) {
  const errors = [];
  const facts = {
    slug,
    repo: `${ORG}/${slug}`,
    fetchedAt: new Date().toISOString(),
  };

  // Repo metadata
  const repo = await ghApiSafe(`repos/${ORG}/${slug}`, "repo");
  if (repo.data) {
    facts.stars = repo.data.stargazers_count;
    facts.forks = repo.data.forks_count;
    facts.watchers = repo.data.subscribers_count;
    facts.openIssues = repo.data.open_issues_count;
    facts.pushedAt = repo.data.pushed_at;
    facts.defaultBranch = repo.data.default_branch;
    facts.license = repo.data.license?.spdx_id || null;
    facts.archived = repo.data.archived;
  } else {
    errors.push(repo.error);
  }

  // Open PRs (separate count — open_issues includes PRs)
  const prs = await ghApiSafe(`repos/${ORG}/${slug}/pulls?state=open&per_page=1`, "pulls");
  if (prs.data !== null) {
    // GitHub doesn't return total count in list endpoint, but we can check length
    // For accuracy, use search API
    const search = await ghApiSafe(
      `search/issues?q=repo:${ORG}/${slug}+type:pr+state:open`,
      "pr-count"
    );
    facts.openPRs = search.data?.total_count ?? prs.data.length;
  } else {
    errors.push(prs.error);
  }

  // Latest release
  const release = await ghApiSafe(`repos/${ORG}/${slug}/releases/latest`, "release");
  if (release.data) {
    facts.latestRelease = {
      tag: release.data.tag_name,
      name: release.data.name || release.data.tag_name,
      publishedAt: release.data.published_at,
      url: release.data.html_url,
    };
  } else {
    facts.latestRelease = null;
    if (!release.error.includes("404")) {
      errors.push(release.error);
    }
  }

  // Community health
  const health = await ghApiSafe(`repos/${ORG}/${slug}/community/profile`, "community");
  if (health.data) {
    facts.communityHealth = {
      score: health.data.health_percentage,
      files: {
        readme: health.data.files?.readme != null,
        license: health.data.files?.license != null,
        contributing: health.data.files?.contributing != null,
        codeOfConduct: health.data.files?.code_of_conduct != null,
        security: health.data.files?.security != null,
      },
    };
  } else {
    errors.push(health.error);
  }

  // Traffic (requires push access — best effort)
  const traffic = await ghApiSafe(`repos/${ORG}/${slug}/traffic/views`, "traffic");
  if (traffic.data) {
    facts.traffic = {
      views14d: traffic.data.count,
      uniques14d: traffic.data.uniques,
    };
  } else {
    facts.traffic = null;
    // Don't report 403 as an error — it's expected in CI
    if (!traffic.error.includes("403")) {
      errors.push(traffic.error);
    }
  }

  // Recent releases (last 90 days for momentum)
  const releases = await ghApiSafe(`repos/${ORG}/${slug}/releases?per_page=20`, "releases");
  if (releases.data) {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const recent = releases.data.filter((r) => r.published_at >= cutoff);
    facts.releasesLast90d = recent.length;
  } else {
    errors.push(releases.error);
  }

  facts.errors = errors;

  // Write
  const outPath = path.join(OUTPUT_DIR, `${slug}.json`);
  const json = JSON.stringify(facts, null, 2) + "\n";
  fs.writeFileSync(outPath, json, "utf8");

  const status = errors.length > 0 ? `(${errors.length} warning(s))` : "(clean)";
  console.log(`  wrote github-facts/${slug}.json ${status}`);
  for (const err of errors) {
    console.warn(`    ⚠ ${err}`);
  }
}

console.log("\nDone.");

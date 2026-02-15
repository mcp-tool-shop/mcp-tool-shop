#!/usr/bin/env node

/**
 * Sync mcp-tool-shop-org repo metadata -> site/src/data/
 *
 * Outputs:
 *   projects.json   — all active repos, merged with overrides
 *   org-stats.json  — aggregate numbers for homepage
 *   releases.json   — recent releases across the org (newest first)
 */

import fs from "node:fs";
import path from "node:path";

const ORG = process.env.ORG || "mcp-tool-shop-org";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const MAX_RELEASES = 50;

const REPO_ROOT = process.cwd();
const DATA_DIR = path.join(REPO_ROOT, "site", "src", "data");
const OUT_PATH = path.join(DATA_DIR, "projects.json");
const STATS_PATH = path.join(DATA_DIR, "org-stats.json");
const RELEASES_PATH = path.join(DATA_DIR, "releases.json");
const OVERRIDES_PATH = path.join(DATA_DIR, "overrides.json");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

let apiCalls = 0;
let rateLimited = false;

async function ghFetch(url) {
  apiCalls++;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mcp-tool-shop-sync",
  };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${url}\n${body}`);
  }
  return res;
}

async function ghFetchOptional(url) {
  apiCalls++;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mcp-tool-shop-sync",
  };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (res.status === 403) {
    rateLimited = true;
    console.warn(`Rate limited at ${apiCalls} API calls, skipping remaining release fetches`);
    return null;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${url}\n${body}`);
  }
  return res;
}

async function listOrgRepos(org) {
  const all = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}&type=public&sort=updated`;
    const res = await ghFetch(url);
    const chunk = await res.json();
    all.push(...chunk);
    if (chunk.length < 100) break;
    page++;
  }
  return all;
}

async function fetchRepoReleases(fullName) {
  const url = `https://api.github.com/repos/${fullName}/releases?per_page=5`;
  const res = await ghFetchOptional(url);
  if (!res) return [];
  return await res.json();
}

function toProject(repo, override) {
  const base = {
    name: formatName(repo.name),
    repo: repo.name,
    description: repo.description || "",
    tags: repo.topics || [],
    featured: false,
    stars: repo.stargazers_count ?? 0,
    language: repo.language || "",
    updatedAt: repo.pushed_at || repo.updated_at || "",
  };

  if (override) {
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) base[key] = value;
    }
  }

  return base;
}

function formatName(slug) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function toRelease(release, repoName) {
  return {
    repo: repoName,
    toolName: formatName(repoName),
    tag: release.tag_name || "",
    name: release.name || release.tag_name || "",
    body: summarizeBody(release.body || ""),
    publishedAt: release.published_at || "",
    url: release.html_url || "",
    prerelease: release.prerelease || false,
  };
}

/** Extract first ~6 bullet points from a release body */
function summarizeBody(body) {
  if (!body) return [];
  const lines = body.split("\n");
  const bullets = [];
  for (const line of lines) {
    const trimmed = line.replace(/^[\s*\-•]+/, "").trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.toLowerCase().includes("full changelog")) continue;
    if (/^\[.*\]\(.*\)$/.test(trimmed)) continue;
    bullets.push(trimmed);
    if (bullets.length >= 6) break;
  }
  return bullets;
}

function stableSort(projects) {
  return projects.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    if (a.stars !== b.stars) return b.stars - a.stars;
    return a.name.localeCompare(b.name);
  });
}

async function main() {
  const overrides = readJson(OVERRIDES_PATH) || {};

  console.log(`Fetching repos from ${ORG}...`);
  const repos = await listOrgRepos(ORG);
  const active = repos.filter((r) => !r.archived);

  console.log(`Found ${active.length} active public repos (${repos.length} total)`);

  const projects = active.map((repo) => toProject(repo, overrides[repo.name]));
  const sorted = stableSort(projects);

  writeJson(OUT_PATH, sorted);
  console.log(`Wrote ${sorted.length} projects to ${OUT_PATH}`);

  // Fetch releases — only for repos active in the last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const recentRepos = active.filter((r) => new Date(r.pushed_at || 0) > cutoff);

  console.log(`Fetching releases for ${recentRepos.length} recently active repos...`);
  const allReleases = [];
  for (const repo of recentRepos) {
    if (rateLimited) break;
    const releases = await fetchRepoReleases(repo.full_name);
    for (const rel of releases) {
      allReleases.push(toRelease(rel, repo.name));
    }
  }

  allReleases.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  const capped = allReleases.slice(0, MAX_RELEASES);

  writeJson(RELEASES_PATH, capped);
  console.log(`Wrote ${capped.length} releases to ${RELEASES_PATH}`);

  // Aggregate stats
  const totalStars = sorted.reduce((sum, p) => sum + p.stars, 0);
  const languages = [...new Set(sorted.map((p) => p.language).filter(Boolean))];

  const stats = {
    repoCount: sorted.length,
    totalStars,
    languages,
    recentReleases: capped.length,
    updatedAt: new Date().toISOString(),
  };

  writeJson(STATS_PATH, stats);
  console.log(`Wrote org stats to ${STATS_PATH}`);
  console.log(`Total API calls: ${apiCalls}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

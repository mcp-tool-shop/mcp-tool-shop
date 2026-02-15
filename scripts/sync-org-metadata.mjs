#!/usr/bin/env node

/**
 * Sync mcp-tool-shop-org repo metadata -> site/src/data/projects.json
 *
 * - Pulls all public repos from the org via GitHub API
 * - Merges with site/src/data/overrides.json for hand-curated fields
 *   (featured, tags, custom descriptions)
 * - Writes a stable, sorted JSON so diffs stay clean
 * - Also writes site/src/data/org-stats.json with aggregate numbers
 */

import fs from "node:fs";
import path from "node:path";

const ORG = process.env.ORG || "mcp-tool-shop-org";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const REPO_ROOT = process.cwd();
const DATA_DIR = path.join(REPO_ROOT, "site", "src", "data");
const OUT_PATH = path.join(DATA_DIR, "projects.json");
const STATS_PATH = path.join(DATA_DIR, "org-stats.json");
const OVERRIDES_PATH = path.join(DATA_DIR, "overrides.json");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function ghFetch(url) {
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

  // Override wins for any key it provides
  if (override) {
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) base[key] = value;
    }
  }

  return base;
}

/** "file-compass" -> "File Compass" */
function formatName(slug) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function stableSort(projects) {
  return projects.sort((a, b) => {
    // Featured first
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    // Then by stars descending
    if (a.stars !== b.stars) return b.stars - a.stars;
    // Then alphabetical
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

  // Aggregate stats for the homepage
  const totalStars = sorted.reduce((sum, p) => sum + p.stars, 0);
  const languages = [...new Set(sorted.map((p) => p.language).filter(Boolean))];

  const stats = {
    repoCount: sorted.length,
    totalStars,
    languages,
    updatedAt: new Date().toISOString(),
  };

  writeJson(STATS_PATH, stats);
  console.log(`Wrote org stats to ${STATS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

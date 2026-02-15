#!/usr/bin/env node

/**
 * Sync mcp-tool-shop-org repo metadata -> site/src/data/
 *
 * Data sources (in merge order):
 *   1. Registry  — canonical tool list + curated names/descriptions
 *   2. GitHub    — live signals (stars, language, updatedAt)
 *   3. Overrides — editorial polish (tagline, goodFor, screenshots)
 *
 * Outputs:
 *   projects.json   — all tools + org repos, merged
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
const IGNORE_PATH = path.join(DATA_DIR, "automation.ignore.json");
const REGISTRY_PATH = path.join(DATA_DIR, "registry", "registry.json");
const ALIASES_PATH = path.join(DATA_DIR, "registry", "aliases.json");
const CLEANUP_PATH = path.join(DATA_DIR, "registry", "cleanup.json");

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

// ---------------------------------------------------------------------------
// Registry loading
// ---------------------------------------------------------------------------

/**
 * Load registry tools and return a Map<id, registryTool>.
 * Returns empty map if registry.json doesn't exist (graceful degradation).
 */
function loadRegistry() {
  const data = readJson(REGISTRY_PATH);
  if (!data || !Array.isArray(data.tools)) {
    console.warn("Registry not found or invalid — falling back to GitHub-only mode");
    return new Map();
  }
  const map = new Map();
  for (const tool of data.tools) {
    map.set(tool.id, tool);
  }
  console.log(`Loaded registry: ${map.size} tools (schema v${data.schema_version})`);
  return map;
}

/**
 * Load aliases.json — maps registry IDs to actual org repo names.
 * Handles case mismatches (e.g. claim-ledger -> ClaimLedger).
 */
function loadAliases() {
  const data = readJson(ALIASES_PATH);
  if (!data || typeof data !== "object") return new Map();
  const map = new Map();
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("$")) continue; // skip $comment etc.
    map.set(key, value);
  }
  if (map.size > 0) console.log(`Loaded ${map.size} registry aliases`);
  return map;
}

/**
 * Extract the org repo name from a registry tool.
 * Registry tools store repo as full URL; we extract the last path segment.
 * Aliases override the URL-derived name when present.
 */
function registryRepoName(tool, aliases = new Map()) {
  // Alias wins — explicit human mapping
  if (aliases.has(tool.id)) return aliases.get(tool.id);

  if (!tool.repo) return tool.id;
  try {
    const url = new URL(tool.repo);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || tool.id;
  } catch {
    return tool.id;
  }
}

// ---------------------------------------------------------------------------
// Project building
// ---------------------------------------------------------------------------

/** Build a project entry from registry + GitHub + override sources */
function buildProject({ registryTool, ghRepo, override, registered, aliases, isArchived }) {
  // 1. Start with registry data (if registered)
  const base = {
    name: "",
    repo: "",
    description: "",
    tags: [],
    featured: false,
    stars: 0,
    language: "",
    updatedAt: "",
    registered,
    unlisted: !registered, // unregistered repos default to unlisted
    deprecated: false,
  };

  if (registryTool) {
    base.name = registryTool.name || formatName(registryTool.id);
    base.repo = registryRepoName(registryTool, aliases);
    base.description = registryTool.description || "";
    base.tags = registryTool.tags || [];
    if (registryTool.ecosystem) base.ecosystem = registryTool.ecosystem;
    // Registry deprecated flag
    if (registryTool.deprecated === true) base.deprecated = true;
  }

  // GitHub archived → deprecated
  if (isArchived) base.deprecated = true;

  // 2. Overlay GitHub live signals
  if (ghRepo) {
    if (!base.repo) base.repo = ghRepo.name;
    if (!base.name) base.name = formatName(ghRepo.name);
    // GitHub description fills in only if registry didn't provide one
    if (!base.description) base.description = ghRepo.description || "";
    // Tags: registry tags win; if none, fall back to GitHub topics
    if (base.tags.length === 0) base.tags = ghRepo.topics || [];
    // Live signals always come from GitHub
    base.stars = ghRepo.stargazers_count ?? 0;
    base.language = ghRepo.language || "";
    base.updatedAt = ghRepo.pushed_at || ghRepo.updated_at || "";
  }

  // 3. Overlay editorial overrides (overrides always win)
  if (override) {
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) base[key] = value;
    }
  }

  // Ensure unlisted is false if override explicitly set it
  // (override can force-show an unregistered repo)
  if (override && override.unlisted === false) {
    base.unlisted = false;
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const overrides = readJson(OVERRIDES_PATH) || {};
  const ignoreList = new Set(readJson(IGNORE_PATH) || []);
  const registry = loadRegistry();
  const aliases = loadAliases();

  // Fetch all org repos from GitHub
  console.log(`Fetching repos from ${ORG}...`);
  const repos = await listOrgRepos(ORG);
  const active = repos.filter((r) => !r.archived);
  console.log(`Found ${active.length} active public repos (${repos.length} total)`);

  // Build repo lookups
  const repoByName = new Map();
  const archivedRepos = new Set();
  for (const repo of active) {
    repoByName.set(repo.name, repo);
  }
  for (const repo of repos) {
    if (repo.archived) archivedRepos.add(repo.name);
  }

  // Track which org repos get claimed by registry tools
  const claimedRepos = new Set();
  const projects = [];
  const warnings = [];

  // Structured cleanup data for upstream hygiene
  const cleanupArchived = [];
  const cleanupMissing = [];
  const cleanupAliases = [];

  // Collect alias entries for cleanup
  for (const [registryId, repoName] of aliases) {
    cleanupAliases.push({
      registryId,
      repoName,
      reason: "case-mismatch or rename",
    });
  }

  // --- Phase 1: Registry tools (registered: true) ---
  for (const [id, tool] of registry) {
    const repoName = registryRepoName(tool, aliases);

    // Skip ignored repos
    if (ignoreList.has(repoName) || ignoreList.has(id)) continue;

    const ghRepo = repoByName.get(repoName);
    if (!ghRepo) {
      if (archivedRepos.has(repoName)) {
        warnings.push(`Registry tool "${id}" → repo "${repoName}" is archived`);
        cleanupArchived.push({
          registryId: id,
          repoName,
          repo: tool.repo || "",
          action: "remove or mark deprecated in registry",
        });
      } else {
        warnings.push(`Registry tool "${id}" has no matching org repo "${repoName}"`);
        cleanupMissing.push({
          registryId: id,
          repoName,
          repo: tool.repo || "",
          action: "verify repo exists or remove from registry",
        });
      }
    } else {
      claimedRepos.add(repoName);
    }

    projects.push(
      buildProject({
        registryTool: tool,
        ghRepo: ghRepo || null,
        override: overrides[repoName] || overrides[id] || null,
        registered: true,
        aliases,
        isArchived: archivedRepos.has(repoName),
      })
    );
  }

  // --- Phase 2: Orphan org repos (registered: false) ---
  for (const repo of active) {
    if (claimedRepos.has(repo.name)) continue;
    if (ignoreList.has(repo.name)) continue;

    projects.push(
      buildProject({
        registryTool: null,
        ghRepo: repo,
        override: overrides[repo.name] || null,
        registered: false,
        aliases,
        isArchived: false,
      })
    );
  }

  const sorted = stableSort(projects);

  // Summary counts
  const registeredCount = sorted.filter((p) => p.registered).length;
  const unlistedCount = sorted.filter((p) => p.unlisted).length;
  const orphanCount = sorted.filter((p) => !p.registered).length;

  writeJson(OUT_PATH, sorted);
  console.log(
    `Wrote ${sorted.length} projects to ${OUT_PATH} ` +
    `(${registeredCount} registered, ${orphanCount} org-only, ${unlistedCount} unlisted)`
  );

  if (warnings.length > 0) {
    console.log(`\nRegistry warnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  // Fetch releases — only for repos active in the last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const recentRepos = active.filter((r) => new Date(r.pushed_at || 0) > cutoff);

  console.log(`\nFetching releases for ${recentRepos.length} recently active repos...`);
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

  // Aggregate stats + registry health
  const totalStars = sorted.reduce((sum, p) => sum + p.stars, 0);
  const languages = [...new Set(sorted.map((p) => p.language).filter(Boolean))];

  // Classify warnings
  const registryArchivedCount = warnings.filter((w) => w.includes("is archived")).length;
  const registryMissingCount = warnings.filter((w) => w.includes("has no matching org repo")).length;

  const stats = {
    repoCount: sorted.length,
    registeredCount,
    totalStars,
    languages,
    recentReleases: capped.length,
    updatedAt: new Date().toISOString(),
    registryHealth: {
      registryToolCount: registry.size,
      registeredInProjects: registeredCount,
      orgOnlyRepos: orphanCount,
      registryArchived: registryArchivedCount,
      registryMissing: registryMissingCount,
      ignoredRepos: ignoreList.size,
      aliasCount: aliases.size,
      warnings: warnings.length,
    },
  };

  writeJson(STATS_PATH, stats);
  console.log(`Wrote org stats to ${STATS_PATH}`);

  // --- Cleanup artifact ---
  const cleanup = {
    generatedAt: new Date().toISOString(),
    archived: cleanupArchived,
    missing: cleanupMissing,
    aliases: cleanupAliases,
    totalIssues: cleanupArchived.length + cleanupMissing.length,
  };

  writeJson(CLEANUP_PATH, cleanup);
  console.log(
    `Wrote cleanup queue to ${CLEANUP_PATH} ` +
    `(${cleanupArchived.length} archived, ${cleanupMissing.length} missing, ${cleanupAliases.length} aliases)`
  );

  // --- Registry health report ---
  console.log("\n--- Registry Health Report ---");
  console.log(`  Registry tools:      ${registry.size}`);
  console.log(`  Registered projects: ${registeredCount}`);
  console.log(`  Org-only repos:      ${orphanCount}`);
  console.log(`  Registry→archived:   ${registryArchivedCount}`);
  console.log(`  Registry→missing:    ${registryMissingCount}`);
  console.log(`  Aliases applied:     ${aliases.size}`);
  console.log(`  Ignored repos:       ${ignoreList.size}`);
  console.log(`  Total warnings:      ${warnings.length}`);
  console.log(`  Total API calls:     ${apiCalls}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

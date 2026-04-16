#!/usr/bin/env node
/**
 * Surface Compilation Script
 *
 * Derives public surfaces (collections, today's picks, featured flags)
 * from the lane/surfaceEligible model in overrides.json.
 *
 * Generates surface-report.json as a truth receipt.
 *
 * Usage: node scripts/compile-surfaces.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../site/src/data");

function load(relPath) {
  return JSON.parse(fs.readFileSync(path.join(DATA, relPath), "utf8"));
}

function write(relPath, data) {
  fs.writeFileSync(
    path.join(DATA, relPath),
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );
}

// ── Load truth sources ──────────────────────────────────────────
const projects = load("projects.json");
const overrides = load("overrides.json");
const repoSet = new Set(projects.map((p) => p.repo));

// ── Build enriched project map ──────────────────────────────────
const enriched = new Map();
for (const p of projects) {
  const ov = overrides[p.repo] || {};
  enriched.set(p.repo, {
    repo: p.repo,
    name: p.name,
    lane: ov.lane || "unknown",
    surfaceEligible: ov.surfaceEligible === true,
    needsHumanReview: ov.needsHumanReview === true,
    featured: ov.featured === true,
    category: ov.category || null,
    stability: ov.stability || null,
    updatedAt: p.updatedAt || null,
  });
}

// ── Compile collections from lane-eligible repos ────────────────
// Collections are the 5 pillar groups. Only include repos that are
// surfaceEligible AND exist in projects.json.
const collections = load("collections.json");
const collectionReport = [];

for (const col of collections) {
  const validRepos = col.repos.filter((slug) => {
    const e = enriched.get(slug);
    if (!e) return false;
    if (!e.surfaceEligible) {
      collectionReport.push({
        collection: col.id,
        repo: slug,
        action: "blocked",
        reason: e.needsHumanReview
          ? "needsHumanReview"
          : `lane=${e.lane}, not eligible`,
      });
      return false;
    }
    collectionReport.push({
      collection: col.id,
      repo: slug,
      action: "included",
      reason: `lane=${e.lane}, surfaceEligible=true`,
    });
    return true;
  });
  col.repos = validRepos;
}

// ── Compile featured from lane rules ────────────────────────────
// Featured must be surfaceEligible. Max 6.
const featuredReport = [];
const featuredRepos = [];
for (const [repo, e] of enriched) {
  if (e.featured) {
    if (e.surfaceEligible) {
      featuredRepos.push(repo);
      featuredReport.push({ repo, action: "included", reason: "featured + surfaceEligible" });
    } else {
      featuredReport.push({ repo, action: "blocked", reason: `featured but not surfaceEligible (lane=${e.lane})` });
    }
  }
}

// ── Compile today's picks from lane rules ───────────────────────
const picks = load("todays-picks.json");
const picksReport = [];
for (const pick of picks.picks) {
  const e = enriched.get(pick.slug);
  if (!e) {
    picksReport.push({ slug: pick.slug, action: "missing", reason: "not in projects" });
  } else if (!e.surfaceEligible) {
    picksReport.push({ slug: pick.slug, action: "blocked", reason: `lane=${e.lane}, not eligible` });
  } else {
    picksReport.push({ slug: pick.slug, action: "included", reason: `lane=${e.lane}, surfaceEligible=true` });
  }
}

// ── Generate surface report ─────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    totalProjects: projects.length,
    byLane: {},
    surfaceEligible: [...enriched.values()].filter((e) => e.surfaceEligible).length,
    blocked: [...enriched.values()].filter((e) => !e.surfaceEligible).length,
    featured: featuredRepos.length,
    needsHumanReview: [...enriched.values()].filter((e) => e.needsHumanReview).length,
  },
  repos: [],
  collections: collectionReport,
  featured: featuredReport,
  picks: picksReport,
};

// Count by lane
for (const e of enriched.values()) {
  report.summary.byLane[e.lane] = (report.summary.byLane[e.lane] || 0) + 1;
}

// Per-repo detail
for (const e of [...enriched.values()].sort((a, b) => a.repo.localeCompare(b.repo))) {
  const surfaces = [];
  if (e.surfaceEligible) surfaces.push("catalog");
  if (e.featured) surfaces.push("featured");

  // Check collection membership
  for (const col of collections) {
    if (col.repos.includes(e.repo)) surfaces.push(`collection:${col.id}`);
  }

  // Check picks membership
  if (picks.picks.some((p) => p.slug === e.repo)) surfaces.push("picks");

  report.repos.push({
    repo: e.repo,
    lane: e.lane,
    surfaceEligible: e.surfaceEligible,
    needsHumanReview: e.needsHumanReview,
    surfaces,
    blockedReason: e.surfaceEligible
      ? null
      : e.needsHumanReview
        ? "needsHumanReview"
        : `lane=${e.lane}`,
  });
}

// ── Write outputs ───────────────────────────────────────────────
write("collections.json", collections);
write("surface-report.json", report);

// ── Console summary ─────────────────────────────────────────────
console.log("Surface compilation complete:");
console.log(`  Projects: ${report.summary.totalProjects}`);
console.log(`  By lane:`, report.summary.byLane);
console.log(`  Surface eligible: ${report.summary.surfaceEligible}`);
console.log(`  Blocked: ${report.summary.blocked}`);
console.log(`  Featured: ${report.summary.featured}`);
console.log(`  Needs human review: ${report.summary.needsHumanReview}`);
console.log(`  Collections validated: ${collections.length}`);
console.log(`  Picks validated: ${picks.picks.length}`);
console.log(`  Wrote surface-report.json`);

// ── Gate checks ─────────────────────────────────────────────────
let gatesFailed = 0;

// Gate: no seed_vault in catalog
const seedInCatalog = report.repos.filter(
  (r) => r.lane === "seed_vault" && r.surfaceEligible
);
if (seedInCatalog.length > 0) {
  console.error("GATE FAIL: seed_vault repos in catalog:", seedInCatalog.map((r) => r.repo));
  gatesFailed++;
}

// Gate: no needsHumanReview leaking into surfaces
const reviewLeaks = report.repos.filter(
  (r) => r.needsHumanReview && r.surfaceEligible
);
if (reviewLeaks.length > 0) {
  console.error("GATE FAIL: needsHumanReview leaking to surfaces:", reviewLeaks.map((r) => r.repo));
  gatesFailed++;
}

// Gate: featured count <= 6
if (featuredRepos.length > 6) {
  console.error("GATE FAIL: too many featured repos:", featuredRepos.length);
  gatesFailed++;
}

// Gate: all collection repos exist and are eligible
const badCollections = collectionReport.filter((r) => r.action === "blocked");
if (badCollections.length > 0) {
  console.error(
    "GATE WARN: blocked collection repos:",
    badCollections.map((r) => `${r.collection}/${r.repo}: ${r.reason}`)
  );
  // Warning, not failure — collections were already filtered
}

if (gatesFailed > 0) {
  console.error(`${gatesFailed} gate(s) failed`);
  process.exit(1);
}

console.log("All gates passed.");

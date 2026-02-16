#!/usr/bin/env node

/**
 * Ingest clearance artifacts into the marketing site.
 *
 * Reads published artifacts from a NameOps run and merges them into
 * site/public/lab/clearance/ for Astro to consume.
 *
 * Interface:
 *   node scripts/ingest-clearance.mjs <artifact-dir> [--dry-run]
 *
 * Expects <artifact-dir> to contain:
 *   runs.json           — Array of { name, slug, tier, score, date }
 *   <slug>/             — Per-slug directories with:
 *     report.html
 *     summary.json
 *     clearance-index.json
 *     run.json
 *
 * Writes to:
 *   site/public/lab/clearance/runs.json     — Merged index (deduped by slug, sorted by date desc)
 *   site/public/lab/clearance/<slug>/       — Copied per-slug files
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";

// ── Helpers ─────────────────────────────────────────────────

/**
 * Safely parse a JSON file. Returns fallback on error.
 * @param {string} filePath
 * @param {*} fallback
 * @returns {*}
 */
function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// ── Per-slug file list ──────────────────────────────────────

/** Files to copy from source slug dir to dest slug dir */
const SLUG_FILES = [
  "report.html",
  "summary.json",
  "clearance-index.json",
  "run.json",
];

// ── Core ────────────────────────────────────────────────────

/**
 * Ingest clearance artifacts into the marketing site directory.
 *
 * @param {string} sourceDir - Published artifacts directory (contains runs.json + slug dirs)
 * @param {string} destDir   - Marketing site clearance directory (site/public/lab/clearance)
 * @param {{ dryRun?: boolean }} opts
 * @returns {{ merged: number, copied: number, skipped: number }}
 */
export function ingestClearance(sourceDir, destDir, opts = {}) {
  const { dryRun = false } = opts;

  // 1. Read source runs.json
  const sourceIndex = safeParseJson(join(sourceDir, "runs.json"), []);
  if (!Array.isArray(sourceIndex) || sourceIndex.length === 0) {
    console.log("  No source entries found in runs.json — nothing to ingest.");
    return { merged: 0, copied: 0, skipped: 0 };
  }

  // 2. Read existing dest runs.json
  const destIndexPath = join(destDir, "runs.json");
  const destIndex = safeParseJson(destIndexPath, []);

  // 3. Merge: source entries replace dest entries by slug (dedup)
  const bySlug = new Map();
  for (const entry of destIndex) {
    if (entry.slug) bySlug.set(entry.slug, entry);
  }
  for (const entry of sourceIndex) {
    if (entry.slug) bySlug.set(entry.slug, entry);
  }

  // 4. Sort merged by date descending
  const merged = [...bySlug.values()].sort((a, b) => {
    const da = a.date || "";
    const db = b.date || "";
    return db.localeCompare(da);
  });

  // 5. Copy per-slug files
  let copied = 0;
  let skipped = 0;

  for (const entry of sourceIndex) {
    const slug = entry.slug || entry.name;
    if (!slug) {
      skipped++;
      continue;
    }

    const srcSlugDir = join(sourceDir, slug);
    const destSlugDir = join(destDir, slug);

    if (!existsSync(srcSlugDir)) {
      console.log(`  ⚠ Source directory missing for ${slug} — skipping`);
      skipped++;
      continue;
    }

    if (!dryRun) {
      mkdirSync(destSlugDir, { recursive: true });
    }

    for (const file of SLUG_FILES) {
      const srcFile = join(srcSlugDir, file);
      if (existsSync(srcFile)) {
        if (dryRun) {
          console.log(`  [dry-run] Would copy ${slug}/${file}`);
        } else {
          copyFileSync(srcFile, join(destSlugDir, file));
        }
        copied++;
      }
    }
  }

  // 6. Write merged runs.json
  if (dryRun) {
    console.log(`  [dry-run] Would write merged runs.json with ${merged.length} entries`);
  } else {
    mkdirSync(destDir, { recursive: true });
    writeFileSync(destIndexPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  }

  console.log(`  ✓ Ingested: ${merged.length} total entries, ${copied} files copied, ${skipped} skipped`);
  return { merged: merged.length, copied, skipped };
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("ingest-clearance.mjs");

if (isMain) {
  const artifactDir = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!artifactDir) {
    console.error("Usage: node scripts/ingest-clearance.mjs <artifact-dir> [--dry-run]");
    process.exit(1);
  }

  const sourceDir = resolve(artifactDir);
  const destDir = resolve("site/public/lab/clearance");

  if (!existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  console.log(`Ingesting clearance artifacts...`);
  console.log(`  Source: ${sourceDir}`);
  console.log(`  Dest:   ${destDir}`);
  if (dryRun) console.log(`  Mode:   DRY RUN`);

  const result = ingestClearance(sourceDir, destDir, { dryRun });

  if (result.merged === 0) {
    console.log("Nothing to ingest.");
  } else {
    console.log(`Done. ${result.merged} entries in runs.json.`);
  }
}

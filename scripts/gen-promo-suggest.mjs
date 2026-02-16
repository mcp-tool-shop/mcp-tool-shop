#!/usr/bin/env node

/**
 * Promo Suggestions Generator
 *
 * Reads clearance results + worthy.json, suggests GREEN-tier candidates
 * for promotion. NEVER edits promo-queue.json or promo.json — suggestions
 * only. Human must manually add to queue.
 *
 * Usage:
 *   node scripts/gen-promo-suggest.mjs [--dry-run]
 *
 * Reads:
 *   site/public/lab/clearance/*.json   (clearance reports)
 *   site/src/data/worthy.json
 *   site/src/data/promo-queue.json
 *   site/src/data/automation.ignore.json
 *
 * Writes:
 *   site/src/data/promo-suggestions.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");
const CLEARANCE_DIR = join(ROOT, "site", "public", "lab", "clearance");

// ── Constants ───────────────────────────────────────────────

const GREEN_THRESHOLD = 80; // Minimum overallScore for GREEN tier
const DEFAULT_CHANNELS = ["presskit", "snippets"];

// ── Helpers ─────────────────────────────────────────────────

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// ── Core ────────────────────────────────────────────────────

/**
 * Analyze clearance results and suggest promotion candidates.
 *
 * @param {string} clearanceDir - Path to clearance report directory
 * @param {object} worthy - worthy.json contents
 * @param {{ queue?: object, ignoreList?: string[] }} opts
 * @returns {Array<{ slug: string, score: number, worthy: boolean, reason: string, channels: string[] }>}
 */
export function analyzeCandidates(clearanceDir, worthy, opts = {}) {
  const { queue = {}, ignoreList = [] } = opts;

  const ignoreSet = new Set(ignoreList);
  const queuedSlugs = new Set(
    (queue.slugs || []).map((s) => typeof s === "string" ? s : s.slug)
  );
  const worthyRepos = worthy?.repos || {};

  // Scan clearance directory for JSON reports
  let reportFiles = [];
  try {
    if (existsSync(clearanceDir)) {
      reportFiles = readdirSync(clearanceDir).filter(
        (f) => f.endsWith(".json") && f !== "runs.json"
      );
    }
  } catch { /* fail soft */ }

  const suggestions = [];

  for (const file of reportFiles) {
    const report = safeParseJson(join(clearanceDir, file), null);
    if (!report) continue;

    const slug = report.slug || report.name || file.replace(".json", "");

    // Skip if in ignore list
    if (ignoreSet.has(slug)) continue;

    // Skip if already queued
    if (queuedSlugs.has(slug)) continue;

    // Check GREEN threshold
    const score = report.overallScore || report.score || 0;
    if (score < GREEN_THRESHOLD) continue;

    // Check worthy status
    const worthyEntry = worthyRepos[slug];
    if (!worthyEntry?.worthy) continue;

    suggestions.push({
      slug,
      score,
      worthy: true,
      reason: "GREEN clearance + worthy rubric passed",
      channels: [...DEFAULT_CHANNELS],
    });
  }

  return suggestions;
}

/**
 * Full pipeline: scan clearance, filter, write suggestions.
 *
 * @param {{ dataDir?: string, clearanceDir?: string, dryRun?: boolean }} opts
 * @returns {object} Suggestions output
 */
export function generateSuggestions(opts = {}) {
  const {
    dataDir = DATA_DIR,
    clearanceDir = CLEARANCE_DIR,
    dryRun = false,
  } = opts;

  const worthy = safeParseJson(join(dataDir, "worthy.json"), {});
  const queue = safeParseJson(join(dataDir, "promo-queue.json"), {});
  const ignoreList = safeParseJson(join(dataDir, "automation.ignore.json"), []);

  const suggestions = analyzeCandidates(clearanceDir, worthy, {
    queue,
    ignoreList,
  });

  const output = {
    generatedAt: new Date().toISOString(),
    suggestions,
  };

  if (dryRun) {
    console.log(`  [dry-run] Would write promo-suggestions.json`);
    console.log(`  [dry-run] Suggestions: ${suggestions.length}`);
    return output;
  }

  writeFileSync(
    join(dataDir, "promo-suggestions.json"),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );
  console.log(`  Wrote promo-suggestions.json (${suggestions.length} suggestions)`);

  return output;
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-promo-suggest.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating promo suggestions...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const result = generateSuggestions({ dryRun });
  console.log(`  Suggestions: ${result.suggestions.length}`);
}

#!/usr/bin/env node

/**
 * Worthy Scorecard Generator
 *
 * Reads worthy.json and generates per-repo scorecard markdown files.
 *
 * Usage:
 *   node scripts/gen-worthy-scorecard.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/worthy.json
 *
 * Writes:
 *   site/public/lab/worthy/<slug>/scorecard.md  (per repo)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");
const OUT_DIR = join(ROOT, "site", "public", "lab", "worthy");

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
 * Build a scorecard markdown string for a single repo.
 *
 * @param {string} slug - Repo slug
 * @param {{ worthy: boolean, score: number, reason: string, assessedDate?: string, missing?: string[] }} entry
 * @param {{ criteria: string[], minimumScore: number }} rubric
 * @returns {string} Markdown scorecard
 */
export function buildScorecard(slug, entry, rubric) {
  const lines = [];
  const missingSet = new Set(entry.missing || []);

  lines.push(`# Scorecard: ${slug}`);
  lines.push("");
  lines.push(`**Status:** ${entry.worthy ? "Worthy" : "Not Worthy"}`);
  lines.push(`**Score:** ${entry.score}/${rubric.criteria.length} (minimum: ${rubric.minimumScore})`);
  if (entry.assessedDate) {
    lines.push(`**Assessed:** ${entry.assessedDate}`);
  }
  lines.push(`**Reason:** ${entry.reason}`);
  lines.push("");

  lines.push("## Criteria");
  lines.push("");
  for (const criterion of rubric.criteria) {
    const passed = !missingSet.has(criterion);
    const icon = passed ? "\u2705" : "\u274c";
    lines.push(`- ${icon} ${criterion}`);
  }
  lines.push("");

  // Next Steps section for non-worthy repos
  if (!entry.worthy && missingSet.size > 0) {
    lines.push("## Next Steps");
    lines.push("");
    for (const missing of missingSet) {
      lines.push(`- Address: ${missing}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate scorecards for all repos in worthy.json.
 *
 * @param {string} [worthyPath] - Path to worthy.json
 * @param {string} [outDir] - Output directory
 * @param {{ dryRun?: boolean }} opts
 * @returns {{ generated: number, skipped: number }}
 */
export function generateScorecards(worthyPath, outDir, opts = {}) {
  const wPath = worthyPath || join(DATA_DIR, "worthy.json");
  const oDir = outDir || OUT_DIR;
  const dryRun = opts.dryRun || false;

  const worthy = safeParseJson(wPath, { rubric: { criteria: [], minimumScore: 0 }, repos: {} });
  const rubric = worthy.rubric || { criteria: [], minimumScore: 0 };
  const repos = worthy.repos || {};

  let generated = 0;
  let skipped = 0;

  for (const [slug, entry] of Object.entries(repos)) {
    const scorecard = buildScorecard(slug, entry, rubric);
    const slugDir = join(oDir, slug);

    if (dryRun) {
      console.log(`  [dry-run] Would write scorecard for ${slug}`);
      generated++;
      continue;
    }

    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "scorecard.md"), scorecard, "utf8");
    console.log(`  Scorecard: ${slug} (${entry.worthy ? "worthy" : "not worthy"}, ${entry.score}/${rubric.criteria.length})`);
    generated++;
  }

  return { generated, skipped };
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-worthy-scorecard.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating worthy scorecards...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const result = generateScorecards(undefined, undefined, { dryRun });
  console.log(`  Generated: ${result.generated}, Skipped: ${result.skipped}`);
}

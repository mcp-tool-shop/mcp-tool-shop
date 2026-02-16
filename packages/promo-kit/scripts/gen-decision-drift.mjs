#!/usr/bin/env node

/**
 * Decision Drift Detector
 *
 * Compares current vs previous promo-decisions.json to detect
 * week-over-week drift in promotion decisions — new entrants,
 * exits, score deltas, and action changes.
 *
 * Usage:
 *   node scripts/gen-decision-drift.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/promo-decisions.json
 *   site/src/data/decision-drift-snapshot.json
 *   site/src/data/governance.json
 *
 * Writes:
 *   site/src/data/decision-drift.json
 *   site/public/lab/decisions/decision-drift.md
 *   site/src/data/decision-drift-snapshot.json (updated snapshot)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { getConfig, getRoot } from "./lib/config.mjs";

const ROOT = getRoot();
const config = getConfig();
const DATA_DIR = join(ROOT, config.paths.dataDir);
const DECISIONS_DIR = join(ROOT, config.paths.publicDir, "lab", "decisions");

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
 * Build drift report comparing previous and current promo decisions.
 *
 * @param {object|null} previous - Previous promo-decisions object (null on first run)
 * @param {object|null} current  - Current promo-decisions object
 * @returns {{ entrants: string[], exits: string[], scoreDeltas: Array, reasonChanges: Array, summary: object }}
 */
export function buildDrift(previous, current) {
  const prevDecisions = previous?.decisions ?? [];
  const currDecisions = current?.decisions ?? [];

  const prevMap = new Map();
  for (const d of prevDecisions) {
    if (d && d.slug) prevMap.set(d.slug, d);
  }

  const currMap = new Map();
  for (const d of currDecisions) {
    if (d && d.slug) currMap.set(d.slug, d);
  }

  const prevSlugs = new Set(prevMap.keys());
  const currSlugs = new Set(currMap.keys());

  // Entrants: in current but not in previous
  const entrants = [...currSlugs].filter((s) => !prevSlugs.has(s));

  // Exits: in previous but not in current
  const exits = [...prevSlugs].filter((s) => !currSlugs.has(s));

  // Common slugs: compute score deltas and action changes
  const commonSlugs = [...currSlugs].filter((s) => prevSlugs.has(s));

  const scoreDeltas = [];
  const reasonChanges = [];

  for (const slug of commonSlugs) {
    const prev = prevMap.get(slug);
    const curr = currMap.get(slug);

    const prevScore = prev.score ?? 0;
    const currScore = curr.score ?? 0;
    const delta = currScore - prevScore;

    scoreDeltas.push({ slug, prevScore, currScore, delta });

    if (prev.action !== curr.action) {
      reasonChanges.push({ slug, prevAction: prev.action, currAction: curr.action });
    }
  }

  // Summary
  const deltasWithChange = scoreDeltas.filter((d) => d.delta !== 0).length;
  const actionOnlyChanges = reasonChanges.filter((rc) => {
    const sd = scoreDeltas.find((d) => d.slug === rc.slug);
    return sd && sd.delta === 0;
  }).length;
  const totalChanged = entrants.length + exits.length + deltasWithChange + actionOnlyChanges;
  const totalStable = commonSlugs.length - deltasWithChange - actionOnlyChanges;

  return {
    entrants,
    exits,
    scoreDeltas,
    reasonChanges,
    summary: { totalChanged, totalStable },
  };
}

// ── Markdown generator ──────────────────────────────────────

/**
 * Build a markdown summary of decision drift.
 *
 * @param {object} drift - Output from buildDrift()
 * @returns {string}
 */
function generateDriftMd(drift) {
  const { entrants, exits, scoreDeltas, reasonChanges, summary } = drift;
  const lines = [];

  lines.push("# Decision Drift Report");
  lines.push("");
  lines.push(`*Generated: ${new Date().toISOString().slice(0, 10)}*`);
  lines.push("");

  // Entrants
  lines.push("## Entrants");
  lines.push("");
  if (entrants.length > 0) {
    for (const slug of entrants) {
      lines.push(`- ${slug}`);
    }
  } else {
    lines.push("No new entrants.");
  }
  lines.push("");

  // Exits
  lines.push("## Exits");
  lines.push("");
  if (exits.length > 0) {
    for (const slug of exits) {
      lines.push(`- ${slug}`);
    }
  } else {
    lines.push("No exits.");
  }
  lines.push("");

  // Score Deltas
  lines.push("## Score Deltas");
  lines.push("");
  if (scoreDeltas.length > 0) {
    lines.push("| Slug | Prev Score | Curr Score | Delta |");
    lines.push("|------|-----------|-----------|-------|");
    for (const d of scoreDeltas) {
      const sign = d.delta > 0 ? "+" : "";
      lines.push(`| ${d.slug} | ${d.prevScore} | ${d.currScore} | ${sign}${d.delta} |`);
    }
  } else {
    lines.push("No common slugs to compare.");
  }
  lines.push("");

  // Action Changes
  lines.push("## Action Changes");
  lines.push("");
  if (reasonChanges.length > 0) {
    for (const rc of reasonChanges) {
      lines.push(`- **${rc.slug}**: ${rc.prevAction} \u2192 ${rc.currAction}`);
    }
  } else {
    lines.push("No action changes.");
  }
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total changed:** ${summary.totalChanged}`);
  lines.push(`- **Total stable:** ${summary.totalStable}`);
  lines.push("");

  return lines.join("\n");
}

// ── Pipeline ─────────────────────────────────────────────────

/**
 * Generate decision drift artifacts.
 * @param {{ dataDir?: string, decisionsDir?: string, dryRun?: boolean }} opts
 */
export function generateDecisionDrift(opts = {}) {
  const {
    dataDir = DATA_DIR,
    decisionsDir = DECISIONS_DIR,
    dryRun = false,
  } = opts;

  const current = safeParseJson(join(dataDir, "promo-decisions.json"), { decisions: [] });
  const previous = safeParseJson(join(dataDir, "decision-drift-snapshot.json"), null);
  const governance = safeParseJson(join(dataDir, "governance.json"), {});

  const drift = buildDrift(previous, current);

  const output = {
    generatedAt: new Date().toISOString(),
    ...drift,
  };

  if (dryRun) {
    console.log("  [dry-run] Decision drift computed.");
    console.log(`    Entrants: ${drift.entrants.length}, Exits: ${drift.exits.length}`);
    console.log(`    Score deltas: ${drift.scoreDeltas.length}, Action changes: ${drift.reasonChanges.length}`);
    return output;
  }

  // Write drift JSON
  const driftPath = join(dataDir, "decision-drift.json");
  writeFileSync(driftPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  // Write drift markdown
  mkdirSync(decisionsDir, { recursive: true });
  const md = generateDriftMd(drift);
  writeFileSync(join(decisionsDir, "decision-drift.md"), md + "\n", "utf8");

  // Update snapshot (unless frozen)
  if (governance.decisionsFrozen !== true) {
    writeFileSync(
      join(dataDir, "decision-drift-snapshot.json"),
      JSON.stringify(current, null, 2) + "\n",
      "utf8",
    );
  }

  console.log(`  Decision drift written → ${driftPath}`);
  return output;
}

// ── Entry point ──────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("gen-decision-drift.mjs");
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating decision drift...");
  if (dryRun) console.log("  Mode: DRY RUN");
  generateDecisionDrift({ dryRun });
}

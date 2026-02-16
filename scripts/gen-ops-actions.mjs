#!/usr/bin/env node

/**
 * Ops Actions Generator
 *
 * Analyzes ops-history.json, promo.json, promo-queue.json, and worthy.json
 * to produce actionable recommendations for the ops dashboard.
 *
 * Usage:
 *   node scripts/gen-ops-actions.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/ops-history.json
 *   site/src/data/promo.json
 *   site/src/data/promo-queue.json
 *   site/src/data/worthy.json
 *
 * Writes:
 *   site/src/data/ops-actions.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");

// ── Helpers ─────────────────────────────────────────────────

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// ── Error code → runbook mapping ────────────────────────────

const ERROR_RUNBOOK_MAP = {
  RATE_LIMIT: "Increase maxAgeHours to use more cached results",
  TIMEOUT: "Reduce concurrency or name count in profile.json",
  COE_NOT_FOUND: "Check npm install -g @mcptoolshop/clearance-opinion-engine step",
  NETWORK: "Check network connectivity; retry on next scheduled run",
  PARSE: "Review batch output for malformed JSON responses",
  UNKNOWN: "Check workflow logs for details",
};

// ── Core analysis ───────────────────────────────────────────

/**
 * Analyze ops history and related data to produce action recommendations.
 *
 * @param {Array} history - ops-history.json entries (newest first)
 * @param {{ promo?: object, promoQueue?: object, worthy?: object, recentCount?: number }} opts
 * @returns {Array<{ level: string, category: string, message: string, action: string, runbookSection?: string }>}
 */
export function analyzeOpsHistory(history, opts = {}) {
  const {
    promo = {},
    promoQueue = {},
    worthy = { repos: {} },
    recentCount = 5,
  } = opts;

  const actions = [];
  const recent = history.slice(0, recentCount);

  if (recent.length === 0) {
    return actions;
  }

  // ── 1. Cache warnings ──────────────────────────────────
  // Per-adapter: if avg cache hit rate < 0.70 across recent runs → warning
  const adapterAgg = {};
  for (const run of recent) {
    if (!run.costStats?.adapterBreakdown) continue;
    for (const [ns, stats] of Object.entries(run.costStats.adapterBreakdown)) {
      if (!adapterAgg[ns]) adapterAgg[ns] = { calls: 0, cached: 0 };
      adapterAgg[ns].calls += stats.calls || 0;
      adapterAgg[ns].cached += stats.cached || 0;
    }
  }

  for (const [ns, stats] of Object.entries(adapterAgg)) {
    const rate = stats.calls > 0 ? stats.cached / stats.calls : 1;
    if (rate < 0.70) {
      actions.push({
        level: "warning",
        category: "cache",
        message: `Adapter "${ns}" cache hit rate is ${Math.round(rate * 100)}% (below 70% threshold)`,
        action: "Increase maxAgeHours in profile.json to serve more results from cache",
        runbookSection: "Cost Monitoring",
      });
    }
  }

  // ── 2. Error patterns ──────────────────────────────────
  // Top 3 error codes from recent runs → map to runbook sections
  const errorAgg = {};
  for (const run of recent) {
    if (!run.errorCodes) continue;
    for (const [code, count] of Object.entries(run.errorCodes)) {
      errorAgg[code] = (errorAgg[code] || 0) + count;
    }
  }

  const topErrors = Object.entries(errorAgg)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  for (const [code, count] of topErrors) {
    const runbookAction = ERROR_RUNBOOK_MAP[code] || ERROR_RUNBOOK_MAP.UNKNOWN;
    actions.push({
      level: "error",
      category: "errors",
      message: `Error code "${code}" occurred ${count} time(s) in recent runs`,
      action: runbookAction,
      runbookSection: "Troubleshooting",
    });
  }

  // ── 3. Promotion state ─────────────────────────────────
  if (promo.enabled === false) {
    actions.push({
      level: "info",
      category: "promotion",
      message: "Promotion is currently disabled",
      action: "Set enabled: true in promo.json when ready to activate promotion cycle",
    });
  }

  // Queued slugs with promo disabled → warning
  const queuedSlugs = promoQueue?.slugs || [];
  if (queuedSlugs.length > 0 && promo.enabled === false) {
    const slugNames = queuedSlugs.map((s) => (typeof s === "string" ? s : s.slug)).join(", ");
    actions.push({
      level: "warning",
      category: "promotion",
      message: `${queuedSlugs.length} slug(s) queued (${slugNames}) but promotion is disabled`,
      action: "Enable promotion in promo.json or clear the queue if promotion is not intended",
    });
  }

  // ── 4. Duration spikes ─────────────────────────────────
  if (recent.length >= 2) {
    const latest = recent[0];
    const others = recent.slice(1);
    const avgDuration = others.reduce((s, r) => s + (r.totalDurationMs || 0), 0) / others.length;

    if (avgDuration > 0 && (latest.totalDurationMs || 0) > 2 * avgDuration) {
      actions.push({
        level: "warning",
        category: "duration",
        message: `Latest run took ${Math.round((latest.totalDurationMs || 0) / 1000)}s — more than 2x the average (${Math.round(avgDuration / 1000)}s)`,
        action: "Review concurrency settings and name count; consider reducing if sustained",
        runbookSection: "Troubleshooting",
      });
    }
  }

  // ── 5. Worthy gaps ─────────────────────────────────────
  // Non-worthy repos in promo-queue → warning per slug
  if (queuedSlugs.length > 0) {
    for (const entry of queuedSlugs) {
      const slug = typeof entry === "string" ? entry : entry.slug;
      const repo = worthy.repos?.[slug];
      if (!repo || !repo.worthy) {
        actions.push({
          level: "warning",
          category: "worthy",
          message: `Queued slug "${slug}" is not marked as worthy`,
          action: "Assess the repo against the worthy rubric or remove from promotion queue",
        });
      }
    }
  }

  return actions;
}

/**
 * Build caps diff between current promo.json and latest ops-history snapshot.
 *
 * @param {object} promo - promo.json data
 * @param {Array} history - ops-history.json entries
 * @returns {object} Caps diff
 */
export function buildCapsDiff(promo, history) {
  const current = promo.caps || {};
  const latestRun = history.length > 0 ? history[0] : null;

  // If there's a snapshot in the latest run, compare
  const snapshot = latestRun?.capsSnapshot || {};

  return {
    maxNamesPerRun: {
      current: current.maxNamesPerRun ?? null,
      changed: snapshot.maxNamesPerRun !== undefined
        ? snapshot.maxNamesPerRun !== current.maxNamesPerRun
        : false,
    },
    failMode: {
      current: current.failMode ?? null,
      changed: snapshot.failMode !== undefined
        ? snapshot.failMode !== current.failMode
        : false,
    },
    promoEnabled: {
      current: promo.enabled ?? null,
      changed: snapshot.promoEnabled !== undefined
        ? snapshot.promoEnabled !== promo.enabled
        : false,
    },
  };
}

/**
 * Full pipeline: load all data, analyze, write ops-actions.json.
 *
 * @param {{ dataDir?: string, dryRun?: boolean }} opts
 * @returns {{ actions: Array, capsDiff: object }}
 */
export function generateActions(opts = {}) {
  const { dataDir = DATA_DIR, dryRun = false } = opts;

  const history = safeParseJson(join(dataDir, "ops-history.json"), []);
  const promo = safeParseJson(join(dataDir, "promo.json"), {});
  const promoQueue = safeParseJson(join(dataDir, "promo-queue.json"), { slugs: [] });
  const worthy = safeParseJson(join(dataDir, "worthy.json"), { repos: {} });

  const actions = analyzeOpsHistory(history, { promo, promoQueue, worthy });
  const capsDiff = buildCapsDiff(promo, history);

  const output = {
    generatedAt: new Date().toISOString(),
    actions,
    capsDiff,
  };

  if (dryRun) {
    console.log(`  [dry-run] Would write ${actions.length} action(s) to ops-actions.json`);
    console.log(`  [dry-run] Actions:`);
    for (const a of actions) {
      console.log(`    [${a.level}] ${a.category}: ${a.message}`);
    }
  } else {
    const outPath = join(dataDir, "ops-actions.json");
    writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(`  Wrote ${actions.length} action(s) to ops-actions.json`);
  }

  return output;
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-ops-actions.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating ops actions...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const result = generateActions({ dryRun });
  console.log(`  Total: ${result.actions.length} action(s)`);
}

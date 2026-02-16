#!/usr/bin/env node

/**
 * Baseline Generator
 *
 * Reads ops-history.json, computes statistics, projects costs.
 * Produces baseline.json for the dashboard and baseline.md for reference.
 *
 * Usage:
 *   node scripts/gen-baseline.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/ops-history.json
 *
 * Writes:
 *   site/src/data/baseline.json
 *   site/public/lab/baseline/baseline.md
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { getConfig, getRoot } from "./lib/config.mjs";

const ROOT = getRoot();
const config = getConfig();
const DATA_DIR = join(ROOT, config.paths.dataDir);
const PUBLIC_DIR = join(ROOT, config.paths.publicDir, "lab", "baseline");

// ── Cost constants ──────────────────────────────────────────

const LINUX_RUNNER_RATE = 0.006; // $/minute for ubuntu-latest

// ── Helpers ─────────────────────────────────────────────────

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// ── Minute Budgets ──────────────────────────────────────────

const BUDGET_TIERS = [200, 500, 1000];

/**
 * Compute minute-budget reality checks for each tier.
 *
 * @param {number} avgMinutesPerRun
 * @param {object} schedulePresets - { conservative, standard, aggressive }
 * @param {object} adapterStats - per-adapter stats
 * @returns {object} Keyed by tier (200, 500, 1000)
 */
export function computeMinuteBudgets(avgMinutesPerRun, schedulePresets, adapterStats) {
  const budgets = {};

  // Ordered from most aggressive to most conservative
  const presetOrder = [
    { name: "aggressive", preset: schedulePresets.aggressive },
    { name: "standard", preset: schedulePresets.standard },
    { name: "conservative", preset: schedulePresets.conservative },
  ];

  for (const tier of BUDGET_TIERS) {
    const maxRunsPerMonth = avgMinutesPerRun > 0 ? Math.floor(tier / avgMinutesPerRun) : 0;

    // Pick the most aggressive preset that fits with 20% headroom
    let recommendedPreset = "conservative";
    for (const { name, preset } of presetOrder) {
      if (preset.estimatedMinutes <= tier * 0.80) {
        recommendedPreset = name;
        break;
      }
    }

    const recommended = schedulePresets[recommendedPreset];
    const headroom = Math.round((tier - (recommended?.estimatedMinutes || 0)) * 10) / 10;

    const whatStops = [];
    if (schedulePresets.aggressive.estimatedMinutes > tier) {
      whatStops.push("Aggressive (2x-weekly) not viable");
    }
    if (schedulePresets.standard.estimatedMinutes > tier) {
      whatStops.push("Weekly schedule not viable \u2014 must run biweekly or less");
    }
    if (schedulePresets.conservative.estimatedMinutes > tier) {
      whatStops.push("Even biweekly exceeds budget \u2014 manual runs only");
    }

    // Flag uncached adapters
    for (const [ns, stats] of Object.entries(adapterStats || {})) {
      if (stats.hitRate === 0 && stats.avgCalls > 0) {
        whatStops.push(`Uncached adapter "${ns}" adds cost`);
      }
    }

    budgets[tier] = { maxRunsPerMonth, recommendedPreset, headroom, whatStops };
  }

  return budgets;
}

// ── Core ────────────────────────────────────────────────────

/**
 * Compute baseline statistics from ops history.
 *
 * @param {Array} history - ops-history.json entries (newest first)
 * @param {{ period?: string }} opts
 * @returns {object} Baseline object
 */
export function computeBaseline(history, opts = {}) {
  const { period = "weekly" } = opts;

  if (!history || history.length === 0) {
    return {
      runCount: 0,
      period: { start: null, end: null, cadence: period },
      avgRuntimeMs: 0,
      p95RuntimeMs: 0,
      stddevRuntimeMs: 0,
      confidenceLabel: "Low",
      avgCacheHitRate: 0,
      avgMinutesPerRun: 0,
      failureRate: 0,
      adapterStats: {},
      schedulePresets: {
        conservative: { cadence: "biweekly", monthlyRuns: 2, estimatedMinutes: 0, estimatedCost: 0 },
        standard: { cadence: "weekly", monthlyRuns: 4, estimatedMinutes: 0, estimatedCost: 0 },
        aggressive: { cadence: "2x-weekly", monthlyRuns: 8, estimatedMinutes: 0, estimatedCost: 0 },
      },
      projection: {
        monthlyRunCount: period === "weekly" ? 4 : 2,
        estimatedMinutes: 0,
        estimatedCost: 0,
        riskItems: ["No run data available — baseline cannot be computed"],
      },
      minuteBudgets: computeMinuteBudgets(0, {
        conservative: { cadence: "biweekly", monthlyRuns: 2, estimatedMinutes: 0, estimatedCost: 0 },
        standard: { cadence: "weekly", monthlyRuns: 4, estimatedMinutes: 0, estimatedCost: 0 },
        aggressive: { cadence: "2x-weekly", monthlyRuns: 8, estimatedMinutes: 0, estimatedCost: 0 },
      }, {}),
    };
  }

  const runCount = history.length;

  // Period
  const dates = history.map((r) => r.date).filter(Boolean).sort();
  const start = dates[0] || null;
  const end = dates[dates.length - 1] || null;

  // Duration stats
  const durations = history.map((r) => r.totalDurationMs || 0);
  const avgRuntimeMs = Math.round(durations.reduce((s, d) => s + d, 0) / runCount);

  // P95: sort ascending, pick index at ceil(0.95 * n) - 1
  const sorted = [...durations].sort((a, b) => a - b);
  const p95Idx = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
  const p95RuntimeMs = sorted[p95Idx];

  // Standard deviation
  const variance = durations.reduce((s, d) => s + Math.pow(d - avgRuntimeMs, 2), 0) / runCount;
  const stddevRuntimeMs = Math.round(Math.sqrt(variance));

  // Confidence label
  const confidenceLabel = runCount < 4 ? "Low" : runCount <= 12 ? "Medium" : "High";

  // Cache hit rate
  const cacheRates = history.map((r) => r.costStats?.cacheHitRate || 0);
  const avgCacheHitRate = Math.round(cacheRates.reduce((s, r) => s + r, 0) / runCount * 100) / 100;

  // Minutes per run
  const minutes = history.map((r) => r.minutesEstimate || Math.max(1, Math.ceil((r.totalDurationMs || 0) / 60000)));
  const avgMinutesPerRun = Math.round(minutes.reduce((s, m) => s + m, 0) / runCount * 10) / 10;

  // Failure rate
  const failures = history.filter((r) => !r.batchOk || (r.publishErrors || 0) > 0).length;
  const failureRate = Math.round(failures / runCount * 100) / 100;

  // Adapter stats (aggregated averages)
  const adapterAgg = {};
  for (const run of history) {
    if (!run.costStats?.adapterBreakdown) continue;
    for (const [ns, stats] of Object.entries(run.costStats.adapterBreakdown)) {
      if (!adapterAgg[ns]) adapterAgg[ns] = { totalCalls: 0, totalCached: 0, runCount: 0 };
      adapterAgg[ns].totalCalls += stats.calls || 0;
      adapterAgg[ns].totalCached += stats.cached || 0;
      adapterAgg[ns].runCount++;
    }
  }

  const adapterStats = {};
  for (const [ns, agg] of Object.entries(adapterAgg)) {
    adapterStats[ns] = {
      avgCalls: Math.round(agg.totalCalls / agg.runCount * 10) / 10,
      avgCached: Math.round(agg.totalCached / agg.runCount * 10) / 10,
      hitRate: agg.totalCalls > 0 ? Math.round(agg.totalCached / agg.totalCalls * 100) / 100 : 0,
    };
  }

  // Projection
  const monthlyRunCount = period === "weekly" ? 4 : 2;
  const estimatedMinutes = Math.round(avgMinutesPerRun * monthlyRunCount * 10) / 10;
  const estimatedCost = Math.round(estimatedMinutes * LINUX_RUNNER_RATE * 1000) / 1000;

  // Schedule presets
  const schedulePresets = {
    conservative: {
      cadence: "biweekly",
      monthlyRuns: 2,
      estimatedMinutes: Math.round(avgMinutesPerRun * 2 * 10) / 10,
      estimatedCost: Math.round(avgMinutesPerRun * 2 * LINUX_RUNNER_RATE * 1000) / 1000,
    },
    standard: {
      cadence: "weekly",
      monthlyRuns: 4,
      estimatedMinutes: Math.round(avgMinutesPerRun * 4 * 10) / 10,
      estimatedCost: Math.round(avgMinutesPerRun * 4 * LINUX_RUNNER_RATE * 1000) / 1000,
    },
    aggressive: {
      cadence: "2x-weekly",
      monthlyRuns: 8,
      estimatedMinutes: Math.round(avgMinutesPerRun * 8 * 10) / 10,
      estimatedCost: Math.round(avgMinutesPerRun * 8 * LINUX_RUNNER_RATE * 1000) / 1000,
    },
  };

  // Risk detection
  const riskItems = [];
  if (runCount < 4) {
    riskItems.push("Low run count \u2014 baseline may not be representative");
  }
  if (avgCacheHitRate < 0.50) {
    riskItems.push("Low cache efficiency \u2014 consider increasing maxAgeHours");
  }
  if (failureRate > 0.10) {
    riskItems.push("High failure rate \u2014 review error codes");
  }

  // Check for adapters with 0% cache
  for (const [ns, stats] of Object.entries(adapterStats)) {
    if (stats.hitRate === 0 && adapterAgg[ns].totalCalls > 0) {
      riskItems.push(`Adapter "${ns}" has no cache hits`);
    }
  }

  // Minute budgets
  const minuteBudgets = computeMinuteBudgets(avgMinutesPerRun, schedulePresets, adapterStats);

  return {
    runCount,
    period: { start, end, cadence: period },
    avgRuntimeMs,
    p95RuntimeMs,
    stddevRuntimeMs,
    confidenceLabel,
    avgCacheHitRate,
    avgMinutesPerRun,
    failureRate,
    adapterStats,
    schedulePresets,
    projection: {
      monthlyRunCount,
      estimatedMinutes,
      estimatedCost,
      riskItems,
    },
    minuteBudgets,
  };
}

/**
 * Generate baseline markdown summary.
 *
 * @param {object} baseline - Baseline object from computeBaseline
 * @returns {string} Markdown string
 */
export function generateBaselineMd(baseline) {
  const lines = [];
  lines.push("# NameOps Baseline Report");
  lines.push("");
  lines.push(`**Run count:** ${baseline.runCount}`);
  lines.push(`**Period:** ${baseline.period.start || "N/A"} \u2013 ${baseline.period.end || "N/A"} (${baseline.period.cadence})`);
  lines.push("");

  lines.push("## Performance");
  lines.push(`- Avg runtime: ${Math.round(baseline.avgRuntimeMs / 1000)}s`);
  lines.push(`- P95 runtime: ${Math.round(baseline.p95RuntimeMs / 1000)}s`);
  lines.push(`- Stddev runtime: ${Math.round((baseline.stddevRuntimeMs || 0) / 1000)}s`);
  lines.push(`- Confidence: ${baseline.confidenceLabel || "N/A"}`);
  lines.push(`- Avg cache hit rate: ${Math.round(baseline.avgCacheHitRate * 100)}%`);
  lines.push(`- Failure rate: ${Math.round(baseline.failureRate * 100)}%`);
  lines.push("");

  if (Object.keys(baseline.adapterStats).length > 0) {
    lines.push("## Adapter Performance");
    lines.push("| Adapter | Avg Calls | Avg Cached | Hit Rate |");
    lines.push("|---------|-----------|------------|----------|");
    for (const [ns, stats] of Object.entries(baseline.adapterStats)) {
      lines.push(`| ${ns} | ${stats.avgCalls} | ${stats.avgCached} | ${Math.round(stats.hitRate * 100)}% |`);
    }
    lines.push("");
  }

  lines.push("## Cost Projection (Monthly)");
  lines.push(`- Estimated runs: ${baseline.projection.monthlyRunCount}`);
  lines.push(`- Estimated minutes: ${baseline.projection.estimatedMinutes}`);
  lines.push(`- Estimated cost: $${baseline.projection.estimatedCost.toFixed(3)}`);
  lines.push(`- Rate: $${LINUX_RUNNER_RATE}/min (ubuntu-latest)`);
  lines.push("");

  if (baseline.projection.riskItems.length > 0) {
    lines.push("## Risks");
    for (const risk of baseline.projection.riskItems) {
      lines.push(`- \u26a0\ufe0f ${risk}`);
    }
    lines.push("");
  }

  // Minute budgets
  if (baseline.minuteBudgets) {
    lines.push("## Minutes Budget Reality Check");
    lines.push("| Budget (min/mo) | Max Runs | Recommended Preset | Headroom |");
    lines.push("|-----------------|----------|-------------------|----------|");
    for (const tier of [200, 500, 1000]) {
      const mb = baseline.minuteBudgets[tier];
      if (mb) {
        lines.push(`| ${tier} | ${mb.maxRunsPerMonth} | ${mb.recommendedPreset} | ${mb.headroom} min |`);
      }
    }
    lines.push("");

    // What stops section for tightest tier
    const tightest = baseline.minuteBudgets[200];
    if (tightest && tightest.whatStops.length > 0) {
      lines.push("## What Stops If Minutes Ran Out? (200 min budget)");
      for (const item of tightest.whatStops) {
        lines.push(`- \u26a0\ufe0f ${item}`);
      }
      lines.push("");
    }
  }

  lines.push(`*Generated: ${new Date().toISOString().slice(0, 10)}*`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Full pipeline: load data, compute baseline, write outputs.
 *
 * @param {{ dataDir?: string, publicDir?: string, dryRun?: boolean }} opts
 * @returns {object} Baseline object
 */
export function generateBaseline(opts = {}) {
  const { dataDir = DATA_DIR, publicDir = PUBLIC_DIR, dryRun = false } = opts;

  const rawHistory = safeParseJson(join(dataDir, "ops-history.json"), []);
  const history = Array.isArray(rawHistory) ? rawHistory : (rawHistory.runs || []);
  const baseline = computeBaseline(history);

  if (dryRun) {
    console.log(`  [dry-run] Would write baseline (${baseline.runCount} runs)`);
    console.log(`  [dry-run] Avg runtime: ${Math.round(baseline.avgRuntimeMs / 1000)}s`);
    console.log(`  [dry-run] Projected monthly cost: $${baseline.projection.estimatedCost.toFixed(3)}`);
    return baseline;
  }

  // Write baseline.json
  const jsonOut = {
    generatedAt: new Date().toISOString(),
    ...baseline,
  };
  writeFileSync(join(dataDir, "baseline.json"), JSON.stringify(jsonOut, null, 2) + "\n", "utf8");
  console.log(`  Wrote baseline.json (${baseline.runCount} runs)`);

  // Write baseline.md
  mkdirSync(publicDir, { recursive: true });
  const md = generateBaselineMd(baseline);
  writeFileSync(join(publicDir, "baseline.md"), md, "utf8");
  console.log(`  Wrote baseline.md`);

  return baseline;
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-baseline.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating baseline...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const baseline = generateBaseline({ dryRun });
  console.log(`  Runs: ${baseline.runCount}`);
  console.log(`  Risks: ${baseline.projection.riskItems.length}`);
}

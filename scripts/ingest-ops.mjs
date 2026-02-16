#!/usr/bin/env node

/**
 * Ingest ops metrics from a NameOps run into ops-history.json.
 *
 * Reads NameOps output metadata and batch results, builds a structured
 * ops record, and appends it to the rolling ops history.
 *
 * Usage:
 *   node scripts/ingest-ops.mjs <nameops-output-dir> [--commit-sha X] [--nameops-sha X] [--dry-run]
 *
 * Reads:
 *   <dir>/metadata.json
 *   <dir>/batch/<subdir>/batch/results.json  (for costStats, error codes)
 *
 * Writes:
 *   site/src/data/ops-history.json  (appends, caps at 30 entries)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

// ── Helpers ─────────────────────────────────────────────────

/**
 * Safely parse a JSON file. Returns fallback on error.
 */
function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * List subdirectories.
 */
function listSubdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

// ── Core ────────────────────────────────────────────────────

/**
 * Build an ops record from NameOps output.
 *
 * @param {string} outputDir - Path to nameops output directory
 * @param {{ commitSha?: string, nameopsCommitSha?: string }} ctx
 * @returns {object} Ops record
 */
export function buildOpsRecord(outputDir, ctx = {}) {
  const absDir = resolve(outputDir);

  // Load metadata
  const metadata = safeParseJson(join(absDir, "metadata.json"), {});

  // Derive runId from date
  const date = metadata.date || new Date().toISOString();
  const runId = `nameops-${date.slice(0, 10)}`;

  // Find batch results for costStats
  // If metadata has batchOutputDir, use it directly; otherwise scan for subdirs
  let batchOutputDir;
  if (metadata.batchOutputDir) {
    batchOutputDir = metadata.batchOutputDir;
  } else {
    const batchDir = join(absDir, "batch");
    const batchSubdirs = listSubdirs(batchDir);
    batchOutputDir = batchSubdirs.length > 0
      ? join(batchDir, batchSubdirs[batchSubdirs.length - 1])
      : batchDir;
  }
  const batchResultsPath = join(batchOutputDir, "batch", "results.json");
  const results = safeParseJson(batchResultsPath, []);

  // Aggregate adapter cost stats (same pattern as build-pr-body.mjs)
  const adapterBreakdown = {};
  for (const r of results) {
    if (!r.run?.checks) continue;
    for (const check of r.run.checks) {
      const ns = check.namespace || "unknown";
      if (!adapterBreakdown[ns]) adapterBreakdown[ns] = { calls: 0, cached: 0 };
      adapterBreakdown[ns].calls++;
      if (check.cacheHit) adapterBreakdown[ns].cached++;
    }
  }

  const totalApiCalls = Object.values(adapterBreakdown).reduce((s, v) => s + v.calls, 0);
  const cachedCalls = Object.values(adapterBreakdown).reduce((s, v) => s + v.cached, 0);
  const cacheHitRate = totalApiCalls > 0 ? Math.round((cachedCalls / totalApiCalls) * 100) / 100 : 0;

  // Extract error codes histogram
  const errorCodes = {};
  for (const r of results) {
    if (r.error) {
      // Try to extract a code prefix (e.g. "RATE_LIMIT", "TIMEOUT")
      const code = typeof r.error === "string"
        ? (r.error.match(/^([A-Z_]+)/)?.[1] || "UNKNOWN")
        : "UNKNOWN";
      errorCodes[code] = (errorCodes[code] || 0) + 1;
    }
  }

  const totalDurationMs = metadata.durationMs || 0;

  return {
    runId,
    date,
    commitSha: ctx.commitSha || "",
    nameopsCommitSha: ctx.nameopsCommitSha || "",
    totalDurationMs,
    totalDurationHuman: metadata.durationHuman || `${Math.round(totalDurationMs / 1000)}s`,
    slugCount: metadata.slugCount || 0,
    publishedCount: metadata.publishedCount || 0,
    publishErrors: metadata.publishErrors || 0,
    batchOk: metadata.batchOk !== false,
    validationOk: metadata.validationOk !== false,
    costStats: {
      totalApiCalls,
      cachedCalls,
      cacheHitRate,
      adapterBreakdown,
    },
    errorCodes,
    minutesEstimate: Math.max(1, Math.ceil(totalDurationMs / 60000)),
  };
}

/**
 * Append an ops record to ops-history.json, deduplicating by runId.
 *
 * @param {object} record - Ops record
 * @param {string} historyPath - Path to ops-history.json
 * @param {{ maxEntries?: number, dryRun?: boolean }} opts
 * @returns {{ appended: boolean, totalEntries: number }}
 */
export function appendOpsRecord(record, historyPath, opts = {}) {
  const { maxEntries = 30, dryRun = false } = opts;

  // Load existing history
  const history = safeParseJson(historyPath, []);

  // Dedup by runId — replace if exists
  const filtered = history.filter((r) => r.runId !== record.runId);

  // Prepend new record (newest first)
  filtered.unshift(record);

  // Cap at maxEntries
  const capped = filtered.slice(0, maxEntries);

  if (dryRun) {
    console.log(`  [dry-run] Would write ${capped.length} entries to ops-history.json`);
    console.log(`  [dry-run] New record: ${record.runId} (${record.totalDurationHuman}, ${record.slugCount} slugs)`);
    return { appended: true, totalEntries: capped.length };
  }

  writeFileSync(historyPath, JSON.stringify(capped, null, 2) + "\n", "utf8");
  return { appended: true, totalEntries: capped.length };
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("ingest-ops.mjs");

if (isMain) {
  const outputDir = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!outputDir) {
    console.error("Usage: node scripts/ingest-ops.mjs <nameops-output-dir> [--commit-sha X] [--nameops-sha X] [--dry-run]");
    process.exit(1);
  }

  // Parse optional SHA flags
  const commitShaIdx = process.argv.indexOf("--commit-sha");
  const commitSha = commitShaIdx !== -1 ? process.argv[commitShaIdx + 1] || "" : "";

  const nameopsIdx = process.argv.indexOf("--nameops-sha");
  const nameopsCommitSha = nameopsIdx !== -1 ? process.argv[nameopsIdx + 1] || "" : "";

  const absDir = resolve(outputDir);
  if (!existsSync(absDir)) {
    console.error(`Output directory not found: ${absDir}`);
    process.exit(1);
  }

  console.log("Ingesting ops metrics...");
  console.log(`  Source: ${absDir}`);
  if (dryRun) console.log("  Mode:   DRY RUN");

  const record = buildOpsRecord(absDir, { commitSha, nameopsCommitSha });
  console.log(`  Run ID: ${record.runId}`);
  console.log(`  Duration: ${record.totalDurationHuman}`);
  console.log(`  Slugs: ${record.slugCount}`);
  console.log(`  Cache hit rate: ${Math.round(record.costStats.cacheHitRate * 100)}%`);

  const historyPath = resolve("site/src/data/ops-history.json");
  const result = appendOpsRecord(record, historyPath, { dryRun });

  console.log(`  ✓ Ops history: ${result.totalEntries} entries`);
}

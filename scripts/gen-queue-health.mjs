#!/usr/bin/env node

/**
 * Queue Health Analyzer
 *
 * Analyzes submissions.json for queue health metrics:
 * time-in-status, stuck submissions, lint failure reasons, throughput.
 *
 * Usage:
 *   node scripts/gen-queue-health.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/submissions.json
 *   lint-reports/*.json (if present)
 *
 * Writes:
 *   site/src/data/queue-health.json
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { getConfig, getRoot } from "./lib/config.mjs";

const ROOT = getRoot();
const config = getConfig();

const STUCK_THRESHOLD_DAYS = 7;
const THROUGHPUT_WINDOW_DAYS = 30;

// ── Helpers ───────────────────────────────────────────────────

function daysBetween(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return Math.abs(b - a) / (1000 * 60 * 60 * 24);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ── Core analysis ─────────────────────────────────────────────

/**
 * Compute time-in-status for submissions that have updatedAt.
 * @param {object[]} submissions
 * @returns {Record<string, number|null>} status → median days
 */
export function computeTimeInStatus(submissions) {
  const durationsByStatus = {};

  for (const s of submissions) {
    if (!s.submittedAt) continue;
    const endDate = s.updatedAt || new Date().toISOString();
    const days = daysBetween(s.submittedAt, endDate);

    if (!durationsByStatus[s.status]) durationsByStatus[s.status] = [];
    durationsByStatus[s.status].push(Math.round(days * 10) / 10);
  }

  const result = {};
  for (const [status, durations] of Object.entries(durationsByStatus)) {
    result[status] = median(durations);
  }
  return result;
}

/**
 * Analyze queue health from submissions data.
 * @param {object[]} submissions
 * @param {{ lintReports?: Record<string, object>, now?: Date }} opts
 * @returns {object}
 */
export function analyzeQueueHealth(submissions, opts = {}) {
  const { lintReports = {}, now = new Date() } = opts;
  const nowIso = now.toISOString();

  if (!submissions || submissions.length === 0) {
    return {
      generatedAt: nowIso,
      submissions: 0,
      byStatus: {},
      stuckCount: 0,
      stuckSlugs: [],
      topLintFailures: [],
      medianDaysPending: null,
      throughput: 0,
    };
  }

  // Count by status
  const byStatus = {};
  for (const s of submissions) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  }

  // Stuck submissions (pending or needs-info > 7 days)
  const stuckSlugs = [];
  for (const s of submissions) {
    if (s.status === "pending" || s.status === "needs-info") {
      const days = daysBetween(s.submittedAt, nowIso);
      if (days > STUCK_THRESHOLD_DAYS) {
        stuckSlugs.push({ slug: s.slug, status: s.status, daysPending: Math.round(days) });
      }
    }
  }

  // Median days pending (for completed submissions: accepted or rejected)
  const completedDays = submissions
    .filter((s) => (s.status === "accepted" || s.status === "rejected") && s.updatedAt)
    .map((s) => daysBetween(s.submittedAt, s.updatedAt));
  const medianDaysPending = median(completedDays);

  // Throughput (accepted in trailing 30 days)
  const windowStart = new Date(now.getTime() - THROUGHPUT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const throughput = submissions.filter(
    (s) => s.status === "accepted" && s.updatedAt && new Date(s.updatedAt) >= windowStart,
  ).length;

  // Top lint failures from lint reports
  const failureCounts = {};
  for (const report of Object.values(lintReports)) {
    if (report.errors) {
      for (const err of report.errors) {
        failureCounts[err] = (failureCounts[err] || 0) + 1;
      }
    }
    if (report.warnings) {
      for (const warn of report.warnings) {
        failureCounts[warn] = (failureCounts[warn] || 0) + 1;
      }
    }
  }
  const topLintFailures = Object.entries(failureCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  return {
    generatedAt: nowIso,
    submissions: submissions.length,
    byStatus,
    stuckCount: stuckSlugs.length,
    stuckSlugs,
    topLintFailures,
    medianDaysPending: medianDaysPending !== null ? Math.round(medianDaysPending * 10) / 10 : null,
    throughput,
  };
}

// ── Pipeline ──────────────────────────────────────────────────

/**
 * Read submissions + lint reports, analyze, write output.
 * @param {{ submissionsPath?: string, lintDir?: string, outputPath?: string, dryRun?: boolean }} opts
 */
export function genQueueHealth(opts = {}) {
  const {
    submissionsPath = join(ROOT, config.paths.dataDir, "submissions.json"),
    lintDir = join(ROOT, "lint-reports"),
    outputPath = join(ROOT, config.paths.dataDir, "queue-health.json"),
    dryRun = false,
  } = opts;

  // Load submissions
  let submissions = [];
  try {
    const data = JSON.parse(readFileSync(submissionsPath, "utf8"));
    submissions = data.submissions || [];
  } catch {
    // no submissions file
  }

  // Load lint reports
  const lintReports = {};
  if (existsSync(lintDir)) {
    const files = readdirSync(lintDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const slug = file.replace(".json", "");
        lintReports[slug] = JSON.parse(readFileSync(join(lintDir, file), "utf8"));
      } catch {
        // skip malformed
      }
    }
  }

  const result = analyzeQueueHealth(submissions, { lintReports });

  if (dryRun) {
    console.log(`  [dry-run] Queue health analysis complete.`);
    console.log(`    Submissions: ${result.submissions}`);
    console.log(`    Stuck: ${result.stuckCount}`);
    console.log(`    Throughput (30d): ${result.throughput}`);
    return result;
  }

  writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  return result;
}

// ── Entry point ───────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("gen-queue-health.mjs");
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Analyzing queue health...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const result = genQueueHealth({ dryRun });
  if (!dryRun) {
    console.log(`  Submissions: ${result.submissions}`);
    console.log(`  By status: ${JSON.stringify(result.byStatus)}`);
    console.log(`  Stuck: ${result.stuckCount}`);
    console.log(`  Median days pending: ${result.medianDaysPending ?? "N/A"}`);
    console.log(`  Throughput (30d): ${result.throughput}`);
  }
}

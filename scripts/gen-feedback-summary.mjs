#!/usr/bin/env node

/**
 * Feedback Summary Generator
 *
 * Reads feedback.jsonl (append-only log), computes per-channel and per-slug
 * statistics, generates recommendations, writes feedback-summary.json.
 *
 * Usage:
 *   node scripts/gen-feedback-summary.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/feedback.jsonl
 *
 * Writes:
 *   site/src/data/feedback-summary.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// ── Helpers ─────────────────────────────────────────────────

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

const VALID_OUTCOMES = new Set(["sent", "opened", "replied", "ignored", "bounced"]);

function makeOutcomeCounter() {
  return { sent: 0, opened: 0, replied: 0, ignored: 0, bounced: 0 };
}

// ── Core ────────────────────────────────────────────────────

/**
 * Parse feedback lines from JSONL content.
 * Skips empty lines and malformed JSON. Trims whitespace.
 *
 * @param {string} content - raw JSONL text
 * @returns {Array<{ date: string, slug: string, channel: string, outcome: string, link?: string, notes?: string }>}
 */
export function parseFeedbackLines(content) {
  const lines = content.split("\n");
  const entries = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      console.warn(`Skipping malformed JSONL line: ${line.slice(0, 80)}`);
      continue;
    }

    if (!obj.date || !obj.slug || !obj.channel || !obj.outcome) {
      console.warn(`Skipping entry missing required fields: ${JSON.stringify(obj).slice(0, 80)}`);
      continue;
    }

    if (!VALID_OUTCOMES.has(obj.outcome)) {
      console.warn(`Skipping entry with invalid outcome "${obj.outcome}": ${JSON.stringify(obj).slice(0, 80)}`);
      continue;
    }

    entries.push(obj);
  }

  return entries;
}

/**
 * Compute summary statistics from parsed feedback entries.
 *
 * @param {Array<object>} entries
 * @returns {{
 *   totalEntries: number,
 *   perChannel: Record<string, { sent: number, opened: number, replied: number, ignored: number, bounced: number }>,
 *   perSlug: Record<string, { sent: number, opened: number, replied: number, ignored: number, bounced: number }>,
 *   recommendations: string[],
 *   bestPerformingChannel: string|null,
 *   replyRate: number
 * }}
 */
export function computeFeedbackSummary(entries) {
  const perChannel = {};
  const perSlug = {};
  const perExperiment = {};
  let totalReplied = 0;

  for (const entry of entries) {
    const { channel, slug, outcome } = entry;

    if (!perChannel[channel]) perChannel[channel] = makeOutcomeCounter();
    perChannel[channel][outcome]++;

    if (!perSlug[slug]) perSlug[slug] = makeOutcomeCounter();
    perSlug[slug][outcome]++;

    if (outcome === "replied") totalReplied++;

    // Experiment variant tracking
    if (entry.experimentId && entry.variantKey) {
      if (!perExperiment[entry.experimentId]) perExperiment[entry.experimentId] = {};
      if (!perExperiment[entry.experimentId][entry.variantKey]) {
        perExperiment[entry.experimentId][entry.variantKey] = makeOutcomeCounter();
      }
      perExperiment[entry.experimentId][entry.variantKey][outcome]++;
    }
  }

  const totalEntries = entries.length;
  const replyRate = totalEntries > 0 ? totalReplied / totalEntries : 0;

  // Find best performing channel by reply/sent ratio
  let bestPerformingChannel = null;
  let bestRatio = -1;

  for (const [channel, counts] of Object.entries(perChannel)) {
    if (counts.sent > 0) {
      const ratio = counts.replied / counts.sent;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestPerformingChannel = channel;
      }
    }
  }

  // Generate recommendations
  const recommendations = [];

  for (const [channel, counts] of Object.entries(perChannel)) {
    const total = counts.sent + counts.opened + counts.replied + counts.ignored + counts.bounced;
    if (total > 0) {
      if (counts.replied / total > 0.5) {
        recommendations.push(`${channel} performs well -- prioritize for future runs`);
      }
      if (counts.ignored / total > 0.7) {
        recommendations.push(`${channel} underperforming -- review approach or drop`);
      }
    }
  }

  for (const [slug, counts] of Object.entries(perSlug)) {
    const total = counts.sent + counts.opened + counts.replied + counts.ignored + counts.bounced;
    if (total > 0 && counts.replied === 0) {
      recommendations.push(`${slug} has no engagement -- review messaging`);
    }
  }

  // Experiment-specific recommendations
  for (const [expId, arms] of Object.entries(perExperiment)) {
    const controlCounts = arms["control"];
    const variantKeys = Object.keys(arms).filter((k) => k !== "control");

    for (const vk of variantKeys) {
      const variantCounts = arms[vk];
      const controlTotal = controlCounts
        ? controlCounts.sent + controlCounts.opened + controlCounts.replied + controlCounts.ignored + controlCounts.bounced
        : 0;
      const variantTotal = variantCounts.sent + variantCounts.opened + variantCounts.replied + variantCounts.ignored + variantCounts.bounced;

      // Insufficient data check
      if (controlTotal < 5 || variantTotal < 5) {
        recommendations.push(`${expId}: insufficient data (${controlTotal} control, ${variantTotal} variant entries)`);
        continue;
      }

      const controlReplyRate = controlCounts.replied / controlTotal;
      const variantReplyRate = variantCounts.replied / variantTotal;

      if (controlReplyRate > 0 && variantReplyRate / controlReplyRate > 2) {
        const ratio = Math.round(variantReplyRate / controlReplyRate * 10) / 10;
        recommendations.push(`${expId}: ${vk} outperforms control (${ratio}x reply rate)`);
      } else if (variantReplyRate > 0 && controlReplyRate / variantReplyRate > 2) {
        recommendations.push(`${expId}: control outperforms ${vk} -- consider concluding`);
      }
    }
  }

  return {
    totalEntries,
    perChannel,
    perSlug,
    recommendations,
    bestPerformingChannel,
    replyRate,
    perExperiment,
  };
}

/**
 * Full pipeline: read feedback.jsonl, compute summary, write feedback-summary.json.
 *
 * @param {{ dataDir?: string, dryRun?: boolean }} opts
 * @returns {object} Summary object
 */
export function generateFeedbackSummary(opts = {}) {
  const dataDir = opts.dataDir || join(ROOT, "site", "src", "data");
  const dryRun = opts.dryRun || false;

  const feedbackPath = join(dataDir, "feedback.jsonl");
  const summaryPath = join(dataDir, "feedback-summary.json");

  // Zero-state if file missing or empty
  if (!existsSync(feedbackPath)) {
    const zeroState = {
      generatedAt: new Date().toISOString(),
      totalEntries: 0,
      perChannel: {},
      perSlug: {},
      recommendations: [],
      bestPerformingChannel: null,
      replyRate: 0,
      perExperiment: {},
    };
    if (!dryRun) {
      writeFileSync(summaryPath, JSON.stringify(zeroState, null, 2) + "\n", "utf8");
    }
    return zeroState;
  }

  const content = readFileSync(feedbackPath, "utf8");
  if (!content.trim()) {
    const zeroState = {
      generatedAt: new Date().toISOString(),
      totalEntries: 0,
      perChannel: {},
      perSlug: {},
      recommendations: [],
      bestPerformingChannel: null,
      replyRate: 0,
      perExperiment: {},
    };
    if (!dryRun) {
      writeFileSync(summaryPath, JSON.stringify(zeroState, null, 2) + "\n", "utf8");
    }
    return zeroState;
  }

  const entries = parseFeedbackLines(content);
  const summary = computeFeedbackSummary(entries);

  const output = {
    generatedAt: new Date().toISOString(),
    ...summary,
  };

  if (!dryRun) {
    writeFileSync(summaryPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  }

  return output;
}

// ── Main ────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("gen-feedback-summary.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating feedback summary...");
  if (dryRun) console.log("  Mode: DRY RUN");
  const summary = generateFeedbackSummary({ dryRun });
  console.log(`  Entries: ${summary.totalEntries}`);
  console.log(`  Recommendations: ${summary.recommendations.length}`);
}

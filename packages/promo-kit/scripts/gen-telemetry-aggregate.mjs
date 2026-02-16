#!/usr/bin/env node

/**
 * Telemetry Aggregator
 *
 * Reads raw event JSONL files and produces aggregated rollup + daily JSON.
 *
 * Usage:
 *   node scripts/gen-telemetry-aggregate.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/telemetry/events/*.jsonl
 *
 * Writes:
 *   site/src/data/telemetry/rollup.json
 *   site/src/data/telemetry/daily/YYYY-MM-DD.json
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { getConfig, getRoot } from "./lib/config.mjs";

const ROOT = getRoot();
const config = getConfig();

// ── Valid event types ─────────────────────────────────────────

export const VALID_EVENT_TYPES = [
  "copy_proof_link", "copy_bundle", "copy_verify_cmd",
  "copy_install", "copy_proof_bullets", "copy_claim",
  "click_evidence_link", "click_receipt_link", "click_submit_link",
];

// ── Parsing ───────────────────────────────────────────────────

/**
 * Parse a JSONL string into an array of events.
 * Skips malformed lines silently.
 * @param {string} content
 * @returns {object[]}
 */
export function parseEventsFile(content) {
  if (!content || !content.trim()) return [];
  const events = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const evt = JSON.parse(trimmed);
      if (evt && evt.type && evt.timestamp) {
        events.push(evt);
      }
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

// ── Aggregation ───────────────────────────────────────────────

/**
 * Aggregate events into counts by type, slug, and week.
 * Includes anti-gaming guardrails: per-day caps and spike detection.
 * @param {object[]} events
 * @param {{ enableCaps?: boolean, dailyCapPerType?: number, spikeThreshold?: number }} opts
 * @returns {{ generatedAt: string, totalEvents: number, byType: object, bySlug: object, byWeek: object, metrics: object, guardrails: object }}
 */
export function aggregateEvents(events, opts = {}) {
  const { enableCaps = true, dailyCapPerType = 50, spikeThreshold = 300 } = opts;

  // Phase 1: Apply per-day caps
  const dailyTypeCounts = {};
  const cappedEvents = [];
  const guardrails = {
    totalEventsProcessed: events.length,
    eventsCapped: 0,
    suspiciousDays: [],
  };

  for (const evt of events) {
    if (!evt.timestamp || !evt.type) {
      cappedEvents.push(evt);
      continue;
    }

    const day = evt.timestamp.slice(0, 10);
    const key = `${day}:${evt.type}`;

    if (enableCaps) {
      const count = dailyTypeCounts[key] || 0;
      if (count >= dailyCapPerType) {
        guardrails.eventsCapped++;
        continue;
      }
      dailyTypeCounts[key] = count + 1;
    }

    cappedEvents.push(evt);
  }

  // Phase 2: Spike detection
  const dailyTotals = {};
  for (const evt of cappedEvents) {
    if (evt.timestamp) {
      const day = evt.timestamp.slice(0, 10);
      dailyTotals[day] = (dailyTotals[day] || 0) + 1;
    }
  }
  for (const [day, count] of Object.entries(dailyTotals)) {
    if (count > spikeThreshold) {
      guardrails.suspiciousDays.push({ day, count });
    }
  }

  // Phase 3: Standard aggregation on capped events
  const byType = {};
  const bySlug = {};
  const byWeek = {};

  for (const evt of cappedEvents) {
    // By type
    byType[evt.type] = (byType[evt.type] || 0) + 1;

    // By slug
    const slug = evt.payload?.slug;
    if (slug) {
      if (!bySlug[slug]) bySlug[slug] = {};
      bySlug[slug][evt.type] = (bySlug[slug][evt.type] || 0) + 1;
    }

    // By week
    const week = evt.payload?.week;
    if (week) {
      if (!byWeek[week]) byWeek[week] = {};
      byWeek[week][evt.type] = (byWeek[week][evt.type] || 0) + 1;
    }
  }

  const metrics = computeMetrics(byType, byWeek);

  return {
    generatedAt: new Date().toISOString(),
    totalEvents: cappedEvents.length,
    byType,
    bySlug,
    byWeek,
    metrics,
    guardrails,
  };
}

/**
 * Compute derived metrics from aggregated type counts.
 * @param {object} byType
 * @param {object} byWeek
 * @returns {object}
 */
export function computeMetrics(byType, byWeek = {}) {
  const copyProofLink = byType.copy_proof_link || 0;
  const copyBundle = byType.copy_bundle || 0;
  const copyVerifyCmd = byType.copy_verify_cmd || 0;
  const totalVerifyActions = copyProofLink + copyBundle + copyVerifyCmd;
  const verificationRate = totalVerifyActions > 0 ? copyBundle / totalVerifyActions : 0;

  const totalProofActions =
    (byType.copy_proof_bullets || 0) +
    (byType.copy_claim || 0) +
    (byType.click_evidence_link || 0);

  const submissionClicks = byType.click_submit_link || 0;

  // Trust Interaction Score per week
  const trustInteractionScoreByWeek = {};
  for (const [week, counts] of Object.entries(byWeek)) {
    trustInteractionScoreByWeek[week] =
      (counts.copy_bundle || 0) +
      (counts.copy_verify_cmd || 0) +
      (counts.click_receipt_link || 0);
  }

  return {
    verificationRate: Math.round(verificationRate * 10000) / 10000,
    totalVerifyActions,
    totalProofActions,
    submissionClicks,
    trustInteractionScoreByWeek,
  };
}

// ── Pipeline ──────────────────────────────────────────────────

/**
 * Read all JSONL event files, aggregate, write output.
 * @param {{ eventsDir?: string, outputPath?: string, dailyDir?: string, dryRun?: boolean }} opts
 */
export function genTelemetryAggregate(opts = {}) {
  const {
    eventsDir = join(ROOT, config.paths.dataDir, "telemetry", "events"),
    outputPath = join(ROOT, config.paths.dataDir, "telemetry", "rollup.json"),
    dailyDir = join(ROOT, config.paths.dataDir, "telemetry", "daily"),
    dryRun = false,
  } = opts;

  // Collect all events
  const allEvents = [];
  const eventsByDay = {};

  if (existsSync(eventsDir)) {
    const files = readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const content = readFileSync(join(eventsDir, file), "utf8");
      const events = parseEventsFile(content);
      allEvents.push(...events);
    }
  }

  // Group by day for daily rollups
  for (const evt of allEvents) {
    const day = evt.timestamp.slice(0, 10); // YYYY-MM-DD
    if (!eventsByDay[day]) eventsByDay[day] = [];
    eventsByDay[day].push(evt);
  }

  // Aggregate all
  const rollup = aggregateEvents(allEvents);

  if (dryRun) {
    console.log(`  [dry-run] Telemetry aggregation complete.`);
    console.log(`    Total events: ${allEvents.length}`);
    console.log(`    Days with data: ${Object.keys(eventsByDay).length}`);
    return { rollup, dailyCount: Object.keys(eventsByDay).length };
  }

  // Write rollup
  writeFileSync(outputPath, JSON.stringify(rollup, null, 2) + "\n", "utf8");

  // Write daily rollups
  mkdirSync(dailyDir, { recursive: true });
  for (const [day, events] of Object.entries(eventsByDay)) {
    const daily = aggregateEvents(events);
    writeFileSync(
      join(dailyDir, `${day}.json`),
      JSON.stringify(daily, null, 2) + "\n",
      "utf8",
    );
  }

  return { rollup, dailyCount: Object.keys(eventsByDay).length };
}

// ── Entry point ───────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("gen-telemetry-aggregate.mjs");
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Aggregating telemetry events...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const result = genTelemetryAggregate({ dryRun });
  if (!dryRun) {
    console.log(`  Total events: ${result.rollup.totalEvents}`);
    console.log(`  Daily rollups: ${result.dailyCount}`);
    console.log(`  Verification rate: ${(result.rollup.metrics.verificationRate * 100).toFixed(1)}%`);
  }
}

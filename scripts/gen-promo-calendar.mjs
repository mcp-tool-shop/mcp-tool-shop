#!/usr/bin/env node

/**
 * Promo Calendar Generator
 *
 * Reads promo-queue.json, promo.json, and ops-history.json to build
 * a calendar view showing freeze status, current queue, last run, and stats.
 *
 * Usage:
 *   node scripts/gen-promo-calendar.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/promo-queue.json
 *   site/src/data/promo.json
 *   site/src/data/ops-history.json
 *
 * Writes:
 *   site/src/data/promo-calendar.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");

// ── Default channels ────────────────────────────────────────

const DEFAULT_CHANNELS = ["presskit", "snippets", "campaigns"];

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
 * Build a promo calendar object from input data.
 *
 * @param {object} queue - promo-queue.json contents
 * @param {object} promo - promo.json contents
 * @param {Array} history - ops-history.json entries (newest first)
 * @returns {object} Calendar object
 */
export function buildCalendar(queue, promo, history) {
  // Freeze status
  const frozen = promo?.enabled === false || promo?.enabled === undefined;
  const freezeStatus = {
    frozen,
    since: promo?.lastModified || null,
    modifiedBy: promo?.modifiedBy || "unknown",
  };

  // Current week/queue
  const currentWeek = {
    week: queue?.week || null,
    slugs: queue?.slugs || [],
    promotionType: queue?.promotionType || "own",
    notes: queue?.notes || "",
    campaign: queue?.campaign || null,
  };

  // Last run from ops-history (first entry = newest)
  let lastRun = null;
  if (history && history.length > 0) {
    const latest = history[0];
    lastRun = {
      date: latest.date || null,
      runId: latest.runId || null,
      batchOk: latest.batchOk ?? null,
      slugCount: latest.slugCount || 0,
      cacheHitRate: latest.costStats?.cacheHitRate || 0,
    };
  }

  // Channel plan — extract from slug entries or use defaults
  let channelPlan = [...DEFAULT_CHANNELS];
  const slugEntries = currentWeek.slugs || [];
  const hasCustomChannels = slugEntries.some(
    (e) => typeof e === "object" && Array.isArray(e.channels)
  );
  if (hasCustomChannels) {
    const allChannels = new Set();
    for (const entry of slugEntries) {
      if (typeof entry === "object" && Array.isArray(entry.channels)) {
        entry.channels.forEach((c) => allChannels.add(c));
      } else {
        DEFAULT_CHANNELS.forEach((c) => allChannels.add(c));
      }
    }
    channelPlan = [...allChannels].sort();
  }

  // Stats
  const totalRuns = history ? history.length : 0;
  // Count promoted: runs where promo was enabled (heuristic: check if any slug was promoted)
  // For now, count runs that are batchOk and had slugs > 0
  const totalPromoted = history
    ? history.filter((r) => r.batchOk && (r.slugCount || 0) > 0).length
    : 0;

  // Last promotion date: most recent run with successful promotion
  const lastPromoRun = history
    ? history.find((r) => r.batchOk && (r.slugCount || 0) > 0)
    : null;
  const lastPromotionDate = lastPromoRun?.date || null;

  return {
    generatedAt: new Date().toISOString(),
    freezeStatus,
    currentWeek,
    lastRun,
    channelPlan,
    stats: {
      totalRuns,
      totalPromoted,
      lastPromotionDate,
    },
  };
}

/**
 * Full pipeline: load data, build calendar, write output.
 *
 * @param {{ dataDir?: string, dryRun?: boolean }} opts
 * @returns {object} Calendar object
 */
export function generateCalendar(opts = {}) {
  const { dataDir = DATA_DIR, dryRun = false } = opts;

  const queue = safeParseJson(join(dataDir, "promo-queue.json"), {});
  const promo = safeParseJson(join(dataDir, "promo.json"), {});
  const history = safeParseJson(join(dataDir, "ops-history.json"), []);

  const calendar = buildCalendar(queue, promo, history);

  if (dryRun) {
    console.log(`  [dry-run] Would write promo-calendar.json`);
    console.log(`  [dry-run] Freeze: ${calendar.freezeStatus.frozen ? "FROZEN" : "ACTIVE"}`);
    console.log(`  [dry-run] Week: ${calendar.currentWeek.week}`);
    console.log(`  [dry-run] Slugs queued: ${calendar.currentWeek.slugs.length}`);
    return calendar;
  }

  writeFileSync(
    join(dataDir, "promo-calendar.json"),
    JSON.stringify(calendar, null, 2) + "\n",
    "utf8"
  );
  console.log(`  Wrote promo-calendar.json (freeze=${calendar.freezeStatus.frozen})`);

  return calendar;
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-promo-calendar.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating promo calendar...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const calendar = generateCalendar({ dryRun });
  console.log(`  Freeze: ${calendar.freezeStatus.frozen ? "FROZEN" : "ACTIVE"}`);
  console.log(`  Total runs: ${calendar.stats.totalRuns}`);
}

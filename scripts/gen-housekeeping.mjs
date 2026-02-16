#!/usr/bin/env node

import { readdirSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUTREACH_DIR = join(ROOT, "site", "public", "outreach-run");

/**
 * Build a housekeeping plan (pure function, no side effects).
 * @param {{ dirs: string[], maxKeep?: number }} opts
 * @returns {{ toRemove: string[], keptCount: number, removedCount: number }}
 */
export function buildHousekeepingPlan(opts) {
  const { dirs, maxKeep = 12 } = opts;
  
  // Sort dirs by name ascending (date strings sort naturally, oldest first)
  const sorted = [...dirs].sort();
  
  if (sorted.length <= maxKeep) {
    return { toRemove: [], keptCount: sorted.length, removedCount: 0 };
  }
  
  // Remove oldest, keep most recent maxKeep
  const removeCount = sorted.length - maxKeep;
  const toRemove = sorted.slice(0, removeCount);
  return { toRemove, keptCount: maxKeep, removedCount: removeCount };
}

/**
 * Execute housekeeping.
 * @param {{ outreachDir?: string, maxKeep?: number, dryRun?: boolean }} opts
 */
export function executeHousekeeping(opts = {}) {
  const { outreachDir = OUTREACH_DIR, maxKeep = 12, dryRun = false } = opts;
  
  // List date directories
  let dirs = [];
  try {
    if (existsSync(outreachDir)) {
      dirs = readdirSync(outreachDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
        .map(e => e.name);
    }
  } catch { /* fail soft */ }
  
  const plan = buildHousekeepingPlan({ dirs, maxKeep });
  
  if (plan.removedCount === 0) {
    console.log(`  No cleanup needed (${plan.keptCount} dirs, max ${maxKeep}).`);
    return plan;
  }
  
  for (const dir of plan.toRemove) {
    const fullPath = join(outreachDir, dir);
    if (dryRun) {
      console.log(`  [dry-run] Would remove: ${fullPath}`);
    } else {
      rmSync(fullPath, { recursive: true, force: true });
      console.log(`  Removed: ${fullPath}`);
    }
  }
  
  console.log(`  Housekeeping: removed ${plan.removedCount}, kept ${plan.keptCount}.`);
  return plan;
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("gen-housekeeping.mjs");
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Running housekeeping...");
  if (dryRun) console.log("  Mode: DRY RUN");
  executeHousekeeping({ dryRun });
}

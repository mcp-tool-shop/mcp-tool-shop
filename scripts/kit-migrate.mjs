#!/usr/bin/env node

/**
 * Kit Migrate
 *
 * Reads kitVersion from kit.config.json and applies schema transforms
 * to bring data files up to the current version.
 *
 * v1 → v1 is a no-op (current).
 *
 * Usage:
 *   node scripts/kit-migrate.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { loadKitConfig, KIT_VERSION_SUPPORTED } from "./lib/config.mjs";

const SCRIPT_ROOT = resolve(import.meta.dirname, "..");

// ── Migration registry ──────────────────────────────────────

/**
 * Each migration transforms from version N to N+1.
 * Add entries here when kitVersion increments.
 * @type {Map<number, { label: string, migrate: (root: string, config: object) => void }>}
 */
const MIGRATIONS = new Map([
  // Example for future:
  // [2, {
  //   label: "v1 → v2: Add guardrails.maxRecommendations",
  //   migrate(root, config) {
  //     // transform data files for v2
  //   },
  // }],
]);

// ── Main ─────────────────────────────────────────────────────

export function migrate(root = SCRIPT_ROOT) {
  console.log("Kit Migrate");
  console.log("=".repeat(40));

  const config = loadKitConfig(root);
  const currentVersion = config.kitVersion;
  const targetVersion = KIT_VERSION_SUPPORTED[1];

  console.log(`  Current kitVersion: ${currentVersion}`);
  console.log(`  Target kitVersion:  ${targetVersion}`);
  console.log(`  Supported range:    [${KIT_VERSION_SUPPORTED.join(", ")}]`);

  // Validate range
  if (currentVersion < KIT_VERSION_SUPPORTED[0]) {
    console.error(`\n✗ kitVersion ${currentVersion} is below minimum supported (${KIT_VERSION_SUPPORTED[0]})`);
    console.error("  Manual migration required. See docs/portable-core.md.");
    return { success: false, from: currentVersion, to: targetVersion, migrationsApplied: 0 };
  }

  if (currentVersion > targetVersion) {
    console.error(`\n✗ kitVersion ${currentVersion} is above maximum supported (${targetVersion})`);
    console.error("  Update the kit code to a newer version.");
    return { success: false, from: currentVersion, to: targetVersion, migrationsApplied: 0 };
  }

  if (currentVersion === targetVersion) {
    console.log(`\n✓ Already up to date (v${currentVersion}).`);
    return { success: true, from: currentVersion, to: targetVersion, migrationsApplied: 0 };
  }

  // Apply sequential migrations
  let applied = 0;
  for (let v = currentVersion + 1; v <= targetVersion; v++) {
    const migration = MIGRATIONS.get(v);
    if (!migration) {
      console.error(`\n✗ No migration found for v${v - 1} → v${v}`);
      return { success: false, from: currentVersion, to: targetVersion, migrationsApplied: applied };
    }

    console.log(`\n  Applying: ${migration.label}`);
    try {
      migration.migrate(root, config);
      applied++;
      console.log(`  ✓ Done.`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      return { success: false, from: currentVersion, to: targetVersion, migrationsApplied: applied };
    }
  }

  // Update kitVersion in config file
  const configPath = join(root, "kit.config.json");
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  raw.kitVersion = targetVersion;
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n");

  console.log(`\n✓ Migrated from v${currentVersion} to v${targetVersion} (${applied} migration${applied !== 1 ? "s" : ""}).`);
  console.log("  Run: npm run kit:selftest");

  return { success: true, from: currentVersion, to: targetVersion, migrationsApplied: applied };
}

// ── CLI entry point ──────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const root = process.env.KIT_CONFIG
    ? dirname(resolve(process.env.KIT_CONFIG))
    : SCRIPT_ROOT;
  const result = migrate(root);
  process.exit(result.success ? 0 : 1);
}

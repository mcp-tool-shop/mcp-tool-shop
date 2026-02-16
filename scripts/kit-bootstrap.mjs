#!/usr/bin/env node

/**
 * Kit Bootstrap
 *
 * Validates the environment and creates zero-state seed files
 * required by the portable core. Idempotent — skips existing files.
 *
 * Usage:
 *   node scripts/kit-bootstrap.mjs
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { loadKitConfig, KIT_VERSION_SUPPORTED } from "./lib/config.mjs";

const SCRIPT_ROOT = resolve(import.meta.dirname, "..");

// ── Environment checks ──────────────────────────────────────

function checkEnvironment(root) {
  const errors = [];

  // Node 22+
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 22) {
    errors.push(`Node 22+ required (found ${process.versions.node})`);
  }

  // kit.config.json exists
  const configPath = join(root, "kit.config.json");
  if (!existsSync(configPath)) {
    errors.push(
      `kit.config.json not found at ${configPath}. ` +
      `Fix: create it or set KIT_CONFIG=/path/to/kit.config.json`
    );
  }

  return errors;
}

// ── Seed file definitions ───────────────────────────────────

function getSeedFiles(config, root) {
  const dataDir = join(root, config.paths.dataDir);
  const publicDir = join(root, config.paths.publicDir);

  return [
    // Human-owned governance
    {
      path: join(dataDir, "governance.json"),
      content: {
        schemaVersion: 2,
        decisionsFrozen: false,
        experimentsFrozen: false,
        maxPromosPerWeek: 3,
        cooldownDaysPerSlug: 14,
        cooldownDaysPerPartner: 14,
        minCoverageScore: 80,
        minExperimentDataThreshold: 10,
        hardRules: ["never push directly to main"],
      },
    },
    // Promo queue
    {
      path: join(dataDir, "promo-queue.json"),
      content: {
        week: new Date().toISOString().slice(0, 10),
        slugs: [],
        promotionType: "own",
        notes: "",
      },
    },
    // Experiments
    {
      path: join(dataDir, "experiments.json"),
      content: { schemaVersion: 1, experiments: [] },
    },
    // Submissions
    {
      path: join(dataDir, "submissions.json"),
      content: { schemaVersion: 1, submissions: [] },
    },
    // Overrides (empty object)
    {
      path: join(dataDir, "overrides.json"),
      content: {},
    },
    // Ops history
    {
      path: join(dataDir, "ops-history.json"),
      content: { schemaVersion: 1, runs: [] },
    },
    // Feedback (empty JSONL)
    {
      path: join(dataDir, "feedback.jsonl"),
      content: null, // empty file
    },
    // Worthy rubric
    {
      path: join(dataDir, "worthy.json"),
      content: {
        rubric: {
          criteria: [
            "README exists with purpose, install, quickstart",
            "Has at least one release or tag",
            "Tests exist and pass in CI",
            "License file present",
            "No critical security issues",
          ],
          minimumScore: 3,
        },
        scores: {},
      },
    },
    // Generated outputs (zero-state seeds)
    {
      path: join(dataDir, "promo-decisions.json"),
      content: { generatedAt: null, decisions: [] },
    },
    {
      path: join(dataDir, "experiment-decisions.json"),
      content: { generatedAt: null, decisions: [] },
    },
    {
      path: join(dataDir, "baseline.json"),
      content: { generatedAt: null, totalRuns: 0 },
    },
    {
      path: join(dataDir, "feedback-summary.json"),
      content: { generatedAt: null, channels: {}, slugs: {} },
    },
    {
      path: join(dataDir, "queue-health.json"),
      content: { generatedAt: null },
    },
    {
      path: join(dataDir, "recommendations.json"),
      content: { generatedAt: null, recommendations: [] },
    },
    {
      path: join(dataDir, "recommendation-patch.json"),
      content: { generatedAt: null, patches: [], advisoryNotes: [], riskNotes: [], frozenActions: [] },
    },
    {
      path: join(dataDir, "decision-drift.json"),
      content: {
        generatedAt: null,
        entrants: [],
        exits: [],
        scoreDeltas: [],
        reasonChanges: [],
        summary: { totalChanged: 0, newEntrants: 0, exits: 0, scoreChanges: 0, actionOnlyChanges: 0 },
      },
    },
    // Telemetry directories
    {
      path: join(dataDir, "telemetry", "rollup.json"),
      content: { generatedAt: null, eventCounts: {}, dailySummaries: [] },
    },
  ];
}

// ── Main ─────────────────────────────────────────────────────

export function bootstrap(root = SCRIPT_ROOT) {
  console.log("Kit Bootstrap");
  console.log("=".repeat(40));

  // 1. Environment check
  const envErrors = checkEnvironment(root);
  if (envErrors.length > 0) {
    console.error("\nEnvironment errors:");
    envErrors.forEach((e) => console.error(`  ✗ ${e}`));
    return { success: false, errors: envErrors, created: [], skipped: [] };
  }
  console.log("✓ Environment OK");

  // 2. Load config
  const config = loadKitConfig(root);
  const v = config.kitVersion;
  if (v < KIT_VERSION_SUPPORTED[0] || v > KIT_VERSION_SUPPORTED[1]) {
    const msg = `kitVersion ${v} not in supported range [${KIT_VERSION_SUPPORTED.join(", ")}]`;
    console.error(`  ✗ ${msg}`);
    return { success: false, errors: [msg], created: [], skipped: [] };
  }
  console.log(`✓ Config loaded (kitVersion: ${v})`);

  // 3. Create seed files
  const seeds = getSeedFiles(config, root);
  const created = [];
  const skipped = [];

  for (const seed of seeds) {
    if (existsSync(seed.path)) {
      skipped.push(seed.path);
      continue;
    }

    // Ensure parent directory exists
    mkdirSync(dirname(seed.path), { recursive: true });

    if (seed.content === null) {
      writeFileSync(seed.path, "");
    } else {
      writeFileSync(seed.path, JSON.stringify(seed.content, null, 2) + "\n");
    }
    created.push(seed.path);
  }

  // Ensure telemetry events dir exists
  const eventsDir = join(root, config.paths.dataDir, "telemetry", "events");
  if (!existsSync(eventsDir)) {
    mkdirSync(eventsDir, { recursive: true });
    created.push(eventsDir);
  }

  // Ensure telemetry daily dir exists
  const dailyDir = join(root, config.paths.dataDir, "telemetry", "daily");
  if (!existsSync(dailyDir)) {
    mkdirSync(dailyDir, { recursive: true });
    created.push(dailyDir);
  }

  console.log(`\n✓ Created: ${created.length} files/dirs`);
  created.forEach((f) => console.log(`  + ${f.replace(root, ".")}`));
  console.log(`✓ Skipped: ${skipped.length} (already exist)`);

  console.log("\nNext steps:");
  console.log("  1. Edit kit.config.json with your org details");
  console.log("  2. Run: npm run kit:selftest");
  console.log("  3. Commit and push");

  return { success: true, errors: [], created, skipped };
}

// ── CLI entry point ──────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const root = process.env.KIT_CONFIG
    ? dirname(resolve(process.env.KIT_CONFIG))
    : SCRIPT_ROOT;
  const result = bootstrap(root);
  process.exit(result.success ? 0 : 1);
}

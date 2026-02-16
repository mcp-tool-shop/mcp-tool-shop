#!/usr/bin/env node

/**
 * Kit Self-Test
 *
 * Validates the kit installation: config, seeds, invariants, dry-runs, build.
 *
 * Usage:
 *   node scripts/kit-selftest.mjs [--skip-build] [--skip-invariants]
 *
 * Environment:
 *   KIT_CONFIG=/path/to/kit.config.json — point at an alternate config root
 */

import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { loadKitConfig, KIT_VERSION_SUPPORTED } from "./lib/config.mjs";

const SCRIPT_ROOT = resolve(import.meta.dirname, ".."); // where scripts live
const DATA_ROOT = process.env.KIT_CONFIG
  ? dirname(resolve(process.env.KIT_CONFIG))
  : SCRIPT_ROOT;

const skipBuild = process.argv.includes("--skip-build");
const skipInvariants = process.argv.includes("--skip-invariants");

// ── Test runner ──────────────────────────────────────────────

const results = [];

function check(label, fn) {
  try {
    fn();
    results.push({ label, pass: true });
    console.log(`  ✓ ${label}`);
  } catch (err) {
    results.push({ label, pass: false, error: err.message });
    console.log(`  ✗ ${label}: ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Tests ────────────────────────────────────────────────────

console.log("Kit Self-Test");
console.log("=".repeat(40));
if (DATA_ROOT !== SCRIPT_ROOT) {
  console.log(`  Config root: ${DATA_ROOT}`);
  console.log(`  Script root: ${SCRIPT_ROOT}`);
}

// 1. Config
console.log("\n[Config]");

check("kit.config.json exists", () => {
  const configPath = join(DATA_ROOT, "kit.config.json");
  assert(
    existsSync(configPath),
    `kit.config.json not found at ${configPath}. Fix: create it or set KIT_CONFIG=/path/to/kit.config.json`
  );
});

let config;
check("kit.config.json is valid JSON with required fields", () => {
  config = loadKitConfig(DATA_ROOT);
  assert(config.kitVersion, "kitVersion missing");
  assert(config.org?.name || config.org?.account, "org name or account missing");
  assert(config.site?.title, "site.title missing");
  assert(config.paths?.dataDir, "paths.dataDir missing");
  assert(config.paths?.publicDir, "paths.publicDir missing");
});

// Warn about unknown keys in paths (common misconfiguration)
check("no unknown keys in paths", () => {
  const knownPathKeys = new Set(["dataDir", "publicDir"]);
  const unknownKeys = Object.keys(config.paths || {}).filter((k) => !knownPathKeys.has(k));
  if (unknownKeys.length > 0) {
    const hints = unknownKeys.map((k) => {
      if (k === "data") return `"paths.data" → did you mean "paths.dataDir"?`;
      if (k === "public") return `"paths.public" → did you mean "paths.publicDir"?`;
      return `"paths.${k}" is not a recognized field`;
    });
    throw new Error(`Unknown paths keys: ${hints.join("; ")}`);
  }
});

check("kitVersion in supported range", () => {
  const v = config.kitVersion;
  assert(
    v >= KIT_VERSION_SUPPORTED[0] && v <= KIT_VERSION_SUPPORTED[1],
    `kitVersion ${v} not in [${KIT_VERSION_SUPPORTED.join(", ")}]`
  );
});

// 2. Seed files
console.log("\n[Seed Files]");

const coreSeedFiles = [
  "governance.json",
  "promo-queue.json",
  "experiments.json",
  "submissions.json",
  "overrides.json",
  "ops-history.json",
  "worthy.json",
  "promo-decisions.json",
  "experiment-decisions.json",
  "baseline.json",
  "feedback-summary.json",
  "queue-health.json",
  "recommendations.json",
  "recommendation-patch.json",
  "decision-drift.json",
];

for (const file of coreSeedFiles) {
  check(`${file} exists`, () => {
    const fullPath = join(DATA_ROOT, config.paths.dataDir, file);
    assert(existsSync(fullPath), `Missing: ${fullPath}. Fix: run npm run kit:init`);
  });
}

// 3. Invariant tests
if (!skipInvariants) {
  console.log("\n[Invariant Tests]");

  check("invariant tests pass", () => {
    try {
      execSync("node --test tests/invariants/*.test.mjs", {
        cwd: SCRIPT_ROOT,
        stdio: "pipe",
        timeout: 60000,
        env: { ...process.env },
      });
    } catch (err) {
      throw new Error(`Invariant tests failed: ${err.stderr?.toString().slice(-200) || err.message}`);
    }
  });
} else {
  console.log("\n[Invariant Tests] Skipped (--skip-invariants)");
}

// 4. Core dry-runs
console.log("\n[Core Dry-Runs]");

const dryRunScripts = [
  "scripts/gen-promo-decisions.mjs",
  "scripts/gen-experiment-decisions.mjs",
  "scripts/gen-baseline.mjs",
  "scripts/gen-feedback-summary.mjs",
  "scripts/gen-queue-health.mjs",
  "scripts/gen-telemetry-aggregate.mjs",
  "scripts/gen-recommendations.mjs",
  "scripts/gen-recommendation-patch.mjs",
  "scripts/gen-decision-drift.mjs",
  "scripts/gen-trust-receipt.mjs",
];

for (const script of dryRunScripts) {
  const name = script.split("/").pop();
  check(`${name} --dry-run`, () => {
    try {
      execSync(`node ${script} --dry-run`, {
        cwd: SCRIPT_ROOT,
        stdio: "pipe",
        timeout: 30000,
        env: { ...process.env },
      });
    } catch (err) {
      throw new Error(
        `${name} failed. Fix: ensure kit:init has been run and data files exist. ` +
        (err.stderr?.toString().slice(-200) || err.message)
      );
    }
  });
}

// 5. Site build (optional)
if (!skipBuild) {
  console.log("\n[Site Build]");

  check("Astro build succeeds", () => {
    try {
      execSync("npm run build", {
        cwd: join(SCRIPT_ROOT, "site"),
        stdio: "pipe",
        timeout: 120000,
      });
    } catch (err) {
      throw new Error(err.stderr?.toString().slice(-300) || err.message);
    }
  });
} else {
  console.log("\n[Site Build] Skipped (--skip-build)");
}

// ── Summary ──────────────────────────────────────────────────

console.log("\n" + "=".repeat(40));
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);

if (failed > 0) {
  console.log("\nFailed checks:");
  results.filter((r) => !r.pass).forEach((r) => {
    console.log(`  ✗ ${r.label}: ${r.error}`);
  });
  process.exit(1);
} else {
  console.log("\n✓ All checks passed.");
  process.exit(0);
}

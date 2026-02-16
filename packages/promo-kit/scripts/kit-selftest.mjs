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

// Auto-skip when running from npm package (dirs don't exist)
const autoSkipInvariants = !existsSync(join(SCRIPT_ROOT, "tests", "invariants"));
const autoSkipBuild = !existsSync(join(SCRIPT_ROOT, "site"));

const skipBuild = process.argv.includes("--skip-build") || autoSkipBuild;
const skipInvariants = process.argv.includes("--skip-invariants") || autoSkipInvariants;

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
  const configPath = join(DATA_ROOT, "kit.config.json");
  config = loadKitConfig(DATA_ROOT);

  const required = [
    ["kitVersion", config.kitVersion],
    ["org.name or org.account", config.org?.name || config.org?.account],
    ["site.title", config.site?.title],
    ["contact.email", config.contact?.email],
    ["paths.dataDir", config.paths?.dataDir],
    ["paths.publicDir", config.paths?.publicDir],
  ];

  const missing = required.filter(([, value]) => !value).map(([field]) => field);
  if (missing.length > 0) {
    const checklist = missing.map((f) => `  □ ${f}`).join("\n");
    throw new Error(
      `Missing required fields in ${configPath}:\n${checklist}\n  Fix: edit kit.config.json — see https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/quickstart.md#configure`
    );
  }
});

// Warn about unknown/typo keys (common misconfiguration)
check("no unknown config keys", () => {
  const typoMap = {
    // paths typos
    "paths.data": "paths.dataDir",
    "paths.public": "paths.publicDir",
    "paths.dataDirr": "paths.dataDir",
    "paths.publicdir": "paths.publicDir",
    "paths.datadir": "paths.dataDir",
    // org typos
    "org.handle": "org.account",
    "org.username": "org.account",
    "org.github": "org.account",
    "org.orgName": "org.name",
    // contact typos
    "contact.mail": "contact.email",
  };

  const knownKeys = {
    _top: new Set(["kitVersion", "org", "site", "repo", "contact", "paths", "guardrails"]),
    paths: new Set(["dataDir", "publicDir"]),
    org: new Set(["name", "account", "url"]),
    site: new Set(["title", "url", "description"]),
    repo: new Set(["marketing"]),
    contact: new Set(["email"]),
    guardrails: new Set(["maxDataPatchesPerRun", "dailyTelemetryCapPerType", "spikeThreshold", "maxRecommendations"]),
  };

  const issues = [];

  // Check top-level keys
  for (const key of Object.keys(config)) {
    if (!knownKeys._top.has(key)) {
      issues.push(`"${key}" is not a recognized top-level field`);
    }
  }

  // Check sub-keys in each known section
  for (const [section, allowed] of Object.entries(knownKeys)) {
    if (section === "_top") continue;
    const obj = config[section];
    if (!obj || typeof obj !== "object") continue;
    for (const key of Object.keys(obj)) {
      if (!allowed.has(key)) {
        const fullKey = `${section}.${key}`;
        const suggestion = typoMap[fullKey];
        if (suggestion) {
          issues.push(`"${fullKey}" → did you mean "${suggestion}"?`);
        } else {
          issues.push(`"${fullKey}" is not a recognized field`);
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(`Config issues: ${issues.join("; ")}`);
  }
});

check("kitVersion in supported range", () => {
  const v = config.kitVersion;
  assert(
    v >= KIT_VERSION_SUPPORTED[0] && v <= KIT_VERSION_SUPPORTED[1],
    `kitVersion ${v} not in [${KIT_VERSION_SUPPORTED.join(", ")}]`
  );
});

// 1b. Path existence
check("data directory exists", () => {
  const dataDir = resolve(DATA_ROOT, config.paths.dataDir);
  assert(
    existsSync(dataDir),
    `Data directory not found: ${dataDir}\n  Fix: run "promo-kit init" to create it, or check paths.dataDir in kit.config.json`
  );
});

// 1c. Git repo check (warn, don't fail)
{
  let hasGit = false;
  try {
    execSync("git rev-parse --short HEAD", { cwd: DATA_ROOT, stdio: "pipe", encoding: "utf8" });
    hasGit = true;
  } catch { /* not a git repo or no commits */ }
  check("git repo detected (for trust receipts)", () => {
    if (!hasGit) {
      console.log(`  ⚠ Not a git repo or no commits — trust receipts will have commit: null`);
      console.log(`    Fix: git init && git add -A && git commit -m "initial"`);
    }
  });
}

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

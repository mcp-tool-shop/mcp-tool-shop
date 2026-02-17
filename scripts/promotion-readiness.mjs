#!/usr/bin/env node

/**
 * Weekly Promotion Readiness Check
 *
 * Automates the verifiable parts of docs/weekly-promotion-checklist.md.
 * Run every Monday (or before any promotion post).
 *
 * Usage: node scripts/promotion-readiness.mjs
 *        node scripts/promotion-readiness.mjs --json      (machine-readable output)
 *        node scripts/promotion-readiness.mjs --receipt    (write readiness receipt)
 *
 * Exit codes: 0 = GO, 1 = NO-GO (blocking failures exist)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "site", "src", "data");
const PUBLIC = join(ROOT, "site", "public");
const PKG_DIR = join(ROOT, "packages", "promo-kit");
const jsonOutput = process.argv.includes("--json");
const emitReceipt = process.argv.includes("--receipt");

// ── Helpers ──────────────────────────────────────────────────

function loadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

function getWeek() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - jan1) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Severity classification ──────────────────────────────────
//
// FAIL (blocking): missing trust.json, broken npm package, selftest fails,
//                  missing governance, missing critical data files
// WARN (non-blocking): missing optional pages, cosmetic README items,
//                      stale timestamps, missing OG images, freeze enabled

let passCount = 0;
let failCount = 0;
let warnCount = 0;
const results = [];

function pass(section, check) {
  passCount++;
  results.push({ section, check, status: "pass" });
  if (!jsonOutput) console.log(`  ✓ ${check}`);
}

function fail(section, check, reason) {
  failCount++;
  results.push({ section, check, status: "fail", reason, severity: "blocking" });
  if (!jsonOutput) console.log(`  ✗ ${check} — ${reason}`);
}

function warn(section, check, reason) {
  warnCount++;
  results.push({ section, check, status: "warn", reason, severity: "non-blocking" });
  if (!jsonOutput) console.log(`  ⚠ ${check} — ${reason}`);
}

function section(name) {
  if (!jsonOutput) console.log(`\n[${name}]`);
}

// ── A) Site data artifacts ───────────────────────────────────

section("A: Site Data");

const trustReceipt = loadJson(join(PUBLIC, "trust.json"));
if (trustReceipt) {
  pass("A", "trust.json exists");

  if (trustReceipt.commit && trustReceipt.commit !== "unknown") {
    pass("A", `trust.json has commit SHA: ${trustReceipt.commit}`);
  } else if (trustReceipt.commit === null && trustReceipt.warning) {
    warn("A", "trust.json commit is null", trustReceipt.warning);
  } else {
    fail("A", "trust.json commit SHA", "missing or unknown");
  }

  const manifestCount = Object.keys(trustReceipt.artifactManifest || {}).length;
  if (manifestCount > 0) {
    pass("A", `trust.json has ${manifestCount} artifact hashes`);
  } else {
    fail("A", "trust.json artifact hashes", "manifest is empty");
  }

  if (trustReceipt.provenClaims > 0) {
    pass("A", `trust.json provenClaims: ${trustReceipt.provenClaims}`);
  } else {
    warn("A", "trust.json provenClaims is 0", "expected non-zero when tools are promoted");
  }

  // Check freshness (warn if older than 14 days)
  if (trustReceipt.generatedAt) {
    const age = Date.now() - new Date(trustReceipt.generatedAt).getTime();
    const days = Math.floor(age / (1000 * 60 * 60 * 24));
    if (days <= 14) {
      pass("A", `trust.json is ${days} day(s) old`);
    } else {
      warn("A", `trust.json is ${days} days old`, "consider regenerating");
    }
  }
} else {
  fail("A", "trust.json exists", "file not found at site/public/trust.json");
}

// Trust path pages (check dist if built, otherwise check source)
const trustPage = existsSync(join(ROOT, "site", "src", "pages", "trust.astro"));
if (trustPage) {
  pass("A", "trust.astro page source exists");
} else {
  fail("A", "trust page source", "site/src/pages/trust.astro not found");
}

const receiptsPage = existsSync(join(ROOT, "site", "src", "pages", "receipts.astro"))
  || existsSync(join(ROOT, "site", "src", "pages", "receipts", "index.astro"));
if (receiptsPage) {
  pass("A", "receipts page source exists");
} else {
  warn("A", "receipts page source", "site/src/pages/receipts{.astro,/index.astro} not found");
}

// ── B) Automation readiness ──────────────────────────────────

section("B: Automation");

const governance = loadJson(join(DATA, "governance.json"));
if (governance) {
  pass("B", "governance.json exists");

  if (typeof governance.schemaVersion === "number" && governance.schemaVersion >= 1) {
    pass("B", `governance schemaVersion: ${governance.schemaVersion}`);
  } else {
    fail("B", "governance schemaVersion", "missing or < 1");
  }

  // Freeze check — warn (non-blocking), not fail
  if (governance.decisionsFrozen === false) {
    pass("B", "decisionsFrozen: false (not frozen)");
  } else if (governance.decisionsFrozen === true) {
    warn("B", "decisionsFrozen: true", "decisions are frozen — intentional?");
  }

  if (governance.experimentsFrozen === false) {
    pass("B", "experimentsFrozen: false (not frozen)");
  } else if (governance.experimentsFrozen === true) {
    warn("B", "experimentsFrozen: true", "experiments are frozen — intentional?");
  }
} else {
  fail("B", "governance.json exists", "file not found");
}

// Drift + recommendations
const drift = loadJson(join(DATA, "decision-drift.json"));
if (drift && Array.isArray(drift.entrants)) {
  pass("B", "decision-drift.json exists and schema-valid");
} else {
  fail("B", "decision-drift.json", "missing or invalid schema");
}

const recs = loadJson(join(DATA, "recommendations.json"));
if (recs && Array.isArray(recs.recommendations)) {
  pass("B", "recommendations.json exists");
} else {
  fail("B", "recommendations.json", "missing or invalid");
}

const recPatch = loadJson(join(DATA, "recommendation-patch.json"));
if (recPatch && Array.isArray(recPatch.patches)) {
  pass("B", "recommendation-patch.json exists");
} else {
  fail("B", "recommendation-patch.json", "missing or invalid");
}

// ── C) npm package completeness ──────────────────────────────

section("C: npm Package");

const pkgJson = loadJson(join(PKG_DIR, "package.json"));
if (pkgJson) {
  pass("C", `package.json exists: ${pkgJson.name}@${pkgJson.version}`);

  if (pkgJson.license === "MIT") {
    pass("C", "license: MIT");
  } else {
    fail("C", "license", `expected MIT, got: ${pkgJson.license}`);
  }

  if (pkgJson.engines?.node) {
    pass("C", `engines.node: ${pkgJson.engines.node}`);
  } else {
    fail("C", "engines.node", "missing node engine requirement");
  }

  if (pkgJson.repository?.url) {
    pass("C", "repository URL present");
  } else {
    fail("C", "repository URL", "missing");
  }

  if (pkgJson.homepage) {
    pass("C", "homepage present");
  } else {
    warn("C", "homepage", "missing");
  }
} else {
  fail("C", "package.json exists", "not found at packages/promo-kit/package.json");
}

// README + LICENSE
if (existsSync(join(PKG_DIR, "README.md"))) {
  const readme = readFileSync(join(PKG_DIR, "README.md"), "utf8");
  pass("C", "README.md exists");

  // Check for badges
  if (readme.includes("shields.io") || readme.includes("img.shields.io")) {
    pass("C", "README has badge images");
  } else {
    warn("C", "README badges", "no shields.io badges found");
  }

  // Check for logo
  if (readme.includes("logo") || readme.includes("Logo") || readme.includes(".png")) {
    pass("C", "README has logo reference");
  } else {
    warn("C", "README logo", "no logo image found");
  }
} else {
  fail("C", "README.md exists", "not found");
}

if (existsSync(join(PKG_DIR, "LICENSE"))) {
  pass("C", "LICENSE exists");
} else {
  fail("C", "LICENSE exists", "not found");
}

if (existsSync(join(PKG_DIR, "CHANGELOG.md"))) {
  pass("C", "CHANGELOG.md exists");
} else {
  warn("C", "CHANGELOG.md", "not found");
}

// Golden path: dry-run selftest
try {
  execSync("node scripts/kit-selftest.mjs --skip-build --skip-invariants", {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30000,
    stdio: "pipe",
  });
  pass("C", "kit-selftest passes (skip-build, skip-invariants)");
} catch (e) {
  fail("C", "kit-selftest", e.stderr?.split("\n")[0] || "failed");
}

// ── D) Proof artifacts ───────────────────────────────────────

section("D: Proof Artifacts");

if (existsSync(join(ROOT, "docs", "examples", "trust-receipt.json"))) {
  pass("D", "example trust-receipt.json exists");
} else {
  fail("D", "example trust-receipt.json", "not found in docs/examples/");
}

if (existsSync(join(ROOT, "docs", "examples", "decision-drift.json"))) {
  pass("D", "example decision-drift.json exists");
} else {
  fail("D", "example decision-drift.json", "not found in docs/examples/");
}

if (existsSync(join(ROOT, "docs", "examples", "recommendations.json"))) {
  pass("D", "example recommendations.json exists");
} else {
  fail("D", "example recommendations.json", "not found in docs/examples/");
}

// Check for recent PRs (best-effort via git log)
try {
  const recentCommits = execSync("git log --oneline -10", {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 5000,
  });
  if (recentCommits.includes("dogfood") || recentCommits.includes("weekly")) {
    pass("D", "recent dogfood/weekly commit found in git log");
  } else {
    warn("D", "dogfood commit", "no recent dogfood/weekly commit in last 10 commits");
  }
} catch {
  warn("D", "git log", "could not read git log");
}

// ── E) Images & media ────────────────────────────────────────

section("E: Images & Media");

if (existsSync(join(ROOT, "logo.png")) || existsSync(join(ROOT, "site", "public", "logo.png"))) {
  pass("E", "logo.png exists");
} else {
  warn("E", "logo.png", "not found in repo root or site/public/");
}

// Check screenshot directory exists
if (existsSync(join(ROOT, "site", "public", "screenshots"))) {
  pass("E", "screenshots directory exists");
} else {
  warn("E", "screenshots directory", "site/public/screenshots/ not found");
}

// ── Summary + Receipt ────────────────────────────────────────

const verdict = failCount === 0 ? "GO" : "NO-GO";
const commit = getCommit();
const week = getWeek();
const blocking = results.filter((r) => r.status === "fail");
const warnings = results.filter((r) => r.status === "warn");

const receipt = {
  generatedAt: new Date().toISOString(),
  week,
  commit,
  verdict,
  pass: passCount,
  fail: failCount,
  warn: warnCount,
  blocking: blocking.map((r) => ({ section: r.section, check: r.check, reason: r.reason })),
  warnings: warnings.map((r) => ({ section: r.section, check: r.check, reason: r.reason })),
  packageVersion: pkgJson?.version || null,
};

if (!jsonOutput) {
  console.log("\n========================================");
  console.log(`Results: ${passCount} passed, ${failCount} failed (blocking), ${warnCount} warnings (non-blocking)`);
  console.log("========================================\n");

  if (verdict === "GO") {
    console.log("✓ GO — ready to promote this week.\n");
  } else {
    console.log(`✗ NO-GO — ${failCount} blocking check(s) failed. Fix before promoting.\n`);
    for (const b of blocking) {
      console.log(`  → [${b.section}] ${b.check}: ${b.reason}`);
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log(`Non-blocking warnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`  ⚠ [${w.section}] ${w.check}: ${w.reason}`);
    }
    console.log();
  }
} else {
  console.log(JSON.stringify(receipt, null, 2));
}

// ── Emit readiness receipt ───────────────────────────────────

if (emitReceipt) {
  const receiptDir = join(ROOT, "artifacts", "readiness");
  mkdirSync(receiptDir, { recursive: true });
  const receiptPath = join(receiptDir, `${week}.json`);
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  if (!jsonOutput) {
    console.log(`📋 Readiness receipt written → ${receiptPath}`);
  }
}

process.exit(failCount > 0 ? 1 : 0);

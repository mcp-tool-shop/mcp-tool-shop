#!/usr/bin/env node

/**
 * Trust Receipt Generator
 *
 * Generates site/public/trust.json — a machine-readable provenance artifact.
 * Emitted at build time so every deploy carries verifiable metadata.
 *
 * Usage:
 *   node scripts/gen-trust-receipt.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/marketir/marketir.snapshot.json  (lock hash)
 *   site/src/data/marketir/data/tools/*.json       (proven claims)
 *   site/src/data/worthy.json                      (worthy stats)
 *   site/src/data/projects.json                    (artifact hash)
 *   site/src/data/overrides.json                   (artifact hash)
 *   site/src/data/promo.json                       (artifact hash)
 *   site/src/data/baseline.json                    (artifact hash)
 *   site/src/data/ops-history.json                 (artifact hash)
 *
 * Writes:
 *   site/public/trust.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");
const PUBLIC_DIR = join(ROOT, "site", "public");

// ── Helpers ─────────────────────────────────────────────────

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function hashFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    return "sha256:" + createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

// ── Core ────────────────────────────────────────────────────

/**
 * Build a trust receipt object from available data.
 *
 * @param {{ dataDir?: string, root?: string }} opts
 * @returns {object} Trust receipt
 */
export function buildTrustReceipt(opts = {}) {
  const { dataDir = DATA_DIR, root = ROOT } = opts;

  // 1. Git SHA
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  } catch { /* fail soft */ }

  // 2. MarketIR lock hash
  const snapshot = safeParseJson(join(dataDir, "marketir", "marketir.snapshot.json"), {});
  const marketirLockHash = snapshot.lockSha256 || null;

  // 3. COE version
  let coeVersion = "unknown";
  try {
    const rootPkg = safeParseJson(join(root, "package.json"), {});
    const deps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
    if (deps["@mcptoolshop/clearance-opinion-engine"]) {
      coeVersion = deps["@mcptoolshop/clearance-opinion-engine"].replace(/^\^|~/, "");
    }
  } catch { /* fail soft */ }

  // 4. Proven claim count
  let provenClaims = 0;
  const toolsDir = join(dataDir, "marketir", "data", "tools");
  try {
    if (existsSync(toolsDir)) {
      const files = readdirSync(toolsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const tool = safeParseJson(join(toolsDir, file), {});
        if (tool.claims) {
          provenClaims += tool.claims.filter((c) => c.status === "proven").length;
        }
      }
    }
  } catch { /* fail soft */ }

  // 5. Worthy stats
  const worthy = safeParseJson(join(dataDir, "worthy.json"), {});
  const repos = worthy.repos || {};
  const repoEntries = Object.values(repos);
  const worthyStats = {
    total: repoEntries.length,
    worthy: repoEntries.filter((r) => r.worthy).length,
    notWorthy: repoEntries.filter((r) => !r.worthy).length,
  };

  // 6. Artifact manifest — SHA-256 of key data files
  const MANIFEST_FILES = [
    "projects.json",
    "overrides.json",
    "worthy.json",
    "promo.json",
    "baseline.json",
    "ops-history.json",
  ];

  const artifactManifest = {};
  for (const file of MANIFEST_FILES) {
    const hash = hashFile(join(dataDir, file));
    if (hash) {
      artifactManifest[file] = hash;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    commit,
    marketirLockHash,
    coeVersion,
    provenClaims,
    worthyStats,
    artifactManifest,
  };
}

/**
 * Full pipeline: build receipt and write to site/public/trust.json.
 *
 * @param {{ dataDir?: string, publicDir?: string, root?: string, dryRun?: boolean }} opts
 * @returns {object} Trust receipt
 */
export function generateTrustReceipt(opts = {}) {
  const { publicDir = PUBLIC_DIR, dryRun = false, ...buildOpts } = opts;

  const receipt = buildTrustReceipt(buildOpts);

  if (dryRun) {
    console.log(`  [dry-run] Would write trust.json (commit: ${receipt.commit})`);
    console.log(`  [dry-run] MarketIR lock: ${receipt.marketirLockHash || "N/A"}`);
    console.log(`  [dry-run] Proven claims: ${receipt.provenClaims}`);
    console.log(`  [dry-run] Artifacts: ${Object.keys(receipt.artifactManifest).length} files hashed`);
    return receipt;
  }

  writeFileSync(join(publicDir, "trust.json"), JSON.stringify(receipt, null, 2) + "\n", "utf8");
  console.log(`  Wrote trust.json (commit: ${receipt.commit}, ${Object.keys(receipt.artifactManifest).length} artifacts)`);

  return receipt;
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-trust-receipt.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating trust receipt...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const receipt = generateTrustReceipt({ dryRun });
  console.log(`  Commit: ${receipt.commit}`);
  console.log(`  Proven claims: ${receipt.provenClaims}`);
  console.log(`  Worthy: ${receipt.worthyStats.worthy}/${receipt.worthyStats.total}`);
}

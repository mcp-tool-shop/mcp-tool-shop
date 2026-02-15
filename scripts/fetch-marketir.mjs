#!/usr/bin/env node

/**
 * MarketIR Fetch Script
 *
 * Downloads MarketIR data from mcp-tool-shop/mcpt-marketing and writes
 * a verified vendor snapshot into site/src/data/marketir/.
 *
 * Steps:
 *   1. Fetch marketing.lock.json (source of truth for what files to pull)
 *   2. Fetch marketing.index.json + all referenced data files
 *   3. Fetch evidence.manifest.json
 *   4. Verify every fetched file's sha256 against the lockfile
 *   5. Write files + generate marketir.snapshot.json (ingestion manifest)
 *
 * Usage:
 *   node scripts/fetch-marketir.mjs              # fetch from main
 *   node scripts/fetch-marketir.mjs --branch dev # fetch from branch
 *   node scripts/fetch-marketir.mjs --dry-run    # preview without writing
 *
 * Environment:
 *   GITHUB_TOKEN    — optional, for authenticated requests
 *   MARKETIR_REPO   — override source (default: mcp-tool-shop/mcpt-marketing)
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Config ──────────────────────────────────────────────────────────────────

const REPO = process.env.MARKETIR_REPO || "mcp-tool-shop/mcpt-marketing";
const OUTPUT_DIR = path.join(ROOT, "site", "src", "data", "marketir");
const SNAPSHOT_PATH = path.join(OUTPUT_DIR, "marketir.snapshot.json");
const DRY_RUN = process.argv.includes("--dry-run");

const branchIdx = process.argv.indexOf("--branch");
const BRANCH =
  branchIdx !== -1 && process.argv[branchIdx + 1] ? process.argv[branchIdx + 1] : "main";

const TOKEN = process.env.GITHUB_TOKEN || "";

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchRaw(remotePath) {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${remotePath}`;
  const headers = { Accept: "application/vnd.github.v3.raw" };
  if (TOKEN) headers["Authorization"] = `token ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${remotePath}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching MarketIR from ${REPO}@${BRANCH}...\n`);

  // Step 1: Fetch the lockfile (tells us exactly what to pull and what hashes to expect)
  console.log("1. Fetching lockfile...");
  const lockText = await fetchRaw("marketing/manifests/marketing.lock.json");
  const lock = JSON.parse(lockText);
  const lockSha256 = sha256(lockText);
  console.log(`   lock: ${lock.files.length} files, generated ${lock.generatedAt}`);

  // Build a map of expected hashes from the lockfile
  const expectedHashes = new Map();
  for (const entry of lock.files) {
    expectedHashes.set(entry.path, { sha256: entry.sha256, bytes: entry.bytes });
  }

  // Step 2: Fetch all files referenced in the lockfile
  console.log("\n2. Fetching data files...");
  const fetched = new Map(); // remotePath → { text, localPath }

  for (const entry of lock.files) {
    const remotePath = entry.path;
    console.log(`   fetching ${remotePath}...`);
    const text = await fetchRaw(remotePath);
    JSON.parse(text); // validate JSON

    // Determine local path: strip "marketing/" prefix
    // marketing/data/tools/zip-meta-map.json → data/tools/zip-meta-map.json
    // marketing/schema/marketing.schema.json → schema/marketing.schema.json
    // marketing/manifests/evidence.manifest.json → manifests/evidence.manifest.json
    const localRel = remotePath.replace(/^marketing\//, "");
    fetched.set(remotePath, { text, localRel });
  }

  // Also fetch the lockfile itself (not in lock.files, but we want it locally)
  fetched.set("marketing/manifests/marketing.lock.json", {
    text: lockText,
    localRel: "manifests/marketing.lock.json",
  });

  // Step 3: Verify hashes
  console.log("\n3. Verifying hashes...");
  let hashErrors = 0;
  for (const [remotePath, { text }] of fetched) {
    const expected = expectedHashes.get(remotePath);
    if (!expected) continue; // lockfile itself isn't in the hash list

    const actual = sha256(text);
    const actualBytes = Buffer.byteLength(text, "utf8");

    if (actual !== expected.sha256) {
      console.error(`   HASH MISMATCH: ${remotePath}`);
      console.error(`     expected: ${expected.sha256}`);
      console.error(`     got:      ${actual}`);
      hashErrors++;
    } else if (actualBytes !== expected.bytes) {
      console.error(`   SIZE MISMATCH: ${remotePath}`);
      console.error(`     expected: ${expected.bytes} bytes`);
      console.error(`     got:      ${actualBytes} bytes`);
      hashErrors++;
    } else {
      console.log(`   OK: ${remotePath}`);
    }
  }

  if (hashErrors > 0) {
    console.error(`\n${hashErrors} hash verification error(s). Aborting.`);
    process.exit(1);
  }
  console.log("   All hashes verified.");

  if (DRY_RUN) {
    console.log(`\n[dry-run] Would write ${fetched.size} files to: ${OUTPUT_DIR}`);
    return;
  }

  // Step 4: Write files
  console.log("\n4. Writing files...");
  for (const [, { text, localRel }] of fetched) {
    const outPath = path.join(OUTPUT_DIR, localRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, text, "utf8");
    console.log(`   wrote ${localRel} (${Buffer.byteLength(text)} bytes)`);
  }

  // Step 5: Write ingestion snapshot
  console.log("\n5. Writing snapshot...");
  const snapshot = {
    sourceRepo: REPO,
    sourceBranch: BRANCH,
    lockSha256,
    fileCount: lock.files.length,
    fetchedAt: new Date().toISOString(),
  };
  const snapshotJson = JSON.stringify(snapshot, null, 2) + "\n";
  fs.writeFileSync(SNAPSHOT_PATH, snapshotJson, "utf8");
  console.log(`   wrote marketir.snapshot.json`);

  // Summary
  const indexText = fetched.get("marketing/data/marketing.index.json")?.text;
  if (indexText) {
    const index = JSON.parse(indexText);
    const tools = index.tools?.length ?? 0;
    const audiences = index.audiences?.length ?? 0;
    const campaigns = index.campaigns?.length ?? 0;
    console.log(`\nMarketIR snapshot: ${tools} tool(s), ${audiences} audience(s), ${campaigns} campaign(s)`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(`MarketIR fetch failed: ${err.message}`);
  process.exit(1);
});

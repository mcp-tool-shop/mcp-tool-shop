#!/usr/bin/env node

/**
 * Registry Fetch Script
 *
 * Downloads registry artifacts from mcp-tool-shop-org/mcp-tool-registry
 * and stores them as generated inputs for the marketing site.
 *
 * Files fetched:
 *   registry.json          → site/src/data/registry/registry.json
 *   dist/registry.index.json → site/src/data/registry/registry.index.json
 *
 * Usage:
 *   node scripts/fetch-registry.mjs                # fetch from main branch
 *   node scripts/fetch-registry.mjs --branch dev   # fetch from specific branch
 *   node scripts/fetch-registry.mjs --dry-run      # preview without writing
 *
 * Environment:
 *   GITHUB_TOKEN  — optional, uses authenticated requests if set
 *   REGISTRY_REPO — override source repo (default: mcp-tool-shop-org/mcp-tool-registry)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Config ──────────────────────────────────────────────────────────────────

const REGISTRY_REPO = process.env.REGISTRY_REPO || "mcp-tool-shop-org/mcp-tool-registry";
const OUTPUT_DIR = path.join(ROOT, "site", "src", "data", "registry");
const DRY_RUN = process.argv.includes("--dry-run");

// Parse --branch flag
const branchIdx = process.argv.indexOf("--branch");
const BRANCH = branchIdx !== -1 && process.argv[branchIdx + 1]
  ? process.argv[branchIdx + 1]
  : "main";

const TOKEN = process.env.GITHUB_TOKEN || "";

// Files to fetch: [remote path, local filename]
const FILES = [
  ["registry.json", "registry.json"],
  ["dist/registry.index.json", "registry.index.json"],
];

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchRaw(remotePath) {
  const url = `https://raw.githubusercontent.com/${REGISTRY_REPO}/${BRANCH}/${remotePath}`;
  const headers = {};
  if (TOKEN) {
    headers["Authorization"] = `token ${TOKEN}`;
  }
  headers["Accept"] = "application/vnd.github.v3.raw";

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${remotePath}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function validateJson(text, filename) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filename}: ${err.message}`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function printSummary(registry, index) {
  // registry.json summary
  const schemaVersion = registry.schema_version || "?";
  const generatedAt = registry.generated_at || "?";
  const toolCount = registry.tools?.length ?? 0;
  console.log(`  registry.json: v${schemaVersion}, generated ${generatedAt}, ${toolCount} tools`);

  // registry.index.json summary
  const indexCount = Array.isArray(index) ? index.length : 0;
  const withCaps = Array.isArray(index)
    ? index.filter((t) => t.capabilities?.length > 0).length
    : 0;
  const withBundles = Array.isArray(index)
    ? index.filter((t) => t.bundle_membership?.length > 0).length
    : 0;
  console.log(`  registry.index.json: ${indexCount} entries, ${withCaps} with capabilities, ${withBundles} in bundles`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching registry from ${REGISTRY_REPO}@${BRANCH}...`);

  const results = {};

  for (const [remotePath, localName] of FILES) {
    console.log(`  fetching ${remotePath}...`);
    const text = await fetchRaw(remotePath);
    const parsed = validateJson(text, localName);
    results[localName] = { text, parsed };
  }

  console.log("\nValidation passed. Summary:");
  printSummary(results["registry.json"].parsed, results["registry.index.json"].parsed);

  if (DRY_RUN) {
    console.log("\n[dry-run] Would write to:", OUTPUT_DIR);
    return;
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [, localName] of FILES) {
    const outPath = path.join(OUTPUT_DIR, localName);
    // Pretty-print for readable diffs
    const formatted = JSON.stringify(results[localName].parsed, null, 2) + "\n";
    fs.writeFileSync(outPath, formatted);
    console.log(`  wrote ${localName} (${formatted.length} bytes)`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(`Registry fetch failed: ${err.message}`);
  // Exit code 0 when used as non-fatal step (caller checks for files)
  // Exit code 1 for interactive use
  const nonFatal = process.env.REGISTRY_FETCH_NONFATAL === "1";
  if (nonFatal) {
    console.error("Continuing (non-fatal mode).");
    process.exit(0);
  }
  process.exit(1);
});

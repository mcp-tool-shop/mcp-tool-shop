#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");
const PUBLIC_DIR = join(ROOT, "site", "public");

function safeParseJson(filePath, fallback = null) {
  try { return JSON.parse(readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function hashFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    return "sha256:" + createHash("sha256").update(content).digest("hex");
  } catch { return null; }
}

/**
 * Build a per-week promo receipt.
 * @param {{ dataDir?: string, publicDir?: string, week: string }} opts
 */
export function buildPromoWeekReceipt(opts) {
  const { dataDir = DATA_DIR, publicDir = PUBLIC_DIR, week } = opts;
  return {
    generatedAt: new Date().toISOString(),
    week,
    trustReceiptHash: hashFile(join(publicDir, "trust.json")),
    inputs: {
      promoDecisionsSha: hashFile(join(dataDir, "promo-decisions.json")),
      experimentDecisionsSha: hashFile(join(dataDir, "experiment-decisions.json")),
      governanceSha: hashFile(join(dataDir, "governance.json")),
    },
    artifactManifestSubset: {
      "promo-decisions.json": hashFile(join(dataDir, "promo-decisions.json")),
      "experiment-decisions.json": hashFile(join(dataDir, "experiment-decisions.json")),
      "governance.json": hashFile(join(dataDir, "governance.json")),
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("gen-promo-week-receipt.mjs");
if (isMain) {
  const week = new Date().toISOString().split("T")[0];
  console.log("Generating promo week receipt...");
  const receipt = buildPromoWeekReceipt({ week });
  console.log(JSON.stringify(receipt, null, 2));
}

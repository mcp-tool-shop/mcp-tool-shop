/**
 * MarketIR Lookup Layer
 *
 * Loads the vendor snapshot at build time and exposes fail-soft helpers.
 * If the snapshot is missing (e.g. running locally without fetch), all
 * functions return null instead of throwing.
 */

import fs from "node:fs";
import path from "node:path";

// process.cwd() is the Astro project root (site/) during build
const DATA_DIR = path.join(process.cwd(), "src", "data", "marketir");

function readJson(relPath) {
  const full = path.join(DATA_DIR, relPath);
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Load the full snapshot metadata (sourceRepo, branch, lockSha256, fetchedAt).
 */
export function loadSnapshot() {
  return readJson("marketir.snapshot.json");
}

/**
 * Load the evidence manifest and return a Map of evidenceId → entry.
 */
export function loadEvidenceMap() {
  const manifest = readJson("manifests/evidence.manifest.json");
  if (!manifest?.entries) return new Map();
  const map = new Map();
  for (const entry of manifest.entries) {
    map.set(entry.id, entry);
  }
  return map;
}

/**
 * Load a tool by its slug (e.g. "zip-meta-map").
 * Mapping: slug → MarketIR file `data/tools/<slug>.json`
 */
export function getToolBySlug(slug) {
  return readJson(`data/tools/${slug}.json`);
}

/**
 * Get proven claims for a tool, with evidence entries resolved.
 * Returns { proven: [], aspirational: [], antiClaims: [] } or null.
 */
export function getProofData(slug) {
  const tool = getToolBySlug(slug);
  if (!tool) return null;

  const evidenceMap = loadEvidenceMap();

  const proven = [];
  const aspirational = [];

  for (const claim of tool.claims || []) {
    const resolved = {
      id: claim.id,
      statement: claim.statement,
      status: claim.status,
      notes: claim.notes || null,
      evidence: [],
    };

    if (claim.evidenceRefs) {
      for (const ref of claim.evidenceRefs) {
        const ev = evidenceMap.get(ref);
        if (ev) {
          resolved.evidence.push(ev);
        }
      }
    }

    if (claim.status === "proven") {
      proven.push(resolved);
    } else if (claim.status === "aspirational") {
      aspirational.push(resolved);
    }
  }

  return {
    proven,
    aspirational,
    antiClaims: tool.antiClaims || [],
  };
}

/**
 * Get the press block for a tool, or null if it has none.
 */
export function getPressData(slug) {
  const tool = getToolBySlug(slug);
  return tool?.press || null;
}

/**
 * Get all tool slugs that have a press block.
 * Returns [{ slug, tool }] — callers should filter by publicProof separately.
 */
export function getToolsWithPress() {
  const index = readJson("data/marketing.index.json");
  if (!index?.tools) return [];

  const results = [];
  for (const { ref } of index.tools) {
    const slug = ref.replace("tools/", "").replace(".json", "");
    const tool = readJson(`data/${ref}`);
    if (tool?.press) {
      results.push({ slug, tool });
    }
  }
  return results;
}

/**
 * Apply the org ecosystem catalog to marketing-site projects.
 *
 * catalog.yaml (published as ecosystem.json) is canonical for:
 *   - whether an install command is ours
 *   - lane (shipped = latest tag >= v1.0.0)
 *   - primary area
 *
 * Editorial overrides still win on tagline, screenshots, kind, etc.
 * They do not win on install: a guessed command for a stranger's package
 * is how `npm install motif` reached the live catalog.
 */

import fs from "node:fs";
import path from "node:path";

export const ECOSYSTEM_SPEC_URL =
  "https://github.com/mcp-tool-shop-org/.github/blob/main/docs/ECOSYSTEM.md";

export const PATH_QUESTIONS = {
  "a-mcp-servers": "I want to build MCP servers",
  "b-ai-agents": "I want to build AI agents",
  "c-game-tooling": "I want to build game tooling",
  "d-verification": "I want verification and testing",
  "e-local-ai": "I want local AI workflows",
};

/** Catalog lane → the vocabulary /tools/ already filters on. */
export function siteLane(catalogLane) {
  if (catalogLane === "shipped") return "shipped";
  if (catalogLane === "in-development") return "active_lab";
  if (catalogLane === "archive") return "seed_vault";
  return catalogLane;
}

export function loadEcosystem(dataDir) {
  const p = path.join(dataDir, "ecosystem.json");
  if (!fs.existsSync(p)) {
    throw new Error(`missing ${p} — run: node scripts/fetch-ecosystem.mjs`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Mutates `projects` in place. Returns a small report for logs/tests.
 */
export function applyEcosystem(projects, ecosystem) {
  const byName = new Map((ecosystem.repos || []).map((r) => [r.name, r]));
  let applied = 0;
  let installsSet = 0;
  let installsCleared = 0;
  const unknown = [];

  for (const p of projects) {
    const entry = byName.get(p.repo);
    if (!entry) {
      if (p.repo && p.repo !== ".github") unknown.push(p.repo);
      continue;
    }
    p.area = entry.area;
    if (entry.also && entry.also.length) p.also = entry.also;
    else delete p.also;
    p.lane = siteLane(entry.lane);
    p.catalogLane = entry.lane;
    if (entry.install) {
      if (p.install !== entry.install) installsSet += 1;
      p.install = entry.install;
    } else if (p.install) {
      delete p.install;
      installsCleared += 1;
    }
    if (entry.package) p.package = entry.package;
    else delete p.package;
    p.catalogued = true;
    applied += 1;
  }

  return {
    applied,
    installsSet,
    installsCleared,
    catalogued: (ecosystem.repos || []).length,
    unknown: unknown.filter((n) => n !== "mcp-registry"),
  };
}

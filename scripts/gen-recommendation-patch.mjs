#!/usr/bin/env node
/**
 * gen-recommendation-patch.mjs
 *
 * Translates advisory recommendations into governed, auditable patches.
 * Only certain recommendation categories produce actual data file changes;
 * the rest become advisory notes included in the PR body.
 *
 * Respects freeze modes, promo queue caps, and max patch limits.
 * Deterministic: same inputs → same patch plan (timestamps only in audit artifact).
 *
 * Usage:
 *   node scripts/gen-recommendation-patch.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/recommendations.json
 *   site/src/data/governance.json
 *   site/src/data/promo-queue.json
 *   site/src/data/experiments.json
 *
 * Writes:
 *   site/src/data/promo-queue.json      (if re-feature patches)
 *   site/src/data/experiments.json       (if graduation patches)
 *   site/src/data/recommendation-patch.json (audit artifact, always)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig, getRoot } from "./lib/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = getRoot();
const config = getConfig();
const DATA_DIR = path.join(ROOT, config.paths.dataDir);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

// ── Constants ────────────────────────────────────────────────

export const ALLOWED_TARGET_FILES = new Set(["promo-queue.json", "experiments.json"]);
export const MAX_DATA_PATCHES_DEFAULT = 5;

// Categories that produce actual data file changes
const PATCHABLE_CATEGORIES = new Set(["re-feature", "experiment-graduation"]);

// ── Helpers ──────────────────────────────────────────────────

function loadJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// ── Core Functions (exported for testing) ────────────────────

/**
 * Translate a single recommendation into a patch, advisory note, or frozen action.
 * @param {object} rec - recommendation from recommendations.json
 * @param {object} governance - governance.json contents
 * @param {object} currentData - { promoQueue, experiments }
 * @returns {{ type: "patch"|"advisory"|"frozen", patch?: object, note: string, riskNote?: string }}
 */
export function translateRecommendation(rec, governance, currentData) {
  const { category, slug } = rec;

  // ── re-feature: add slug to promo queue ──
  if (category === "re-feature") {
    if (governance.decisionsFrozen) {
      return {
        type: "frozen",
        note: `decisionsFrozen — skipped re-feature for "${slug}"`,
      };
    }

    const queue = currentData.promoQueue;
    const currentSlugs = queue.slugs || [];
    const maxPerWeek = governance.maxPromosPerWeek || 3;

    if (currentSlugs.includes(slug)) {
      return {
        type: "advisory",
        note: `Already in promo queue`,
      };
    }

    if (currentSlugs.length >= maxPerWeek) {
      return {
        type: "advisory",
        note: `Promo queue full (${currentSlugs.length}/${maxPerWeek})`,
      };
    }

    const newSlugs = [...currentSlugs, slug];
    return {
      type: "patch",
      patch: {
        category: "re-feature",
        slug,
        targetFile: "promo-queue.json",
        description: `Add ${slug} to promo queue (${rec.evidence?.proofEngagementScore ? `proof engagement: ${rec.evidence.proofEngagementScore}` : "re-feature"})`,
        riskNote: `Promo queue now has ${newSlugs.length}/${maxPerWeek} slots filled`,
        apply: { slugs: newSlugs },
      },
      note: `Add to promo queue`,
      riskNote: `Promo queue now has ${newSlugs.length}/${maxPerWeek} slots filled`,
    };
  }

  // ── experiment-graduation: set experiment status to concluded ──
  if (category === "experiment-graduation") {
    if (governance.experimentsFrozen) {
      return {
        type: "frozen",
        note: `experimentsFrozen — skipped graduation for "${slug}"`,
      };
    }

    const experiments = currentData.experiments.experiments || [];
    const match = experiments.find((e) => e.id === slug);

    if (!match) {
      return {
        type: "advisory",
        note: `Experiment "${slug}" not found in experiments.json`,
      };
    }

    if (match.status === "concluded") {
      return {
        type: "advisory",
        note: `Experiment "${slug}" already concluded`,
      };
    }

    const updatedExperiments = experiments.map((e) =>
      e.id === slug ? { ...e, status: "concluded" } : e,
    );

    return {
      type: "patch",
      patch: {
        category: "experiment-graduation",
        slug,
        targetFile: "experiments.json",
        description: `Graduate experiment ${slug} (winner: ${rec.evidence?.winnerKey || "unknown"})`,
        riskNote: `Experiment ${slug} will be marked concluded`,
        apply: { experiments: updatedExperiments },
      },
      note: `Graduate experiment`,
      riskNote: `Experiment ${slug} will be marked concluded`,
    };
  }

  // ── Advisory-only categories ──
  if (category === "improve-proof") {
    return {
      type: "advisory",
      note: `${rec.insight || "Low proof engagement — improve evidence quality"}`,
    };
  }

  if (category === "stuck-submission") {
    return {
      type: "advisory",
      note: `${rec.insight || "High friction submission — needs attention"}`,
    };
  }

  if (category === "lint-promotion") {
    return {
      type: "advisory",
      note: `${rec.insight || "Lint warning pattern — consider promoting to error"}`,
    };
  }

  // ── Unknown category fallback ──
  return {
    type: "advisory",
    note: `Unknown category "${category}" — advisory only`,
  };
}

/**
 * Build a complete patch plan from all recommendations.
 * @param {object[]} recommendations
 * @param {object} governance
 * @param {object} currentData - { promoQueue, experiments }
 * @param {{ maxPatches?: number }} opts
 * @returns {{ patches: object[], advisoryNotes: object[], riskNotes: string[], frozenActions: object[] }}
 */
export function buildPatchPlan(recommendations, governance, currentData, opts = {}) {
  const { maxPatches = MAX_DATA_PATCHES_DEFAULT } = opts;

  const patches = [];
  const advisoryNotes = [];
  const riskNotes = [];
  const frozenActions = [];

  // Track evolving state for incremental queue fills
  const evolving = {
    promoQueue: JSON.parse(JSON.stringify(currentData.promoQueue)),
    experiments: JSON.parse(JSON.stringify(currentData.experiments)),
  };

  for (const rec of recommendations) {
    const result = translateRecommendation(rec, governance, evolving);

    if (result.type === "patch") {
      if (patches.length >= maxPatches) {
        // Exceeded cap — downgrade to advisory
        advisoryNotes.push({
          category: rec.category,
          slug: rec.slug,
          note: `Exceeded max patch cap (${maxPatches}) — ${result.note}`,
        });
        continue;
      }

      patches.push(result.patch);
      if (result.riskNote) riskNotes.push(result.riskNote);

      // Update evolving state so subsequent recommendations see the changes
      if (result.patch.targetFile === "promo-queue.json" && result.patch.apply?.slugs) {
        evolving.promoQueue = { ...evolving.promoQueue, slugs: result.patch.apply.slugs };
      }
      if (result.patch.targetFile === "experiments.json" && result.patch.apply?.experiments) {
        evolving.experiments = { ...evolving.experiments, experiments: result.patch.apply.experiments };
      }
    } else if (result.type === "frozen") {
      frozenActions.push({
        category: rec.category,
        slug: rec.slug,
        note: result.note,
      });
    } else {
      // advisory
      advisoryNotes.push({
        category: rec.category,
        slug: rec.slug,
        note: result.note,
      });
    }
  }

  return { patches, advisoryNotes, riskNotes, frozenActions };
}

/**
 * Apply patch plan to data files on disk.
 * @param {object[]} patches - from buildPatchPlan().patches
 * @param {object} currentData - { promoQueue, experiments }
 * @param {{ dataDir?: string }} opts
 * @returns {{ filesWritten: string[] }}
 */
export function applyPatchesToFiles(patches, currentData, opts = {}) {
  const { dataDir = DATA_DIR } = opts;
  const filesWritten = [];

  // Group patches by target file to coalesce writes
  const byFile = {};
  for (const p of patches) {
    if (!byFile[p.targetFile]) byFile[p.targetFile] = [];
    byFile[p.targetFile].push(p);
  }

  for (const [file, filePatches] of Object.entries(byFile)) {
    const filePath = path.join(dataDir, file);
    let current = loadJsonSafe(filePath, {});

    // Apply each patch's changes sequentially
    for (const p of filePatches) {
      if (p.apply) {
        current = { ...current, ...p.apply };
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(current, null, 2) + "\n");
    filesWritten.push(file);
  }

  return { filesWritten };
}

// ── Pipeline ─────────────────────────────────────────────────

/**
 * Generate and optionally apply recommendation patches.
 * @param {{ dataDir?: string, dryRun?: boolean, maxPatches?: number }} opts
 * @returns {object} The patch plan with metadata
 */
export function genRecommendationPatch(opts = {}) {
  const { dataDir = DATA_DIR, dryRun = false, maxPatches = MAX_DATA_PATCHES_DEFAULT } = opts;

  console.log("Generating recommendation patches...");
  console.log(`  Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);

  // Load inputs (fail-soft)
  const recommendations = loadJsonSafe(path.join(dataDir, "recommendations.json"), { recommendations: [] });
  const governance = loadJsonSafe(path.join(dataDir, "governance.json"), {});
  const promoQueue = loadJsonSafe(path.join(dataDir, "promo-queue.json"), { slugs: [] });
  const experiments = loadJsonSafe(path.join(dataDir, "experiments.json"), { experiments: [] });

  const currentData = { promoQueue, experiments };

  // Build patch plan
  const plan = buildPatchPlan(
    recommendations.recommendations || [],
    governance,
    currentData,
    { maxPatches },
  );

  // Audit artifact (includes timestamp — only non-deterministic part)
  const artifact = {
    generatedAt: new Date().toISOString(),
    ...plan,
  };

  if (dryRun) {
    console.log(`  [dry-run] ${plan.patches.length} data patches, ${plan.advisoryNotes.length} advisory, ${plan.frozenActions.length} frozen`);
  } else {
    // Apply data file changes
    if (plan.patches.length > 0) {
      const { filesWritten } = applyPatchesToFiles(plan.patches, currentData, { dataDir });
      console.log(`  Applied patches to: ${filesWritten.join(", ")}`);
    } else {
      console.log("  No data patches to apply.");
    }

    // Write audit artifact
    const artifactPath = path.join(dataDir, "recommendation-patch.json");
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
    console.log(`  Wrote audit artifact: ${artifactPath}`);
  }

  // Summary
  console.log(`    Patches: ${plan.patches.length}`);
  console.log(`    Advisory: ${plan.advisoryNotes.length}`);
  console.log(`    Frozen: ${plan.frozenActions.length}`);
  console.log(`    Risk notes: ${plan.riskNotes.length}`);

  return artifact;
}

// ── CLI ──────────────────────────────────────────────────────

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  genRecommendationPatch({ dryRun });
}

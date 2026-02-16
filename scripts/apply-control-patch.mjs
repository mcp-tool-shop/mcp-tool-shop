#!/usr/bin/env node

/**
 * Apply Control Patch
 *
 * Validates and applies a JSON patch to governance and promo data files.
 * Called from the apply-control-patch workflow.
 *
 * Usage:
 *   node scripts/apply-control-patch.mjs '{"governance.json":{"decisionsFrozen":true}}'
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getConfig, getRoot } from "./lib/config.mjs";

const ROOT = getRoot();
const config = getConfig();
const DATA_DIR = join(ROOT, config.paths.dataDir);

// ── Allowed files and field validators ───────────────────────

const ALLOWED_FILES = new Set([
  "governance.json",
  "promo.json",
  "promo-queue.json",
  "experiments.json",
]);

const PROTECTED_FIELDS = new Set(["schemaVersion", "hardRules"]);

const GOVERNANCE_VALIDATORS = {
  decisionsFrozen: (v) => typeof v === "boolean",
  experimentsFrozen: (v) => typeof v === "boolean",
  maxPromosPerWeek: (v) => Number.isInteger(v) && v > 0 && v <= 20,
  cooldownDaysPerSlug: (v) => Number.isInteger(v) && v > 0 && v <= 90,
  cooldownDaysPerPartner: (v) => Number.isInteger(v) && v > 0 && v <= 90,
  minCoverageScore: (v) => typeof v === "number" && v >= 0 && v <= 100,
  minExperimentDataThreshold: (v) => Number.isInteger(v) && v > 0 && v <= 1000,
};

const PROMO_VALIDATORS = {
  enabled: (v) => typeof v === "boolean",
  learningMode: (v) => ["off", "shadow", "active"].includes(v),
};

const FILE_VALIDATORS = {
  "governance.json": GOVERNANCE_VALIDATORS,
  "promo.json": PROMO_VALIDATORS,
};

// ── Risk notes ───────────────────────────────────────────────

const RISK_NOTES = {
  "governance.json": {
    decisionsFrozen: (v) => v === true ? "Decisions will NOT update until unfrozen" : "Decisions will resume updating",
    experimentsFrozen: (v) => v === true ? "Experiments will NOT update until unfrozen" : "Experiments will resume updating",
    maxPromosPerWeek: (v) => `Max promos per week changed to ${v} — affects budget allocation`,
    cooldownDaysPerSlug: (v) => `Slug cooldown changed to ${v} days`,
    cooldownDaysPerPartner: (v) => `Partner cooldown changed to ${v} days`,
    minCoverageScore: (v) => `Coverage threshold changed to ${v}`,
    minExperimentDataThreshold: (v) => `Experiment data threshold changed to ${v}`,
  },
  "promo.json": {
    enabled: (v) => v ? "Promotion ENABLED — outreach will run" : "Promotion DISABLED — no outreach",
    learningMode: (v) => `Learning mode set to "${v}"`,
  },
};

// ── Core functions (exported for testing) ────────────────────

/**
 * Validate a patch object.
 * @param {Record<string, Record<string, unknown>>} patch
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePatch(patch) {
  const errors = [];

  if (!patch || typeof patch !== "object") {
    return { valid: false, errors: ["Patch must be a JSON object"] };
  }

  for (const [file, fields] of Object.entries(patch)) {
    if (!ALLOWED_FILES.has(file)) {
      errors.push(`File "${file}" is not in the allowed list: ${[...ALLOWED_FILES].join(", ")}`);
      continue;
    }

    if (!fields || typeof fields !== "object") {
      errors.push(`Fields for "${file}" must be an object`);
      continue;
    }

    for (const [field, value] of Object.entries(fields)) {
      if (PROTECTED_FIELDS.has(field)) {
        errors.push(`Field "${field}" in "${file}" is protected and cannot be patched`);
        continue;
      }

      const validators = FILE_VALIDATORS[file];
      if (validators && validators[field]) {
        if (!validators[field](value)) {
          errors.push(`Invalid value for "${file}".${field}: ${JSON.stringify(value)}`);
        }
      }
      // Files without validators (promo-queue.json, experiments.json) allow any non-protected fields
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Apply a validated patch to data files.
 * @param {Record<string, Record<string, unknown>>} patch
 * @param {{ dataDir?: string }} opts
 * @returns {{ applied: string[], riskNotes: string[] }}
 */
export function applyPatch(patch, opts = {}) {
  const { dataDir = DATA_DIR } = opts;
  const applied = [];
  const riskNotes = [];

  for (const [file, fields] of Object.entries(patch)) {
    const filePath = join(dataDir, file);
    let current = {};
    try {
      current = JSON.parse(readFileSync(filePath, "utf8"));
    } catch { /* start fresh if missing */ }

    // Merge fields
    const updated = { ...current, ...fields };
    writeFileSync(filePath, JSON.stringify(updated, null, 2) + "\n", "utf8");
    applied.push(file);

    // Generate risk notes
    const noteGenerators = RISK_NOTES[file] || {};
    for (const [field, value] of Object.entries(fields)) {
      if (noteGenerators[field]) {
        riskNotes.push(noteGenerators[field](value));
      }
    }
  }

  return { applied, riskNotes };
}

/**
 * Full pipeline: parse, validate, apply.
 * @param {string} patchJson - JSON string from CLI arg
 * @param {{ dataDir?: string, riskNotesPath?: string }} opts
 */
export function applyControlPatch(patchJson, opts = {}) {
  const { dataDir = DATA_DIR, riskNotesPath = "/tmp/patch-risk-notes.txt" } = opts;

  let patch;
  try {
    patch = JSON.parse(patchJson);
  } catch (e) {
    console.error(`  Error: Invalid JSON — ${e.message}`);
    process.exitCode = 1;
    return { success: false, error: "Invalid JSON" };
  }

  const validation = validatePatch(patch);
  if (!validation.valid) {
    console.error("  Validation errors:");
    for (const err of validation.errors) {
      console.error(`    - ${err}`);
    }
    process.exitCode = 1;
    return { success: false, errors: validation.errors };
  }

  const result = applyPatch(patch, { dataDir });

  console.log(`  Applied patch to: ${result.applied.join(", ")}`);
  if (result.riskNotes.length > 0) {
    console.log("  Risk notes:");
    for (const note of result.riskNotes) {
      console.log(`    - ${note}`);
    }
    // Write risk notes file for workflow
    try {
      writeFileSync(riskNotesPath, result.riskNotes.join("\n") + "\n", "utf8");
    } catch { /* fail soft in non-CI env */ }
  }

  return { success: true, ...result };
}

// ── Entry point ──────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("apply-control-patch.mjs");
if (isMain) {
  const patchJson = process.argv[2];
  if (!patchJson) {
    console.error("Usage: node scripts/apply-control-patch.mjs '<patch-json>'");
    process.exitCode = 1;
  } else {
    console.log("Applying control patch...");
    applyControlPatch(patchJson);
  }
}

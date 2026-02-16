#!/usr/bin/env node

/**
 * Apply Submission Status
 *
 * Validates and applies a status patch to a submission in submissions.json.
 * Called from the apply-submission-status workflow.
 *
 * Usage:
 *   node scripts/apply-submission-status.mjs '{"slug":"my-tool","status":"needs-info","reviewNotes":"Please add a demo"}'
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getConfig, getRoot } from "./lib/config.mjs";

const ROOT = getRoot();
const config = getConfig();
const DATA_DIR = join(ROOT, config.paths.dataDir);

// ── Constants ─────────────────────────────────────────────────

export const VALID_STATUSES = [
  "pending", "accepted", "rejected", "withdrawn", "needs-info",
];

const PATCHABLE_FIELDS = new Set([
  "status", "reviewNotes", "lastReviewedAt", "sourcePr", "updatedAt", "reason",
]);

const PROTECTED_FIELDS = new Set([
  "slug", "submittedAt", "tool", "lane",
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function isHttpsUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

// ── Field validators ──────────────────────────────────────────

const FIELD_VALIDATORS = {
  status: (v) => typeof v === "string" && VALID_STATUSES.includes(v),
  reviewNotes: (v) => typeof v === "string" && v.length <= 500,
  lastReviewedAt: (v) => typeof v === "string" && ISO_DATE_RE.test(v),
  sourcePr: (v) => typeof v === "string" && isHttpsUrl(v),
  updatedAt: (v) => typeof v === "string" && ISO_DATE_RE.test(v),
  reason: (v) => typeof v === "string" && v.length <= 300,
};

// ── Risk notes ────────────────────────────────────────────────

const RISK_NOTES = {
  status: (v) => {
    const notes = {
      "needs-info": "Submission moved to needs-info — submitter should check queue",
      accepted: "Submission accepted — will appear in catalog pipeline",
      rejected: "Submission rejected — reason should be provided",
      pending: "Submission moved back to pending",
      withdrawn: "Submission withdrawn",
    };
    return notes[v] || `Status changed to "${v}"`;
  },
  reviewNotes: () => "Review notes updated",
  reason: () => "Rejection/status reason updated",
};

// ── Core functions (exported for testing) ────────────────────

/**
 * Validate a status patch for a given slug.
 * @param {string} slug
 * @param {Record<string, unknown>} fields
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStatusPatch(slug, fields) {
  const errors = [];

  if (!slug || typeof slug !== "string") {
    errors.push("slug: required non-empty string");
  }

  if (!fields || typeof fields !== "object") {
    return { valid: false, errors: ["fields must be a non-null object"] };
  }

  for (const [field, value] of Object.entries(fields)) {
    if (PROTECTED_FIELDS.has(field)) {
      errors.push(`"${field}" is protected and cannot be patched`);
      continue;
    }

    if (!PATCHABLE_FIELDS.has(field)) {
      errors.push(`"${field}" is not a recognized patchable field`);
      continue;
    }

    const validator = FIELD_VALIDATORS[field];
    if (validator && !validator(value)) {
      errors.push(`Invalid value for "${field}": ${JSON.stringify(value)}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Apply a validated status patch to a submission.
 * @param {string} slug
 * @param {Record<string, unknown>} fields
 * @param {{ dataDir?: string }} opts
 * @returns {{ applied: boolean, riskNotes: string[], submission: object|null, error?: string }}
 */
export function applyStatusPatch(slug, fields, opts = {}) {
  const { dataDir = DATA_DIR } = opts;
  const filePath = join(dataDir, "submissions.json");
  const riskNotes = [];

  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return { applied: false, riskNotes: [], submission: null, error: "Failed to read submissions.json" };
  }

  if (!Array.isArray(data.submissions)) {
    return { applied: false, riskNotes: [], submission: null, error: "submissions.json has no submissions array" };
  }

  const idx = data.submissions.findIndex((s) => s.slug === slug);
  if (idx === -1) {
    return { applied: false, riskNotes: [], submission: null, error: `Slug "${slug}" not found in submissions.json` };
  }

  // Merge fields
  const submission = data.submissions[idx];
  for (const [field, value] of Object.entries(fields)) {
    submission[field] = value;

    // Generate risk notes
    if (RISK_NOTES[field]) {
      riskNotes.push(RISK_NOTES[field](value));
    }
  }

  // Auto-set updatedAt if not explicitly provided
  if (!fields.updatedAt) {
    submission.updatedAt = new Date().toISOString();
  }

  data.submissions[idx] = submission;
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");

  return { applied: true, riskNotes, submission };
}

/**
 * Full pipeline: parse, validate, apply.
 * @param {string} patchJson - JSON string from CLI arg
 * @param {{ dataDir?: string, riskNotesPath?: string }} opts
 */
export function applySubmissionStatus(patchJson, opts = {}) {
  const { dataDir = DATA_DIR, riskNotesPath = "/tmp/submission-status-risk-notes.txt" } = opts;

  let patch;
  try {
    patch = JSON.parse(patchJson);
  } catch (e) {
    console.error(`  Error: Invalid JSON — ${e.message}`);
    process.exitCode = 1;
    return { success: false, error: "Invalid JSON" };
  }

  const { slug, ...fields } = patch;

  const validation = validateStatusPatch(slug, fields);
  if (!validation.valid) {
    console.error("  Validation errors:");
    for (const err of validation.errors) {
      console.error(`    - ${err}`);
    }
    process.exitCode = 1;
    return { success: false, errors: validation.errors };
  }

  const result = applyStatusPatch(slug, fields, { dataDir });
  if (!result.applied) {
    console.error(`  Error: ${result.error}`);
    process.exitCode = 1;
    return { success: false, error: result.error };
  }

  console.log(`  Applied status patch to "${slug}"`);
  if (result.riskNotes.length > 0) {
    console.log("  Risk notes:");
    for (const note of result.riskNotes) {
      console.log(`    - ${note}`);
    }
    try {
      writeFileSync(riskNotesPath, result.riskNotes.join("\n") + "\n", "utf8");
    } catch { /* fail soft in non-CI env */ }
  }

  return { success: true, ...result };
}

// ── Entry point ──────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("apply-submission-status.mjs");
if (isMain) {
  const patchJson = process.argv[2];
  if (!patchJson) {
    console.error("Usage: node scripts/apply-submission-status.mjs '<patch-json>'");
    process.exitCode = 1;
  } else {
    console.log("Applying submission status...");
    applySubmissionStatus(patchJson);
  }
}

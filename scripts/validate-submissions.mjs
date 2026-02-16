#!/usr/bin/env node

/**
 * Submission Validator
 *
 * Validates submission files in submissions/ and the aggregate
 * submissions.json for schema compliance.
 *
 * Usage:
 *   node scripts/validate-submissions.mjs [--dry-run]
 *
 * Reads:
 *   submissions/*.json
 *   site/src/data/submissions.json
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// ── Enums ──────────────────────────────────────────────────

export const VALID_KINDS = [
  "mcp-server", "cli", "library", "plugin", "desktop-app",
  "vscode-extension", "homebrew-tap", "template", "meta",
];

export const VALID_CATEGORIES = [
  "mcp-core", "voice", "security", "ml", "infrastructure",
  "desktop", "devtools", "web", "games",
];

export const VALID_STATUSES = ["pending", "accepted", "rejected", "withdrawn", "needs-info"];

export const VALID_LANES = ["promo", "experiment"];

// ── Helpers ────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function isHttpsUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function checkString(errors, obj, field, { required = false, min = 0, max = Infinity, label } = {}) {
  const val = field.split(".").reduce((o, k) => o?.[k], obj);
  const name = label || field;
  if (val == null || val === "") {
    if (required) errors.push(`${name}: required`);
    return;
  }
  if (typeof val !== "string") {
    errors.push(`${name}: must be string`);
    return;
  }
  if (val.length < min) errors.push(`${name}: too short (min ${min}, got ${val.length})`);
  if (val.length > max) errors.push(`${name}: too long (max ${max}, got ${val.length})`);
}

function checkArray(errors, obj, field, { required = false, minItems = 0, maxItems = Infinity, itemMaxLen = Infinity, label } = {}) {
  const val = field.split(".").reduce((o, k) => o?.[k], obj);
  const name = label || field;
  if (val == null) {
    if (required) errors.push(`${name}: required`);
    return;
  }
  if (!Array.isArray(val)) {
    errors.push(`${name}: must be array`);
    return;
  }
  if (val.length < minItems) errors.push(`${name}: too few items (min ${minItems}, got ${val.length})`);
  if (val.length > maxItems) errors.push(`${name}: too many items (max ${maxItems}, got ${val.length})`);
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] === "string" && val[i].length > itemMaxLen) {
      errors.push(`${name}[${i}]: too long (max ${itemMaxLen})`);
    }
  }
}

// ── Core validation ────────────────────────────────────────

/**
 * Validate a single submission object (from submissions/<slug>.json).
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSubmission(data) {
  const errors = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["submission must be a non-null object"] };
  }

  // tool block
  if (!data.tool || typeof data.tool !== "object") {
    errors.push("tool: required object");
  } else {
    checkString(errors, data, "tool.name", { required: true, min: 1, max: 60 });
    checkString(errors, data, "tool.slug", { required: true, min: 2, max: 50 });
    if (data.tool.slug && (typeof data.tool.slug !== "string" || !SLUG_RE.test(data.tool.slug))) {
      errors.push("tool.slug: must match /^[a-z0-9][a-z0-9-]*$/");
    }
    checkString(errors, data, "tool.repo", { required: true });
    if (data.tool.repo && !isHttpsUrl(data.tool.repo)) {
      errors.push("tool.repo: must be a valid https URL");
    }
  }

  // category + kind
  if (!data.category) {
    errors.push("category: required");
  } else if (!VALID_CATEGORIES.includes(data.category)) {
    errors.push(`category: invalid value "${data.category}"`);
  }

  if (!data.kind) {
    errors.push("kind: required");
  } else if (!VALID_KINDS.includes(data.kind)) {
    errors.push(`kind: invalid value "${data.kind}"`);
  }

  // pitch
  checkString(errors, data, "pitch", { required: true, min: 10, max: 200 });

  // goodFor
  checkArray(errors, data, "goodFor", { required: true, minItems: 1, maxItems: 5, itemMaxLen: 120 });

  // notFor (optional)
  checkArray(errors, data, "notFor", { maxItems: 3, itemMaxLen: 120 });

  // proof
  if (!data.proof || !Array.isArray(data.proof) || data.proof.length === 0) {
    errors.push("proof: at least 1 proof link required");
  } else {
    for (let i = 0; i < data.proof.length; i++) {
      const p = data.proof[i];
      if (!p || typeof p !== "object") {
        errors.push(`proof[${i}]: must be an object`);
        continue;
      }
      if (!p.label || typeof p.label !== "string") {
        errors.push(`proof[${i}].label: required string`);
      }
      if (!p.url || typeof p.url !== "string") {
        errors.push(`proof[${i}].url: required string`);
      } else if (!isHttpsUrl(p.url)) {
        errors.push(`proof[${i}].url: must be a valid https URL`);
      }
      if (!p.whatItProves || typeof p.whatItProves !== "string") {
        errors.push(`proof[${i}].whatItProves: required string`);
      }
    }
  }

  // install + quickstart (optional)
  checkString(errors, data, "install", { max: 120 });
  checkString(errors, data, "quickstart", { max: 120 });

  // maintainer
  if (!data.maintainer || typeof data.maintainer !== "object") {
    errors.push("maintainer: required object");
  } else {
    checkString(errors, data, "maintainer.handle", { required: true, min: 1 });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate the aggregate submissions.json file.
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSubmissionsJson(data) {
  const errors = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["submissions.json must be a non-null object"] };
  }

  if (!Array.isArray(data.submissions)) {
    return { valid: false, errors: ["submissions must be an array"] };
  }

  const slugs = new Set();
  for (let i = 0; i < data.submissions.length; i++) {
    const s = data.submissions[i];
    const prefix = `submissions[${i}]`;

    if (!s.slug || typeof s.slug !== "string") {
      errors.push(`${prefix}.slug: required string`);
    } else {
      if (slugs.has(s.slug)) {
        errors.push(`${prefix}.slug: duplicate "${s.slug}"`);
      }
      slugs.add(s.slug);
    }

    if (!s.status || !VALID_STATUSES.includes(s.status)) {
      errors.push(`${prefix}.status: must be one of ${VALID_STATUSES.join(", ")}`);
    }

    if (!s.lane || !VALID_LANES.includes(s.lane)) {
      errors.push(`${prefix}.lane: must be one of ${VALID_LANES.join(", ")}`);
    }

    if (!s.submittedAt || typeof s.submittedAt !== "string") {
      errors.push(`${prefix}.submittedAt: required ISO date string`);
    } else if (!ISO_DATE_RE.test(s.submittedAt)) {
      errors.push(`${prefix}.submittedAt: invalid ISO date format`);
    }

    if (s.updatedAt != null) {
      if (typeof s.updatedAt !== "string" || !ISO_DATE_RE.test(s.updatedAt)) {
        errors.push(`${prefix}.updatedAt: invalid ISO date format`);
      }
    }

    if (s.category && !VALID_CATEGORIES.includes(s.category)) {
      errors.push(`${prefix}.category: invalid value "${s.category}"`);
    }

    if (s.kind && !VALID_KINDS.includes(s.kind)) {
      errors.push(`${prefix}.kind: invalid value "${s.kind}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Pipeline ───────────────────────────────────────────────

/**
 * Validate all submissions in the submissions directory and the aggregate file.
 * @param {{ submissionsDir?: string, summaryPath?: string, dryRun?: boolean }} opts
 * @returns {{ valid: number, invalid: number, errors: string[] }}
 */
export function validateAllSubmissions(opts = {}) {
  const {
    submissionsDir = join(ROOT, "submissions"),
    summaryPath = join(ROOT, "site", "src", "data", "submissions.json"),
    dryRun = false,
  } = opts;

  const allErrors = [];
  let valid = 0;
  let invalid = 0;

  // Validate individual submission files
  if (existsSync(submissionsDir)) {
    const files = readdirSync(submissionsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(submissionsDir, file), "utf8"));
        const result = validateSubmission(data);
        if (result.valid) {
          valid++;
        } else {
          invalid++;
          for (const err of result.errors) {
            allErrors.push(`${file}: ${err}`);
          }
        }
      } catch (err) {
        invalid++;
        allErrors.push(`${file}: failed to parse JSON — ${err.message}`);
      }
    }
  }

  // Validate aggregate submissions.json
  if (existsSync(summaryPath)) {
    try {
      const data = JSON.parse(readFileSync(summaryPath, "utf8"));
      const result = validateSubmissionsJson(data);
      if (!result.valid) {
        for (const err of result.errors) {
          allErrors.push(`submissions.json: ${err}`);
        }
      }
    } catch (err) {
      allErrors.push(`submissions.json: failed to parse JSON — ${err.message}`);
    }
  }

  if (dryRun) {
    console.log("  [dry-run] Submission validation complete.");
    console.log(`    Valid: ${valid}, Invalid: ${invalid}, Errors: ${allErrors.length}`);
  }

  return { valid, invalid, errors: allErrors };
}

// ── Entry point ────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("validate-submissions.mjs");
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Validating submissions...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const result = validateAllSubmissions({ dryRun });

  console.log(`  Valid: ${result.valid}, Invalid: ${result.invalid}`);
  if (result.errors.length > 0) {
    console.log("  Errors:");
    for (const err of result.errors) {
      console.log(`    - ${err}`);
    }
    if (!dryRun) process.exit(1);
  } else {
    console.log("  No validation errors.");
  }
}

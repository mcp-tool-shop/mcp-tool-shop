#!/usr/bin/env node

/**
 * Submission Linter
 *
 * Lints submission files beyond basic validation — checks quality signals,
 * generates suggestions, and recommends promo vs experiment routing.
 *
 * Usage:
 *   node scripts/lint-submission.mjs [--dry-run] [--ci --files <paths...>]
 *
 * Reads:
 *   submissions/*.json
 *
 * Writes (when outputDir provided):
 *   lint-reports/<slug>.json
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { validateSubmission } from "./validate-submissions.mjs";

const ROOT = resolve(import.meta.dirname, "..");

// ── Lint rules ────────────────────────────────────────────────

const CI_URL_PATTERNS = [
  /github\.com\/.*\/actions/i,
  /github\.com\/.*\/workflows/i,
  /circleci\.com/i,
  /travis-ci\.(org|com)/i,
  /app\.codecov\.io/i,
  /coveralls\.io/i,
];

function looksLikeCiUrl(url) {
  return CI_URL_PATTERNS.some((re) => re.test(url));
}

/**
 * Lint a single submission object.
 * @param {object} data
 * @returns {{ grade: "pass"|"warn"|"fail", errors: string[], warnings: string[], suggestions: string[], routeSuggestion: "promo"|"experiment"|null }}
 */
export function lintSubmission(data) {
  const errors = [];
  const warnings = [];
  const suggestions = [];

  // Run base validation first
  const validation = validateSubmission(data);
  if (!validation.valid) {
    return {
      grade: "fail",
      errors: validation.errors,
      warnings: [],
      suggestions: [],
      routeSuggestion: null,
    };
  }

  // Proof link count
  if (data.proof && data.proof.length < 2) {
    warnings.push("Only 1 proof link — consider adding a demo or benchmark");
  }

  // Install + quickstart
  if (!data.install) {
    warnings.push("Missing install command — makes it harder to try");
  }
  if (!data.quickstart) {
    warnings.push("Missing quickstart command — makes it harder to try");
  }

  // notFor
  if (!data.notFor || data.notFor.length === 0) {
    suggestions.push("Adding 'notFor' helps set expectations");
  }

  // Pitch length sweet spot
  if (data.pitch) {
    if (data.pitch.length < 40) {
      suggestions.push("Pitch is very short — aim for 40–160 chars for best results");
    } else if (data.pitch.length > 160) {
      suggestions.push("Pitch is long — aim for 40–160 chars for best results");
    }
  }

  // Determine grade
  const grade = warnings.length > 0 ? "warn" : "pass";

  // Route suggestion
  let routeSuggestion = null;
  if (grade !== "fail") {
    const hasMultipleProofs = data.proof && data.proof.length >= 2;
    const hasCiProof = data.proof && data.proof.some((p) => looksLikeCiUrl(p.url));
    const hasInstall = !!data.install;

    if (hasMultipleProofs && hasCiProof && hasInstall) {
      routeSuggestion = "promo";
    } else {
      routeSuggestion = "experiment";
    }
  }

  return { grade, errors, warnings, suggestions, routeSuggestion };
}

/**
 * Format a lint result as a markdown report.
 * @param {{ grade: string, errors: string[], warnings: string[], suggestions: string[], routeSuggestion: string|null }} result
 * @param {string} slug
 * @returns {string}
 */
export function formatLintReport(result, slug) {
  const badges = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const lines = [];

  lines.push(`## Submission Lint: \`${slug}\``);
  lines.push("");
  lines.push(`**Grade:** ${badges[result.grade] || result.grade}`);
  lines.push("");

  if (result.errors.length > 0) {
    lines.push("### Errors");
    for (const e of result.errors) {
      lines.push(`- ${e}`);
    }
    lines.push("");
  }

  if (result.warnings.length > 0) {
    lines.push("### Warnings");
    for (const w of result.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  if (result.suggestions.length > 0) {
    lines.push("### Suggestions");
    for (const s of result.suggestions) {
      lines.push(`- ${s}`);
    }
    lines.push("");
  }

  if (result.routeSuggestion) {
    lines.push(`**Suggested lane:** ${result.routeSuggestion}`);
    if (result.routeSuggestion === "experiment") {
      lines.push("_Consider the experiment lane for early-stage tools that need data before a full promotion._");
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Pipeline ──────────────────────────────────────────────────

/**
 * Lint all submissions in a directory.
 * @param {{ submissionsDir?: string, outputDir?: string, dryRun?: boolean }} opts
 * @returns {{ reports: Map<string, object>, summary: string }}
 */
export function lintAllSubmissions(opts = {}) {
  const {
    submissionsDir = join(ROOT, "submissions"),
    outputDir = null,
    dryRun = false,
  } = opts;

  const reports = new Map();

  if (!existsSync(submissionsDir)) {
    return { reports, summary: "No submissions directory found." };
  }

  const files = readdirSync(submissionsDir).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const slug = basename(file, ".json");
    try {
      const data = JSON.parse(readFileSync(join(submissionsDir, file), "utf8"));
      const result = lintSubmission(data);
      reports.set(slug, result);

      if (outputDir && !dryRun) {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(
          join(outputDir, `${slug}.json`),
          JSON.stringify(result, null, 2) + "\n",
          "utf8",
        );
      }
    } catch (err) {
      reports.set(slug, {
        grade: "fail",
        errors: [`Failed to parse: ${err.message}`],
        warnings: [],
        suggestions: [],
        routeSuggestion: null,
      });
    }
  }

  const grades = { pass: 0, warn: 0, fail: 0 };
  for (const r of reports.values()) {
    grades[r.grade] = (grades[r.grade] || 0) + 1;
  }

  const summary = `Linted ${reports.size} submission(s): ${grades.pass} pass, ${grades.warn} warn, ${grades.fail} fail`;

  if (dryRun) {
    console.log(`  [dry-run] ${summary}`);
  }

  return { reports, summary };
}

// ── CI mode ───────────────────────────────────────────────────

function runCiMode(filePaths) {
  const lines = [];
  lines.push("## Submission Lint Report");
  lines.push("");

  for (const filePath of filePaths) {
    const slug = basename(filePath, ".json");
    try {
      const data = JSON.parse(readFileSync(filePath, "utf8"));
      const result = lintSubmission(data);
      lines.push(formatLintReport(result, slug));
    } catch (err) {
      lines.push(`## Submission Lint: \`${slug}\``);
      lines.push("");
      lines.push(`**Grade:** FAIL`);
      lines.push("");
      lines.push(`### Errors`);
      lines.push(`- Failed to parse JSON: ${err.message}`);
      lines.push("");
    }
  }

  const report = lines.join("\n");

  // Write report file for CI to consume
  try {
    writeFileSync("lint-report.md", report, "utf8");
    console.log("Wrote lint-report.md");
  } catch { /* fail soft */ }

  // Also print to stdout
  console.log(report);

  return report;
}

// ── Entry point ───────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("lint-submission.mjs");
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const ciMode = args.includes("--ci");

  if (ciMode) {
    const filesIdx = args.indexOf("--files");
    const filePaths = filesIdx >= 0 ? args.slice(filesIdx + 1) : [];
    if (filePaths.length === 0) {
      console.log("No submission files specified for CI lint.");
    } else {
      runCiMode(filePaths);
    }
  } else {
    console.log("Linting submissions...");
    if (dryRun) console.log("  Mode: DRY RUN");
    const result = lintAllSubmissions({ dryRun });
    console.log(`  ${result.summary}`);
  }
}

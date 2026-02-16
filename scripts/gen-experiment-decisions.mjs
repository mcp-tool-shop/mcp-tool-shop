#!/usr/bin/env node

/**
 * Experiment Decisions Generator
 *
 * Reads experiments.json, feedback-summary.json, and governance.json,
 * evaluates active experiments for winner/loser/insufficient-data status,
 * writes a separate decisions file. Does NOT modify experiments.json.
 *
 * Usage:
 *   node scripts/gen-experiment-decisions.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/experiments.json
 *   site/src/data/feedback-summary.json
 *   site/src/data/governance.json
 *
 * Writes:
 *   site/src/data/experiment-decisions.json
 *   site/public/lab/decisions/experiment-decisions.md
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");
const PUBLIC_DIR = join(ROOT, "site", "public", "lab", "decisions");

// -- Helpers ---------------------------------------------------------

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// -- Core ------------------------------------------------------------

/**
 * Evaluate active experiments against feedback data and governance thresholds.
 *
 * @param {{ schemaVersion?: number, experiments: Array<{ id: string, name: string, status: string, control: { key: string }, variant: { key: string } }> }} experiments
 * @param {{ perExperiment: Record<string, Record<string, { sent: number, opened: number, replied: number, ignored: number, bounced: number }>> }} feedbackSummary
 * @param {{ minExperimentDataThreshold: number }} governance
 * @returns {{
 *   evaluations: Array<{
 *     experimentId: string,
 *     name: string,
 *     status: "needs-more-data"|"winner-found"|"no-decision",
 *     controlEntries: number,
 *     variantEntries: number,
 *     controlReplyRate: number,
 *     variantReplyRate: number,
 *     winnerKey: string|null,
 *     recommendation: string
 *   }>,
 *   warnings: string[]
 * }}
 */
export function evaluateExperiments(experiments, feedbackSummary, governance) {
  const evaluations = [];
  const warnings = [];

  const threshold = governance.minExperimentDataThreshold || 10;
  const perExp = feedbackSummary.perExperiment || {};
  const allExperiments = experiments.experiments || [];

  // Filter to active experiments only (skip draft and concluded)
  const active = allExperiments.filter((exp) => exp.status === "active");

  if (active.length === 0) {
    warnings.push("No active experiments found");
  }

  for (const exp of active) {
    const expData = perExp[exp.id];

    // No feedback data at all for this experiment
    if (!expData) {
      evaluations.push({
        experimentId: exp.id,
        name: exp.name,
        status: "needs-more-data",
        controlEntries: 0,
        variantEntries: 0,
        controlReplyRate: 0,
        variantReplyRate: 0,
        winnerKey: null,
        recommendation: `No feedback data yet for experiment ${exp.id}`,
      });
      continue;
    }

    const controlKey = exp.control.key;
    const variantKey = exp.variant.key;

    const controlCounts = expData[controlKey] || { sent: 0, opened: 0, replied: 0, ignored: 0, bounced: 0 };
    const variantCounts = expData[variantKey] || { sent: 0, opened: 0, replied: 0, ignored: 0, bounced: 0 };

    // Compute entry counts per arm: total = sum of all outcome fields
    const controlEntries = controlCounts.sent + controlCounts.opened + controlCounts.replied + controlCounts.ignored + controlCounts.bounced;
    const variantEntries = variantCounts.sent + variantCounts.opened + variantCounts.replied + variantCounts.ignored + variantCounts.bounced;

    // Compute reply rates
    const controlReplyRate = controlCounts.replied / Math.max(controlEntries, 1);
    const variantReplyRate = variantCounts.replied / Math.max(variantEntries, 1);

    // Insufficient data check
    if (controlEntries < threshold || variantEntries < threshold) {
      evaluations.push({
        experimentId: exp.id,
        name: exp.name,
        status: "needs-more-data",
        controlEntries,
        variantEntries,
        controlReplyRate: Math.round(controlReplyRate * 10000) / 10000,
        variantReplyRate: Math.round(variantReplyRate * 10000) / 10000,
        winnerKey: null,
        recommendation: `Insufficient data: ${controlEntries} control, ${variantEntries} variant (threshold: ${threshold})`,
      });
      continue;
    }

    // Winner detection: variant outperforms control at 2x+
    if (variantReplyRate > 0 && variantReplyRate / Math.max(controlReplyRate, 0.001) > 2) {
      const ratio = Math.round(variantReplyRate / Math.max(controlReplyRate, 0.001) * 10) / 10;
      evaluations.push({
        experimentId: exp.id,
        name: exp.name,
        status: "winner-found",
        controlEntries,
        variantEntries,
        controlReplyRate: Math.round(controlReplyRate * 10000) / 10000,
        variantReplyRate: Math.round(variantReplyRate * 10000) / 10000,
        winnerKey: variantKey,
        recommendation: `Variant '${variantKey}' outperforms control at ${ratio}x reply rate`,
      });
      continue;
    }

    // Winner detection: control outperforms variant at 2x+
    if (controlReplyRate > 0 && controlReplyRate / Math.max(variantReplyRate, 0.001) > 2) {
      const ratio = Math.round(controlReplyRate / Math.max(variantReplyRate, 0.001) * 10) / 10;
      evaluations.push({
        experimentId: exp.id,
        name: exp.name,
        status: "winner-found",
        controlEntries,
        variantEntries,
        controlReplyRate: Math.round(controlReplyRate * 10000) / 10000,
        variantReplyRate: Math.round(variantReplyRate * 10000) / 10000,
        winnerKey: controlKey,
        recommendation: `Control '${controlKey}' outperforms variant at ${ratio}x reply rate`,
      });
      continue;
    }

    // No clear winner -- keep collecting
    evaluations.push({
      experimentId: exp.id,
      name: exp.name,
      status: "no-decision",
      controlEntries,
      variantEntries,
      controlReplyRate: Math.round(controlReplyRate * 10000) / 10000,
      variantReplyRate: Math.round(variantReplyRate * 10000) / 10000,
      winnerKey: null,
      recommendation: `Performance is similar (control: ${Math.round(controlReplyRate * 10000) / 10000}, variant: ${Math.round(variantReplyRate * 10000) / 10000}). Keep collecting data.`,
    });
  }

  return { evaluations, warnings };
}

/**
 * Generate markdown report from experiment evaluations.
 *
 * @param {{ evaluations: Array<object>, warnings: string[] }} result
 * @returns {string} Markdown string
 */
export function generateDecisionsMd(result) {
  const lines = [];

  lines.push("# Experiment Decisions Report");
  lines.push("");
  lines.push(`*Generated: ${new Date().toISOString().slice(0, 10)}*`);
  lines.push("");

  if (result.evaluations.length === 0) {
    lines.push("No active experiments to evaluate.");
    lines.push("");
  } else {
    lines.push("## Evaluations");
    lines.push("");
    lines.push("| Experiment | Status | Control (n) | Variant (n) | Control Rate | Variant Rate | Winner | Recommendation |");
    lines.push("|------------|--------|-------------|-------------|--------------|--------------|--------|----------------|");

    for (const ev of result.evaluations) {
      const winner = ev.winnerKey || "--";
      lines.push(`| ${ev.name} | ${ev.status} | ${ev.controlEntries} | ${ev.variantEntries} | ${ev.controlReplyRate} | ${ev.variantReplyRate} | ${winner} | ${ev.recommendation} |`);
    }
    lines.push("");
  }

  if (result.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const w of result.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// -- Pipeline --------------------------------------------------------

/**
 * Full pipeline: load data, evaluate experiments, write outputs.
 *
 * @param {{ dataDir?: string, publicDir?: string, dryRun?: boolean }} opts
 * @returns {{ evaluationCount: number, outputPath: string }}
 */
export function generateExperimentDecisions(opts = {}) {
  const { dataDir = DATA_DIR, publicDir = PUBLIC_DIR, dryRun = false } = opts;

  const experiments = safeParseJson(join(dataDir, "experiments.json"), { experiments: [] });
  const feedbackSummary = safeParseJson(join(dataDir, "feedback-summary.json"), { perExperiment: {} });
  const governance = safeParseJson(join(dataDir, "governance.json"), { minExperimentDataThreshold: 10 });

  const result = evaluateExperiments(experiments, feedbackSummary, governance);

  const outputPath = join(dataDir, "experiment-decisions.json");

  if (dryRun) {
    console.log(`  [dry-run] Would write ${result.evaluations.length} evaluations`);
    for (const ev of result.evaluations) {
      console.log(`  [dry-run]   ${ev.experimentId}: ${ev.status} -- ${ev.recommendation}`);
    }
    return { evaluationCount: result.evaluations.length, outputPath };
  }

  // Write experiment-decisions.json
  const jsonOut = {
    generatedAt: new Date().toISOString(),
    ...result,
  };
  writeFileSync(outputPath, JSON.stringify(jsonOut, null, 2) + "\n", "utf8");
  console.log(`  Wrote experiment-decisions.json (${result.evaluations.length} evaluations)`);

  // Write markdown report
  mkdirSync(publicDir, { recursive: true });
  const md = generateDecisionsMd(result);
  writeFileSync(join(publicDir, "experiment-decisions.md"), md, "utf8");
  console.log(`  Wrote experiment-decisions.md`);

  return { evaluationCount: result.evaluations.length, outputPath };
}

// -- Entry point -----------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("gen-experiment-decisions.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Evaluating experiments...");
  if (dryRun) console.log("  Mode: DRY RUN");
  const result = generateExperimentDecisions({ dryRun });
  console.log(`  Evaluations: ${result.evaluationCount}`);
}

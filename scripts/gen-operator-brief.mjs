#!/usr/bin/env node

/**
 * Operator Brief Generator
 *
 * Produces a human-readable markdown brief that summarises budget status,
 * recent run stats, top promotion decisions, experiment status, risks,
 * and suggested next actions.  Designed for quick operator review.
 *
 * Usage:
 *   node scripts/gen-operator-brief.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/baseline.json
 *   site/src/data/ops-history.json
 *   site/src/data/promo-decisions.json
 *   site/src/data/experiment-decisions.json
 *   site/src/data/feedback-summary.json
 *   site/src/data/governance.json
 *
 * Writes:
 *   site/public/lab/decisions/operator-brief.md
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");
const DECISIONS_DIR = join(ROOT, "site", "public", "lab", "decisions");

// ── Helpers ─────────────────────────────────────────────────

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// ── Core ────────────────────────────────────────────────────

/**
 * Build an operator brief from all input data.
 *
 * @param {object} inputs
 * @param {object} inputs.baseline            - baseline.json
 * @param {Array}  inputs.opsHistory          - ops-history.json
 * @param {object} inputs.promoDecisions      - promo-decisions.json
 * @param {object} inputs.experimentDecisions - experiment-decisions.json
 * @param {object} inputs.feedbackSummary     - feedback-summary.json
 * @param {object} inputs.governance          - governance.json
 * @returns {{ sections: object, markdown: string }}
 */
export function buildOperatorBrief(inputs) {
  const {
    baseline = {},
    opsHistory = [],
    promoDecisions = {},
    experimentDecisions = {},
    feedbackSummary = {},
    governance = {},
  } = inputs;

  // ── 1. Budget status ──────────────────────────────────────

  const minuteBudgets = baseline.minuteBudgets || {};
  const tier200 = minuteBudgets["200"] || minuteBudgets[200] || {};
  const headroom = tier200.headroom ?? 0;
  const recommendedPreset = tier200.recommendedPreset || "default";
  const tierValue = 200;
  const warning =
    headroom < tierValue * 0.2
      ? `Low headroom: ${headroom} min remaining (< 20% of ${tierValue}-minute tier)`
      : null;

  const budgetStatus = {
    tier: tierValue,
    headroom,
    recommendedPreset,
    warning,
  };

  // ── 2. Last run stats ─────────────────────────────────────

  let lastRunStats;
  if (opsHistory.length === 0) {
    lastRunStats = { date: null, durationMs: 0, slugCount: 0, errors: 0 };
  } else {
    const last = opsHistory[opsHistory.length - 1];
    const promotedSlugs = Array.isArray(last.promotedSlugs)
      ? last.promotedSlugs
      : [];
    lastRunStats = {
      date: last.date || null,
      durationMs: last.durationMs || 0,
      slugCount: promotedSlugs.length,
      errors: last.errors || 0,
    };
  }

  // ── 3. Top decisions ──────────────────────────────────────

  const allDecisions = Array.isArray(promoDecisions.decisions)
    ? promoDecisions.decisions
    : [];
  const promoteDecisions = allDecisions.filter((d) => d.action === "promote");
  const sorted = [...promoteDecisions].sort((a, b) => b.score - a.score);
  const topDecisions = sorted.slice(0, 3).map((d) => {
    const explanations = Array.isArray(d.explanation) ? d.explanation : [];
    return {
      slug: d.slug,
      action: d.action,
      score: d.score,
      topReason: explanations[0] || "-",
    };
  });

  // ── 4. Experiment status ──────────────────────────────────

  const evaluations = Array.isArray(experimentDecisions.evaluations)
    ? experimentDecisions.evaluations
    : [];
  const experimentStatus = evaluations.map((ev) => ({
    experimentId: ev.experimentId,
    status: ev.status,
    recommendation: ev.recommendation,
  }));

  // ── 5. Risks ──────────────────────────────────────────────

  const riskSources = [];
  const projectionRisks = baseline.projection?.riskItems;
  if (Array.isArray(projectionRisks)) {
    riskSources.push(...projectionRisks);
  }
  const promoWarnings = promoDecisions.warnings;
  if (Array.isArray(promoWarnings)) {
    riskSources.push(...promoWarnings);
  }
  const expWarnings = experimentDecisions.warnings;
  if (Array.isArray(expWarnings)) {
    riskSources.push(...expWarnings);
  }
  const risks = riskSources.slice(0, 5);

  // ── 6. Suggested actions ──────────────────────────────────

  const suggestedActions = [];

  const hasActiveExperiments =
    evaluations.length > 0 &&
    evaluations.some((ev) => ev.status !== "inactive" && ev.status !== "ended");
  if (evaluations.length === 0 || !hasActiveExperiments) {
    suggestedActions.push("Create an A/B test experiment");
  }

  if (suggestedActions.length < 3 && (tier200.headroom ?? 0) < 50) {
    suggestedActions.push("Reduce frequency or use conservative preset");
  }

  if (
    suggestedActions.length < 3 &&
    evaluations.some((ev) => ev.status === "winner-found")
  ) {
    suggestedActions.push(
      "Review experiment winner and update experiments.json"
    );
  }

  if (suggestedActions.length < 3 && allDecisions.length === 0) {
    suggestedActions.push("Add slugs to promo-queue.json");
  }

  // Cap at 3
  suggestedActions.splice(3);

  // ── Build sections object ─────────────────────────────────

  const sections = {
    budgetStatus,
    lastRunStats,
    topDecisions,
    experimentStatus,
    risks,
    suggestedActions,
  };

  // ── Build markdown ────────────────────────────────────────

  const lines = [];

  lines.push("# Operator Brief");
  lines.push("");
  lines.push(`*Generated: ${new Date().toISOString().slice(0, 10)}*`);
  lines.push("");

  // Budget Status
  lines.push("## Budget Status");
  lines.push("");
  lines.push(`- **Tier:** ${budgetStatus.tier} min/month`);
  lines.push(`- **Headroom:** ${budgetStatus.headroom} min`);
  lines.push(`- **Recommended preset:** ${budgetStatus.recommendedPreset}`);
  if (budgetStatus.warning) {
    lines.push(`- **Warning:** ${budgetStatus.warning}`);
  }
  lines.push("");

  // Last Run
  lines.push("## Last Run");
  lines.push("");
  if (lastRunStats.date === null) {
    lines.push("No runs yet.");
  } else {
    lines.push(`- **Date:** ${lastRunStats.date}`);
    lines.push(`- **Duration:** ${lastRunStats.durationMs} ms`);
    lines.push(`- **Slugs promoted:** ${lastRunStats.slugCount}`);
    lines.push(`- **Errors:** ${lastRunStats.errors}`);
  }
  lines.push("");

  // Top Decisions
  lines.push("## Top Decisions");
  lines.push("");
  if (topDecisions.length > 0) {
    lines.push("| Slug | Action | Score | Top Reason |");
    lines.push("|------|--------|-------|------------|");
    for (const d of topDecisions) {
      lines.push(`| ${d.slug} | ${d.action} | ${d.score} | ${d.topReason} |`);
    }
  } else {
    lines.push("No promote decisions this cycle.");
  }
  lines.push("");

  // Experiments
  lines.push("## Experiments");
  lines.push("");
  if (experimentStatus.length > 0) {
    lines.push("| Experiment | Status | Recommendation |");
    lines.push("|------------|--------|----------------|");
    for (const e of experimentStatus) {
      lines.push(
        `| ${e.experimentId} | ${e.status} | ${e.recommendation} |`
      );
    }
  } else {
    lines.push("No experiments evaluated.");
  }
  lines.push("");

  // Risks
  lines.push("## Risks");
  lines.push("");
  if (risks.length > 0) {
    for (const r of risks) {
      lines.push(`- ${r}`);
    }
  } else {
    lines.push("No risks identified.");
  }
  lines.push("");

  // Suggested Actions
  lines.push("## Suggested Actions");
  lines.push("");
  if (suggestedActions.length > 0) {
    for (const a of suggestedActions) {
      lines.push(`- ${a}`);
    }
  } else {
    lines.push("No actions suggested.");
  }
  lines.push("");

  const markdown = lines.join("\n");

  return { sections, markdown };
}

// ── Pipeline ────────────────────────────────────────────────

/**
 * Full pipeline: load data, build brief, write output.
 *
 * @param {{ dataDir?: string, decisionsDir?: string, dryRun?: boolean }} opts
 * @returns {{ outputPath: string|null }}
 */
export function generateOperatorBrief(opts = {}) {
  const {
    dataDir = DATA_DIR,
    decisionsDir = DECISIONS_DIR,
    dryRun = false,
  } = opts;

  // Load all inputs
  const baseline = safeParseJson(join(dataDir, "baseline.json"), {});
  const opsHistory = safeParseJson(join(dataDir, "ops-history.json"), []);
  const promoDecisions = safeParseJson(
    join(dataDir, "promo-decisions.json"),
    {}
  );
  const experimentDecisions = safeParseJson(
    join(dataDir, "experiment-decisions.json"),
    {}
  );
  const feedbackSummary = safeParseJson(
    join(dataDir, "feedback-summary.json"),
    {}
  );
  const governance = safeParseJson(join(dataDir, "governance.json"), {});

  const result = buildOperatorBrief({
    baseline,
    opsHistory,
    promoDecisions,
    experimentDecisions,
    feedbackSummary,
    governance,
  });

  if (dryRun) {
    console.log("  [dry-run] Would write operator-brief.md");
    console.log(
      `  [dry-run] Sections: budget=${result.sections.budgetStatus.tier}, risks=${result.sections.risks.length}, actions=${result.sections.suggestedActions.length}`
    );
    return { outputPath: null };
  }

  mkdirSync(decisionsDir, { recursive: true });
  const outputPath = join(decisionsDir, "operator-brief.md");
  writeFileSync(outputPath, result.markdown, "utf8");
  console.log("  Wrote operator-brief.md");

  return { outputPath };
}

// ── Entry point ─────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-operator-brief.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating operator brief...");
  if (dryRun) console.log("  Mode: DRY RUN");
  const result = generateOperatorBrief({ dryRun });
  console.log(`  Wrote: ${result.outputPath || "(dry-run)"}`);
}

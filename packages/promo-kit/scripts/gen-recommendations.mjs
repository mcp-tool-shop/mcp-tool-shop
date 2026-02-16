#!/usr/bin/env node
/**
 * gen-recommendations.mjs
 *
 * Advisory recommendation engine. Analyzes telemetry rollups, queue health,
 * governance data, and lint reports to surface actionable insights.
 *
 * All recommendations are advisory — humans decide, the system proposes.
 *
 * Usage:
 *   node scripts/gen-recommendations.mjs [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig, getRoot } from "./lib/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = getRoot();
const config = getConfig();
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

// ── Valid category enum ─────────────────────────────────────

export const VALID_CATEGORIES = [
  "re-feature",
  "improve-proof",
  "stuck-submission",
  "experiment-graduation",
  "lint-promotion",
];

export const VALID_PRIORITIES = ["high", "medium", "low"];

// ── Signal Computation (pure exports) ───────────────────────

/**
 * Compute Proof Engagement Score per tool from telemetry rollup.
 * ProofEngagement = click_evidence_link + copy_proof_bullets
 * @param {Record<string, Record<string, number>>} bySlug - rollup.bySlug
 * @returns {Record<string, number>} slug → score
 */
export function computeProofEngagementBySlug(bySlug) {
  if (!bySlug || typeof bySlug !== "object") return {};
  const scores = {};
  for (const [slug, counts] of Object.entries(bySlug)) {
    const clicks = counts.click_evidence_link || 0;
    const bullets = counts.copy_proof_bullets || 0;
    const score = clicks + bullets;
    if (score > 0) scores[slug] = score;
  }
  return scores;
}

/**
 * Compute Submission Friction Score per submission.
 * Friction = lint warning count + needs-info penalty (2) + stuck penalty (1 if >7d)
 * @param {object[]} submissions - submissions.json .submissions array
 * @param {Record<string, object>} lintReports - slug → { errors, warnings }
 * @param {{ now?: Date }} opts
 * @returns {Record<string, number>} slug → friction score
 */
export function computeSubmissionFrictionBySlug(submissions, lintReports = {}, opts = {}) {
  if (!Array.isArray(submissions)) return {};
  const now = opts.now || new Date();
  const scores = {};

  for (const sub of submissions) {
    if (!sub.slug) continue;
    const lint = lintReports[sub.slug] || {};
    const warningCount = (lint.warnings || []).length;
    const needsInfoPenalty = sub.status === "needs-info" ? 2 : 0;

    let stuckPenalty = 0;
    if ((sub.status === "pending" || sub.status === "needs-info") && sub.submittedAt) {
      const days = Math.floor((now.getTime() - new Date(sub.submittedAt).getTime()) / (1000 * 60 * 60 * 24));
      if (days > 7) stuckPenalty = 1;
    }

    const score = warningCount + needsInfoPenalty + stuckPenalty;
    if (score > 0) scores[sub.slug] = score;
  }

  return scores;
}

// ── Category Finders ────────────────────────────────────────

/**
 * Find tools with high proof engagement that aren't currently featured.
 * @param {object} signals
 * @param {object} overrides
 * @returns {object[]}
 */
function findHighTrustTools(signals, overrides = {}) {
  const results = [];
  const engagement = signals.proofEngagementBySlug || {};

  const sorted = Object.entries(engagement)
    .sort((a, b) => b[1] - a[1])
    .filter(([slug]) => !overrides[slug]?.featured);

  for (const [slug, score] of sorted.slice(0, 5)) {
    if (score > 5) {
      results.push({
        priority: "high",
        category: "re-feature",
        slug,
        title: `Re-feature ${slug}`,
        insight: `High proof engagement score (${score}) — users actively checking evidence`,
        action: `Consider adding "${slug}" to featured collection or promo queue`,
        evidence: { proofEngagementScore: score, currentlyFeatured: false },
      });
    }
  }

  return results.slice(0, 3);
}

/**
 * Find tools with high install copies but low proof engagement.
 * @param {object} signals
 * @param {object} rollup
 * @returns {object[]}
 */
function findLowProofEngagementTools(signals, rollup = {}) {
  const results = [];
  const bySlug = rollup.bySlug || {};
  const engagement = signals.proofEngagementBySlug || {};

  for (const [slug, counts] of Object.entries(bySlug)) {
    const installs = counts.copy_install || 0;
    const proofScore = engagement[slug] || 0;

    if (installs > 5 && proofScore < 2) {
      results.push({
        priority: "medium",
        category: "improve-proof",
        slug,
        title: `Improve proof for ${slug}`,
        insight: `${installs} install copies but only ${proofScore} proof interactions`,
        action: `Review publicProof quality — add demo, benchmark, or better evidence links`,
        evidence: { installCopies: installs, proofEngagementScore: proofScore },
      });
    }
  }

  return results
    .sort((a, b) => b.evidence.installCopies - a.evidence.installCopies)
    .slice(0, 3);
}

/**
 * Find submissions with high friction scores.
 * @param {object} signals
 * @param {object} submissions
 * @returns {object[]}
 */
function findHighFrictionSubmissions(signals, submissions = {}) {
  const results = [];
  const subs = submissions.submissions || [];
  const friction = signals.submissionFrictionBySlug || {};

  for (const sub of subs) {
    const score = friction[sub.slug] || 0;
    if (score >= 3 && (sub.status === "pending" || sub.status === "needs-info")) {
      results.push({
        priority: "high",
        category: "stuck-submission",
        slug: sub.slug,
        title: `Review stuck submission: ${sub.slug}`,
        insight: `Friction score ${score} — status: ${sub.status}`,
        action: `Provide guidance to submitter or escalate for manual review`,
        evidence: { frictionScore: score, status: sub.status, submittedAt: sub.submittedAt },
      });
    }
  }

  return results
    .sort((a, b) => b.evidence.frictionScore - a.evidence.frictionScore)
    .slice(0, 3);
}

/**
 * Find experiments that have found a winner and are ready to graduate.
 * @param {object} experimentDecisions
 * @returns {object[]}
 */
function findReadyExperiments(experimentDecisions = {}) {
  const results = [];
  const evaluations = experimentDecisions.evaluations || [];

  for (const ev of evaluations) {
    if (ev.status === "winner-found") {
      results.push({
        priority: "medium",
        category: "experiment-graduation",
        slug: ev.experimentId,
        title: `Graduate experiment: ${ev.experimentId}`,
        insight: `Winner found — variant "${ev.winnerKey}" outperformed`,
        action: `Apply winning variant to overrides.json and conclude experiment`,
        evidence: {
          experimentId: ev.experimentId,
          winnerKey: ev.winnerKey,
          recommendation: ev.recommendation || "",
        },
      });
    }
  }

  return results.slice(0, 3);
}

/**
 * Analyze lint failure patterns from queue health data.
 * @param {object} queueHealth
 * @returns {{ warningsToElevate: object[], docsToRewrite: object[] }}
 */
function analyzeLintPatterns(queueHealth = {}) {
  const topFailures = queueHealth.topLintFailures || [];
  const warningsToElevate = [];
  const docsToRewrite = [];

  for (const failure of topFailures) {
    if (failure.count > 3) {
      warningsToElevate.push({
        warning: failure.reason,
        count: failure.count,
        suggestion: `Promote to error — ${failure.count} occurrences indicate systemic gap`,
      });
    }
  }

  // Cluster needs-info patterns — look for repeated lint warnings as signals
  // that the submission docs need rewriting
  const docTopics = {};
  for (const failure of topFailures) {
    const reason = failure.reason.toLowerCase();
    if (reason.includes("install")) docTopics["install command"] = (docTopics["install command"] || 0) + failure.count;
    if (reason.includes("quickstart")) docTopics["quickstart"] = (docTopics["quickstart"] || 0) + failure.count;
    if (reason.includes("proof")) docTopics["proof links"] = (docTopics["proof links"] || 0) + failure.count;
    if (reason.includes("pitch")) docTopics["pitch format"] = (docTopics["pitch format"] || 0) + failure.count;
  }

  for (const [topic, count] of Object.entries(docTopics)) {
    if (count > 3) {
      docsToRewrite.push({
        topic,
        occurrences: count,
        suggestion: `Rewrite submission guide section on "${topic}" — ${count} failures suggest unclear docs`,
      });
    }
  }

  return { warningsToElevate, docsToRewrite };
}

/**
 * Build lint-promotion recommendations from lint insights.
 * @param {{ warningsToElevate: object[], docsToRewrite: object[] }} lintInsights
 * @returns {object[]}
 */
function buildLintRecommendations(lintInsights) {
  const results = [];

  for (const item of (lintInsights.warningsToElevate || []).slice(0, 3)) {
    results.push({
      priority: "low",
      category: "lint-promotion",
      slug: item.warning,
      title: `Promote lint warning: "${item.warning}"`,
      insight: `Appears ${item.count} times — consistent failure pattern`,
      action: item.suggestion,
      evidence: { warning: item.warning, count: item.count },
    });
  }

  return results;
}

// ── Main Orchestrator ───────────────────────────────────────

/**
 * Build all recommendations from input data.
 * @param {object} inputs
 * @param {{ maxRecommendations?: number }} opts
 * @returns {object}
 */
export function buildRecommendations(inputs, opts = {}) {
  const { maxRecommendations = 20 } = opts;

  // Compute signals
  const trustByWeek = inputs.rollup?.metrics?.trustInteractionScoreByWeek || {};
  const proofEngagementBySlug = computeProofEngagementBySlug(inputs.rollup?.bySlug || {});
  const submissionFrictionBySlug = computeSubmissionFrictionBySlug(
    inputs.submissions?.submissions || [],
    inputs.lintReports || {},
    { now: opts.now },
  );

  const signals = { trustByWeek, proofEngagementBySlug, submissionFrictionBySlug };

  // Gather recommendations from all categories
  const recommendations = [];

  recommendations.push(...findHighTrustTools(signals, inputs.overrides || {}));
  recommendations.push(...findLowProofEngagementTools(signals, inputs.rollup || {}));
  recommendations.push(...findHighFrictionSubmissions(signals, inputs.submissions || {}));
  recommendations.push(...findReadyExperiments(inputs.experimentDecisions || {}));

  // Lint patterns analysis
  const lintInsights = analyzeLintPatterns(inputs.queueHealth || {});
  recommendations.push(...buildLintRecommendations(lintInsights));

  // Sort by priority (high first)
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

  return {
    generatedAt: new Date().toISOString(),
    signals,
    recommendations: recommendations.slice(0, maxRecommendations),
    guardrails: {
      dailyEventCaps: { max: 500 },
      suspiciousSources: [],
      multiEventCorroboration: true,
    },
    lintInsights,
  };
}

// ── Pipeline ────────────────────────────────────────────────

function loadJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Generate recommendations from data files.
 * @param {object} opts
 */
export function genRecommendations(opts = {}) {
  const {
    rollupPath = path.join(ROOT, config.paths.dataDir, "telemetry", "rollup.json"),
    queueHealthPath = path.join(ROOT, config.paths.dataDir, "queue-health.json"),
    worthyPath = path.join(ROOT, config.paths.dataDir, "worthy.json"),
    overridesPath = path.join(ROOT, config.paths.dataDir, "overrides.json"),
    submissionsPath = path.join(ROOT, config.paths.dataDir, "submissions.json"),
    experimentsPath = path.join(ROOT, config.paths.dataDir, "experiments.json"),
    experimentDecisionsPath = path.join(ROOT, config.paths.dataDir, "experiment-decisions.json"),
    lintDir = path.join(ROOT, config.paths.dataDir, "lint-reports"),
    outputPath = path.join(ROOT, config.paths.dataDir, "recommendations.json"),
    dryRun = false,
  } = opts;

  console.log("Generating recommendations...");
  console.log(`  Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);

  // Load all inputs (fail-soft)
  const inputs = {
    rollup: loadJsonSafe(rollupPath),
    queueHealth: loadJsonSafe(queueHealthPath),
    worthy: loadJsonSafe(worthyPath),
    overrides: loadJsonSafe(overridesPath),
    submissions: loadJsonSafe(submissionsPath),
    experiments: loadJsonSafe(experimentsPath),
    experimentDecisions: loadJsonSafe(experimentDecisionsPath),
    lintReports: {},
  };

  // Load lint reports if directory exists
  try {
    if (fs.existsSync(lintDir)) {
      const files = fs.readdirSync(lintDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const slug = file.replace(/\.json$/, "");
        const report = loadJsonSafe(path.join(lintDir, file));
        if (report) inputs.lintReports[slug] = report;
      }
    }
  } catch { /* fail soft */ }

  const result = buildRecommendations(inputs);

  if (dryRun) {
    console.log(`  [dry-run] Recommendation generation complete.`);
  } else {
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
    console.log(`  Wrote ${outputPath}`);
  }

  console.log(`    Recommendations: ${result.recommendations.length}`);
  console.log(`    Signals: ${Object.keys(result.signals.proofEngagementBySlug).length} tools with engagement`);
  console.log(`    Lint insights: ${result.lintInsights.warningsToElevate.length} warnings to elevate`);

  return result;
}

// ── CLI ─────────────────────────────────────────────────────

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  genRecommendations({ dryRun });
}

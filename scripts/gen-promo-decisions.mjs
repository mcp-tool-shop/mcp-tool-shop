#!/usr/bin/env node

/**
 * Promo Decision Engine
 *
 * Deterministic scoring algorithm that evaluates promo-queue candidates
 * across four dimensions (proof, engagement, freshness, worthiness) and
 * applies budget constraints + experiment analysis to produce promote /
 * skip / defer decisions.
 *
 * Usage:
 *   node scripts/gen-promo-decisions.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/ops-history.json
 *   site/src/data/feedback-summary.json
 *   site/src/data/experiments.json
 *   site/src/data/worthy.json
 *   site/src/data/promo-queue.json
 *   site/src/data/baseline.json
 *   site/src/data/overrides.json
 *   site/src/data/governance.json
 *
 * Writes:
 *   site/src/data/promo-decisions.json
 *   site/public/lab/decisions/promo-decisions.md
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

// ── Scoring helpers ─────────────────────────────────────────

/**
 * Proof score (0-30): +15 if publicProof exists, +3 per proven claim (max 5).
 */
function computeProofScore(slug, overrides) {
  const entry = overrides[slug] || {};
  let score = 0;
  const parts = [];

  if (entry.publicProof) {
    score += 15;
    parts.push("+15 publicProof");
  }

  const claimsCount = Array.isArray(entry.provenClaims)
    ? Math.min(entry.provenClaims.length, 5)
    : 0;
  const claimsPoints = claimsCount * 3;
  score += claimsPoints;

  if (claimsCount > 0) {
    parts.push(`proven claims: ${claimsCount} -> +${claimsPoints}`);
  }

  return {
    score,
    explanation: `publicProof: ${parts.length > 0 ? parts.join(", ") : "+0"} (total proof: ${score})`,
  };
}

/**
 * Engagement score (0-30): reply rate mapped to 30-point scale.
 */
function computeEngagementScore(slug, feedbackSummary) {
  const slugData = feedbackSummary?.perSlug?.[slug];
  if (!slugData) {
    return { score: 0, explanation: "engagement: no data -> +0" };
  }

  const sent = slugData.sent || 0;
  const opened = slugData.opened || 0;
  const replied = slugData.replied || 0;
  const ignored = slugData.ignored || 0;
  const bounced = slugData.bounced || 0;
  const total = sent + opened + replied + ignored + bounced;

  const replyRate = total > 0 ? replied / total : 0;
  const score = Math.round(replyRate * 30);

  return {
    score,
    explanation: `engagement: replyRate ${replyRate.toFixed(2)} -> +${score}`,
  };
}

/**
 * Freshness score (0-20): full 20 if beyond cooldown or no history,
 * 0 if within cooldown (also flags as "defer").
 */
function computeFreshnessScore(slug, opsHistory, cooldownDays) {
  const now = Date.now();

  // Find most recent promotion for this slug in ops history
  let lastPromoDate = null;
  for (const entry of opsHistory) {
    const promoted = entry.promotedSlugs || entry.slugs || [];
    const slugList = Array.isArray(promoted) ? promoted : [];
    if (slugList.includes(slug)) {
      lastPromoDate = entry.date || null;
      break; // history is newest-first
    }
  }

  if (!lastPromoDate) {
    return {
      score: 20,
      defer: false,
      explanation: `freshness: no prior promotion -> +20`,
    };
  }

  const daysSince = Math.floor(
    (now - new Date(lastPromoDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSince < cooldownDays) {
    return {
      score: 0,
      defer: true,
      explanation: `DEFER: within cooldown (promoted ${daysSince}d ago, cooldown ${cooldownDays}d)`,
    };
  }

  return {
    score: 20,
    defer: false,
    explanation: `freshness: last promoted ${daysSince}d ago (cooldown ${cooldownDays}d) -> +20`,
  };
}

/**
 * Worthy score (0-20): +20 if worthy.repos[slug].worthy === true.
 */
function computeWorthyScore(slug, worthy) {
  const isWorthy = worthy?.repos?.[slug]?.worthy === true;
  const worthyEntry = worthy?.repos?.[slug];
  const worthyScoreVal = worthyEntry?.score ?? 0;

  return {
    score: isWorthy ? 20 : 0,
    explanation: `worthy: score ${worthyScoreVal} -> ${isWorthy ? "+20" : "+0"}`,
  };
}

// ── Core ────────────────────────────────────────────────────

/**
 * Build promotion decisions from all input data.
 *
 * @param {object} inputs
 * @param {object} inputs.promoQueue      - promo-queue.json
 * @param {object} inputs.promo           - promo.json
 * @param {object} inputs.overrides       - overrides.json
 * @param {object} inputs.worthy          - worthy.json
 * @param {object} inputs.feedbackSummary - feedback-summary.json
 * @param {Array}  inputs.opsHistory      - ops-history.json (newest first)
 * @param {object} inputs.baseline        - baseline.json
 * @param {object} inputs.governance      - governance.json
 * @param {object} inputs.experiments     - experiments.json
 * @returns {{ decisions: Array, budget: object, warnings: string[] }}
 */
export function buildDecisions(inputs) {
  const {
    promoQueue = {},
    promo = {},
    overrides = {},
    worthy = {},
    feedbackSummary = {},
    opsHistory = [],
    baseline = {},
    governance = {},
    experiments = {},
  } = inputs;

  const warnings = [];
  const cooldownDays = governance.cooldownDaysPerSlug || 14;
  const maxPromosPerWeek = governance.maxPromosPerWeek || 3;
  const minExpThreshold = governance.minExperimentDataThreshold || 10;

  // ── Budget logic ────────────────────────────────────────

  const minuteBudgets = baseline.minuteBudgets || {};
  const tier200 = minuteBudgets["200"] || minuteBudgets[200] || null;
  const avgMinutesPerRun = baseline.avgMinutesPerRun || 0;

  const budgetTier = 200;
  const budgetHeadroom = tier200 ? tier200.headroom : 200;

  let itemsAllowed;
  if (avgMinutesPerRun === 0) {
    itemsAllowed = maxPromosPerWeek;
  } else {
    itemsAllowed = Math.min(
      maxPromosPerWeek,
      Math.floor(budgetHeadroom / avgMinutesPerRun)
    );
  }

  const budget = {
    tier: budgetTier,
    headroom: budgetHeadroom,
    itemsAllowed,
  };

  if (itemsAllowed === 0 && avgMinutesPerRun > 0) {
    warnings.push(
      `Budget headroom (${budgetHeadroom} min) insufficient for even one run (avg ${avgMinutesPerRun} min/run)`
    );
  }

  // ── Gather candidates from promo queue ──────────────────

  const rawSlugs = promoQueue.slugs || [];
  const candidateSlugs = rawSlugs.map((s) =>
    typeof s === "string" ? s : s.slug
  );

  if (candidateSlugs.length === 0) {
    warnings.push("Promo queue is empty — no candidates to evaluate");
  }

  // ── Build experiment lookup ─────────────────────────────

  const activeExperiments = {};
  for (const exp of experiments.experiments || []) {
    if (exp.status === "active" && exp.slug) {
      activeExperiments[exp.slug] = activeExperiments[exp.slug] || [];
      activeExperiments[exp.slug].push(exp);
    }
  }

  // ── Score each candidate ────────────────────────────────

  const scored = [];

  for (const slug of candidateSlugs) {
    const explanation = [];

    const proof = computeProofScore(slug, overrides);
    explanation.push(proof.explanation);

    const engagement = computeEngagementScore(slug, feedbackSummary);
    explanation.push(engagement.explanation);

    const freshness = computeFreshnessScore(slug, opsHistory, cooldownDays);
    explanation.push(freshness.explanation);

    const worthiness = computeWorthyScore(slug, worthy);
    explanation.push(worthiness.explanation);

    const totalScore =
      proof.score + engagement.score + freshness.score + worthiness.score;

    // Experiment analysis (inline)
    const slugExperiments = activeExperiments[slug] || [];
    for (const exp of slugExperiments) {
      const expData = feedbackSummary?.perExperiment?.[exp.id];
      if (!expData) {
        explanation.push(
          `experiment ${exp.id}: no feedback data available`
        );
        continue;
      }

      const arms = Object.entries(expData);
      const allAboveThreshold =
        arms.length >= 2 &&
        arms.every(([, stats]) => (stats.entries || 0) >= minExpThreshold);

      if (!allAboveThreshold) {
        explanation.push(
          `experiment ${exp.id}: insufficient data (need >=${minExpThreshold} per arm)`
        );
        continue;
      }

      // Find best and second-best arm by reply rate or entries
      const armScores = arms
        .map(([key, stats]) => ({
          key,
          entries: stats.entries || 0,
          replied: stats.replied || 0,
          rate: (stats.entries || 0) > 0
            ? (stats.replied || 0) / (stats.entries || 0)
            : 0,
        }))
        .sort((a, b) => b.rate - a.rate);

      const best = armScores[0];
      const second = armScores[1];

      if (second && second.rate > 0) {
        const ratio = Math.round((best.rate / second.rate) * 100) / 100;
        if (ratio > 2) {
          explanation.push(
            `experiment ${exp.id}: variant ${best.key} outperforms at ${ratio}x`
          );
        } else {
          explanation.push(
            `experiment ${exp.id}: no clear winner (best ${best.key} at ${ratio}x, needs >2x)`
          );
        }
      } else if (best) {
        explanation.push(
          `experiment ${exp.id}: only variant ${best.key} has replies — no comparison possible`
        );
      }
    }

    scored.push({
      slug,
      score: totalScore,
      defer: freshness.defer,
      explanation,
    });
  }

  // ── Sort and assign actions ─────────────────────────────

  scored.sort((a, b) => b.score - a.score);

  let promotedCount = 0;
  const decisions = scored.map((candidate) => {
    let action;
    if (candidate.defer) {
      action = "defer";
    } else if (promotedCount < itemsAllowed) {
      action = "promote";
      promotedCount++;
    } else {
      action = "skip";
    }

    return {
      slug: candidate.slug,
      action,
      score: candidate.score,
      explanation: candidate.explanation,
    };
  });

  return { decisions, budget, warnings };
}

// ── Markdown generator ──────────────────────────────────────

/**
 * Build a markdown summary of decisions.
 *
 * @param {{ decisions: Array, budget: object, warnings: string[] }} result
 * @returns {string}
 */
function generateDecisionsMd(result) {
  const { decisions, budget, warnings } = result;
  const lines = [];

  lines.push("# Promo Decisions");
  lines.push("");
  lines.push(`*Generated: ${new Date().toISOString().slice(0, 10)}*`);
  lines.push("");

  // Decision table
  if (decisions.length > 0) {
    lines.push("## Decisions");
    lines.push("");
    lines.push("| Slug | Action | Score | Top Reason |");
    lines.push("|------|--------|-------|------------|");
    for (const d of decisions) {
      const topReason = d.explanation[0] || "-";
      lines.push(`| ${d.slug} | ${d.action} | ${d.score} | ${topReason} |`);
    }
    lines.push("");
  } else {
    lines.push("## Decisions");
    lines.push("");
    lines.push("No candidates in queue.");
    lines.push("");
  }

  // Budget summary
  lines.push("## Budget");
  lines.push("");
  lines.push(`- **Tier:** ${budget.tier} min/month`);
  lines.push(`- **Headroom:** ${budget.headroom} min`);
  lines.push(`- **Items allowed this cycle:** ${budget.itemsAllowed}`);
  lines.push("");

  // Warnings
  if (warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const w of warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Pipeline ────────────────────────────────────────────────

/**
 * Full pipeline: load data, build decisions, write outputs.
 *
 * @param {{ dataDir?: string, decisionsDir?: string, dryRun?: boolean }} opts
 * @returns {{ decisionCount: number, outputPath: string }}
 */
export function generatePromoDecisions(opts = {}) {
  const {
    dataDir = DATA_DIR,
    decisionsDir = DECISIONS_DIR,
    dryRun = false,
  } = opts;

  // Load all inputs
  const promoQueue = safeParseJson(join(dataDir, "promo-queue.json"), {});
  const promo = safeParseJson(join(dataDir, "promo.json"), {});
  const overrides = safeParseJson(join(dataDir, "overrides.json"), {});
  const worthy = safeParseJson(join(dataDir, "worthy.json"), {});
  const feedbackSummary = safeParseJson(join(dataDir, "feedback-summary.json"), {});
  const opsHistory = safeParseJson(join(dataDir, "ops-history.json"), []);
  const baseline = safeParseJson(join(dataDir, "baseline.json"), {});
  const governance = safeParseJson(join(dataDir, "governance.json"), {});
  const experiments = safeParseJson(join(dataDir, "experiments.json"), {});

  const result = buildDecisions({
    promoQueue,
    promo,
    overrides,
    worthy,
    feedbackSummary,
    opsHistory,
    baseline,
    governance,
    experiments,
  });

  const outputPath = join(dataDir, "promo-decisions.json");

  if (dryRun) {
    console.log(`  [dry-run] Would write promo-decisions.json`);
    console.log(`  [dry-run] Would write promo-decisions.md`);
    console.log(`  [dry-run] Decisions: ${result.decisions.length}`);
    console.log(`  [dry-run] Budget: tier=${result.budget.tier}, allowed=${result.budget.itemsAllowed}`);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.log(`  [dry-run] Warning: ${w}`);
      }
    }
    return { decisionCount: result.decisions.length, outputPath };
  }

  // Write JSON
  const jsonOut = {
    generatedAt: new Date().toISOString(),
    ...result,
  };
  writeFileSync(outputPath, JSON.stringify(jsonOut, null, 2) + "\n", "utf8");
  console.log(`  Wrote promo-decisions.json (${result.decisions.length} decisions)`);

  // Write markdown
  mkdirSync(decisionsDir, { recursive: true });
  const md = generateDecisionsMd(result);
  writeFileSync(join(decisionsDir, "promo-decisions.md"), md, "utf8");
  console.log(`  Wrote promo-decisions.md`);

  return { decisionCount: result.decisions.length, outputPath };
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-promo-decisions.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating promo decisions...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const result = generatePromoDecisions({ dryRun });
  console.log(`  Decisions: ${result.decisionCount}`);
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOperatorBrief } from "../../scripts/gen-operator-brief.mjs";

function makeInputs(overrides = {}) {
  return {
    baseline: {
      minuteBudgets: {
        "200": { headroom: 200, recommendedPreset: "aggressive" },
      },
      projection: { riskItems: [] },
      avgMinutesPerRun: 0,
    },
    opsHistory: [],
    promoDecisions: { decisions: [], warnings: [] },
    experimentDecisions: { evaluations: [], warnings: [] },
    feedbackSummary: { totalEntries: 0, perChannel: {} },
    governance: { maxPromosPerWeek: 3 },
    ...overrides,
  };
}

describe("buildOperatorBrief", () => {
  it("zero-state: all empty inputs produce valid brief", () => {
    const result = buildOperatorBrief(makeInputs());
    assert.ok(result.sections, "sections should exist");
    assert.ok(result.sections.budgetStatus, "budgetStatus should exist");
    assert.ok(result.sections.lastRunStats, "lastRunStats should exist");
    assert.ok(
      Array.isArray(result.sections.topDecisions),
      "topDecisions should be an array"
    );
    assert.ok(
      Array.isArray(result.sections.experimentStatus),
      "experimentStatus should be an array"
    );
    assert.ok(
      Array.isArray(result.sections.risks),
      "risks should be an array"
    );
    assert.ok(
      Array.isArray(result.sections.suggestedActions),
      "suggestedActions should be an array"
    );
    assert.equal(typeof result.markdown, "string");
    assert.ok(result.markdown.length > 0, "markdown should be non-empty");
  });

  it("budgetStatus extracts headroom from baseline minuteBudgets", () => {
    const result = buildOperatorBrief(
      makeInputs({
        baseline: {
          minuteBudgets: {
            "200": { headroom: 180, recommendedPreset: "balanced" },
          },
          projection: { riskItems: [] },
        },
      })
    );
    assert.equal(result.sections.budgetStatus.headroom, 180);
  });

  it("budgetStatus warning when headroom < 20% of tier", () => {
    const result = buildOperatorBrief(
      makeInputs({
        baseline: {
          minuteBudgets: {
            "200": { headroom: 30, recommendedPreset: "conservative" },
          },
          projection: { riskItems: [] },
        },
      })
    );
    assert.ok(
      result.sections.budgetStatus.warning !== null &&
        typeof result.sections.budgetStatus.warning === "string",
      "warning should be a non-null string when headroom < 20% of tier"
    );
  });

  it("lastRunStats from most recent opsHistory entry", () => {
    const result = buildOperatorBrief(
      makeInputs({
        opsHistory: [
          {
            date: "2026-02-15",
            durationMs: 12000,
            promotedSlugs: ["a", "b"],
            errors: 1,
          },
        ],
      })
    );
    assert.equal(result.sections.lastRunStats.date, "2026-02-15");
    assert.equal(result.sections.lastRunStats.durationMs, 12000);
    assert.equal(result.sections.lastRunStats.slugCount, 2);
    assert.equal(result.sections.lastRunStats.errors, 1);
  });

  it("lastRunStats 'no runs' when empty history", () => {
    const result = buildOperatorBrief(makeInputs({ opsHistory: [] }));
    assert.equal(result.sections.lastRunStats.date, null);
    assert.equal(result.sections.lastRunStats.durationMs, 0);
    assert.equal(result.sections.lastRunStats.slugCount, 0);
    assert.equal(result.sections.lastRunStats.errors, 0);
  });

  it("topDecisions returns top 3 promote decisions by score", () => {
    const result = buildOperatorBrief(
      makeInputs({
        promoDecisions: {
          decisions: [
            { slug: "d1", action: "promote", score: 90, explanation: ["reason-90"] },
            { slug: "d2", action: "promote", score: 80, explanation: ["reason-80"] },
            { slug: "d3", action: "promote", score: 70, explanation: ["reason-70"] },
            { slug: "d4", action: "promote", score: 60, explanation: ["reason-60"] },
          ],
          warnings: [],
        },
      })
    );
    assert.equal(result.sections.topDecisions.length, 3);
    assert.equal(result.sections.topDecisions[0].score, 90);
    assert.equal(result.sections.topDecisions[1].score, 80);
    assert.equal(result.sections.topDecisions[2].score, 70);
  });

  it("topDecisions empty when no promote decisions", () => {
    const result = buildOperatorBrief(
      makeInputs({
        promoDecisions: {
          decisions: [
            { slug: "s1", action: "skip", score: 50, explanation: ["skipped"] },
            { slug: "s2", action: "defer", score: 40, explanation: ["deferred"] },
          ],
          warnings: [],
        },
      })
    );
    assert.equal(result.sections.topDecisions.length, 0);
  });

  it("experimentStatus lists evaluations", () => {
    const result = buildOperatorBrief(
      makeInputs({
        experimentDecisions: {
          evaluations: [
            { experimentId: "exp-1", status: "active", recommendation: "continue" },
            { experimentId: "exp-2", status: "winner-found", recommendation: "adopt variant-b" },
          ],
          warnings: [],
        },
      })
    );
    assert.equal(result.sections.experimentStatus.length, 2);
    assert.equal(result.sections.experimentStatus[0].experimentId, "exp-1");
    assert.equal(result.sections.experimentStatus[1].status, "winner-found");
  });

  it("risks aggregates from multiple sources, capped at 5", () => {
    const result = buildOperatorBrief(
      makeInputs({
        baseline: {
          minuteBudgets: {
            "200": { headroom: 200, recommendedPreset: "aggressive" },
          },
          projection: {
            riskItems: ["risk-a", "risk-b", "risk-c"],
          },
        },
        promoDecisions: {
          decisions: [],
          warnings: ["promo-warn-1", "promo-warn-2", "promo-warn-3"],
        },
      })
    );
    assert.equal(
      result.sections.risks.length,
      5,
      "risks should be capped at 5"
    );
  });

  it("suggestedActions: suggests experiment when none active", () => {
    const result = buildOperatorBrief(
      makeInputs({
        experimentDecisions: { evaluations: [], warnings: [] },
      })
    );
    assert.ok(
      result.sections.suggestedActions.some((a) =>
        a.toLowerCase().includes("experiment")
      ),
      "should suggest creating an experiment"
    );
  });

  it("suggestedActions: suggests review winner when winner-found", () => {
    const result = buildOperatorBrief(
      makeInputs({
        experimentDecisions: {
          evaluations: [
            { experimentId: "exp-1", status: "winner-found", recommendation: "adopt variant-a" },
          ],
          warnings: [],
        },
      })
    );
    assert.ok(
      result.sections.suggestedActions.some((a) =>
        a.includes("Review experiment winner")
      ),
      "should suggest reviewing experiment winner"
    );
  });

  it("markdown includes all section headers", () => {
    const result = buildOperatorBrief(makeInputs());
    assert.ok(
      result.markdown.includes("## Budget Status"),
      "markdown should contain ## Budget Status"
    );
    assert.ok(
      result.markdown.includes("## Last Run"),
      "markdown should contain ## Last Run"
    );
    assert.ok(
      result.markdown.includes("## Top Decisions"),
      "markdown should contain ## Top Decisions"
    );
    assert.ok(
      result.markdown.includes("## Experiments"),
      "markdown should contain ## Experiments"
    );
    assert.ok(
      result.markdown.includes("## Risks"),
      "markdown should contain ## Risks"
    );
    assert.ok(
      result.markdown.includes("## Suggested Actions"),
      "markdown should contain ## Suggested Actions"
    );
  });
});

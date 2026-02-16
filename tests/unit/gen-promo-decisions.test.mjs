import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDecisions } from "../../scripts/gen-promo-decisions.mjs";

function makeInputs(overrides = {}) {
  return {
    promoQueue: { week: "2026-02-17", slugs: [], promotionType: "own" },
    promo: { enabled: true },
    overrides: {},
    worthy: { repos: {} },
    feedbackSummary: { perSlug: {}, perExperiment: {} },
    opsHistory: [],
    baseline: { avgMinutesPerRun: 0, minuteBudgets: { "200": { headroom: 200 } } },
    governance: { maxPromosPerWeek: 3, cooldownDaysPerSlug: 14, minExperimentDataThreshold: 10 },
    experiments: { experiments: [] },
    ...overrides,
  };
}

describe("buildDecisions", () => {
  it("empty queue returns zero decisions", () => {
    const result = buildDecisions(makeInputs());
    assert.equal(result.decisions.length, 0);
    assert.ok(
      result.warnings.some((w) => w.toLowerCase().includes("empty")),
      "warnings should mention empty queue"
    );
  });

  it("scores publicProof correctly (+15)", () => {
    const result = buildDecisions(
      makeInputs({
        promoQueue: { week: "2026-02-17", slugs: ["test-tool"], promotionType: "own" },
        overrides: { "test-tool": { publicProof: true } },
      })
    );
    const d = result.decisions.find((d) => d.slug === "test-tool");
    assert.ok(d, "decision for test-tool should exist");
    assert.ok(d.score >= 15, `score should be >= 15, got ${d.score}`);
    assert.ok(
      d.explanation.some((e) => e.includes("publicProof")),
      "explanation should mention publicProof"
    );
  });

  it("scores engagement from perSlug replyRate", () => {
    const result = buildDecisions(
      makeInputs({
        promoQueue: { week: "2026-02-17", slugs: ["tool-a"], promotionType: "own" },
        feedbackSummary: {
          perSlug: {
            "tool-a": { sent: 5, opened: 2, replied: 3, ignored: 0, bounced: 0 },
          },
          perExperiment: {},
        },
      })
    );
    const d = result.decisions.find((d) => d.slug === "tool-a");
    assert.ok(d, "decision for tool-a should exist");
    // total = 5+2+3+0+0 = 10, replyRate = 3/10 = 0.3, engagementScore = round(0.3*30) = 9
    assert.ok(
      d.explanation.some((e) => e.includes("engagement")),
      "explanation should mention engagement"
    );
    // Engagement contributes 9, freshness 20 (no history), so score includes 9
    assert.ok(d.score >= 9, `score should include engagement points, got ${d.score}`);
  });

  it("scores freshness: full points beyond cooldown", () => {
    const result = buildDecisions(
      makeInputs({
        promoQueue: { week: "2026-02-17", slugs: ["tool-a"], promotionType: "own" },
        opsHistory: [{ date: "2026-01-01", promotedSlugs: ["tool-a"] }],
      })
    );
    const d = result.decisions.find((d) => d.slug === "tool-a");
    assert.ok(d, "decision for tool-a should exist");
    assert.notEqual(d.action, "defer", "should not be deferred beyond cooldown");
    assert.ok(
      d.explanation.some((e) => e.includes("freshness")),
      "explanation should mention freshness"
    );
    // freshness = 20 since 2026-01-01 is well beyond 14 days from now
    assert.ok(d.score >= 20, `score should include 20 freshness points, got ${d.score}`);
  });

  it("scores freshness: zero + defer within cooldown", () => {
    const recentDate = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const result = buildDecisions(
      makeInputs({
        promoQueue: { week: "2026-02-17", slugs: ["tool-a"], promotionType: "own" },
        opsHistory: [{ date: recentDate, promotedSlugs: ["tool-a"] }],
      })
    );
    const d = result.decisions.find((d) => d.slug === "tool-a");
    assert.ok(d, "decision for tool-a should exist");
    assert.equal(d.action, "defer", "should be deferred within cooldown");
    assert.ok(
      d.explanation.some((e) => e.includes("DEFER")),
      "explanation should contain DEFER"
    );
  });

  it("scores worthy correctly (+20)", () => {
    const result = buildDecisions(
      makeInputs({
        promoQueue: { week: "2026-02-17", slugs: ["tool-a"], promotionType: "own" },
        worthy: { repos: { "tool-a": { worthy: true, score: 5 } } },
      })
    );
    const d = result.decisions.find((d) => d.slug === "tool-a");
    assert.ok(d, "decision for tool-a should exist");
    // worthy = 20, freshness = 20 (no history), engagement = 0, proof = 0 => total = 40
    assert.ok(d.score >= 20, `score should include 20 worthy points, got ${d.score}`);
    assert.ok(
      d.explanation.some((e) => e.includes("worthy")),
      "explanation should mention worthy"
    );
  });

  it("sorts by totalScore descending, caps at maxPromosPerWeek", () => {
    const result = buildDecisions(
      makeInputs({
        promoQueue: {
          week: "2026-02-17",
          slugs: ["s1", "s2", "s3", "s4", "s5"],
          promotionType: "own",
        },
        overrides: {
          s1: { publicProof: true, provenClaims: ["a", "b", "c", "d", "e"] }, // proof: 15+15=30
          s2: { publicProof: true, provenClaims: ["a", "b"] },                // proof: 15+6=21
          s3: { publicProof: true },                                           // proof: 15
          s4: {},                                                              // proof: 0
          s5: {},                                                              // proof: 0
        },
        governance: { maxPromosPerWeek: 2, cooldownDaysPerSlug: 14, minExperimentDataThreshold: 10 },
      })
    );

    assert.equal(result.decisions.length, 5);

    // First 2 should be "promote", rest "skip"
    const promoted = result.decisions.filter((d) => d.action === "promote");
    const skipped = result.decisions.filter((d) => d.action === "skip");
    assert.equal(promoted.length, 2, "exactly 2 should be promoted");
    assert.equal(skipped.length, 3, "remaining 3 should be skipped");

    // Verify descending score order
    assert.ok(
      result.decisions[0].score >= result.decisions[1].score,
      "decisions should be sorted by score descending"
    );
  });

  it("caps at budget headroom (itemsAllowed = 0 when no headroom)", () => {
    const result = buildDecisions(
      makeInputs({
        promoQueue: { week: "2026-02-17", slugs: ["tool-a"], promotionType: "own" },
        overrides: { "tool-a": { publicProof: true } },
        baseline: { avgMinutesPerRun: 50, minuteBudgets: { "200": { headroom: 10 } } },
      })
    );
    const d = result.decisions.find((d) => d.slug === "tool-a");
    assert.ok(d, "decision for tool-a should exist");
    assert.equal(d.action, "skip", "should be skipped when budget insufficient");
    assert.ok(
      result.warnings.some((w) => w.toLowerCase().includes("budget") || w.toLowerCase().includes("headroom")),
      "warnings should mention budget"
    );
    assert.equal(result.budget.itemsAllowed, 0, "itemsAllowed should be 0");
  });

  it("explanation array includes rule hits with numbers", () => {
    const result = buildDecisions(
      makeInputs({
        promoQueue: { week: "2026-02-17", slugs: ["tool-a"], promotionType: "own" },
        overrides: { "tool-a": { publicProof: true, provenClaims: ["claim1", "claim2"] } },
        worthy: { repos: { "tool-a": { worthy: true, score: 5 } } },
      })
    );
    const d = result.decisions.find((d) => d.slug === "tool-a");
    assert.ok(d, "decision for tool-a should exist");

    // Each explanation entry should be a non-empty string
    for (const entry of d.explanation) {
      assert.equal(typeof entry, "string");
      assert.ok(entry.length > 0, "explanation entry should not be empty");
    }

    // At least 4 entries: proof, engagement, freshness, worthy
    assert.ok(
      d.explanation.length >= 4,
      `explanation should have >= 4 entries, got ${d.explanation.length}`
    );
  });

  it("handles empty opsHistory (full freshness for all)", () => {
    const result = buildDecisions(
      makeInputs({
        promoQueue: { week: "2026-02-17", slugs: ["tool-a"], promotionType: "own" },
        opsHistory: [],
      })
    );
    const d = result.decisions.find((d) => d.slug === "tool-a");
    assert.ok(d, "decision for tool-a should exist");
    assert.notEqual(d.action, "defer", "should not be deferred with empty opsHistory");
    // freshness should be 20 (no prior promotion)
    assert.ok(d.score >= 20, `score should include 20 freshness points, got ${d.score}`);
  });

  it("handles missing feedbackSummary gracefully", () => {
    const result = buildDecisions(
      makeInputs({
        promoQueue: { week: "2026-02-17", slugs: ["tool-a"], promotionType: "own" },
        feedbackSummary: {},
      })
    );
    const d = result.decisions.find((d) => d.slug === "tool-a");
    assert.ok(d, "decision for tool-a should exist");
    // Engagement score should be 0 when no perSlug data
    assert.ok(
      d.explanation.some((e) => e.includes("engagement") && e.includes("0")),
      "engagement explanation should show 0"
    );
  });

  it("defer does not count against itemsAllowed budget", () => {
    const recentDate = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const result = buildDecisions(
      makeInputs({
        promoQueue: {
          week: "2026-02-17",
          slugs: ["deferred-tool", "good-tool"],
          promotionType: "own",
        },
        overrides: { "good-tool": { publicProof: true } },
        opsHistory: [{ date: recentDate, promotedSlugs: ["deferred-tool"] }],
        governance: { maxPromosPerWeek: 1, cooldownDaysPerSlug: 14, minExperimentDataThreshold: 10 },
      })
    );

    const deferred = result.decisions.find((d) => d.slug === "deferred-tool");
    const good = result.decisions.find((d) => d.slug === "good-tool");

    assert.ok(deferred, "deferred-tool decision should exist");
    assert.ok(good, "good-tool decision should exist");
    assert.equal(deferred.action, "defer", "deferred-tool should be deferred");
    assert.equal(good.action, "promote", "good-tool should be promoted (defer doesn't consume budget)");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeProofEngagementBySlug,
  computeSubmissionFrictionBySlug,
  buildRecommendations,
  VALID_CATEGORIES,
  VALID_PRIORITIES,
} from "../../scripts/gen-recommendations.mjs";

// ── Factory Helper ───────────────────────────────────────────

function makeInputs(overrides = {}) {
  return {
    rollup: {
      totalEvents: 0,
      byType: {},
      bySlug: {},
      byWeek: {},
      metrics: { trustInteractionScoreByWeek: {} },
    },
    queueHealth: {
      stuckCount: 0,
      stuckSlugs: [],
      topLintFailures: [],
      byStatus: {},
    },
    worthy: { repos: {} },
    overrides: {},
    submissions: { submissions: [] },
    experiments: { experiments: [] },
    experimentDecisions: { evaluations: [], warnings: [] },
    lintReports: {},
    ...overrides,
  };
}

// ── computeProofEngagementBySlug ─────────────────────────────

describe("computeProofEngagementBySlug", () => {
  it("empty input returns empty object", () => {
    assert.deepEqual(computeProofEngagementBySlug({}), {});
    assert.deepEqual(computeProofEngagementBySlug(null), {});
    assert.deepEqual(computeProofEngagementBySlug(undefined), {});
  });

  it("single tool computes correct score", () => {
    const bySlug = {
      "tool-a": { click_evidence_link: 5, copy_proof_bullets: 3, copy_install: 10 },
    };
    const result = computeProofEngagementBySlug(bySlug);
    assert.equal(result["tool-a"], 8); // 5 + 3
  });

  it("multiple tools compute independently", () => {
    const bySlug = {
      "tool-a": { click_evidence_link: 5, copy_proof_bullets: 3 },
      "tool-b": { click_evidence_link: 1, copy_proof_bullets: 0 },
      "tool-c": { copy_install: 10 }, // no proof events → excluded
    };
    const result = computeProofEngagementBySlug(bySlug);
    assert.equal(result["tool-a"], 8);
    assert.equal(result["tool-b"], 1);
    assert.ok(!("tool-c" in result)); // zero score excluded
  });
});

// ── computeSubmissionFrictionBySlug ──────────────────────────

describe("computeSubmissionFrictionBySlug", () => {
  it("empty submissions returns empty object", () => {
    assert.deepEqual(computeSubmissionFrictionBySlug([], {}), {});
    assert.deepEqual(computeSubmissionFrictionBySlug(null, {}), {});
  });

  it("lint warnings count toward friction", () => {
    const subs = [
      { slug: "my-tool", status: "pending", submittedAt: "2026-02-14T00:00:00Z" },
    ];
    const lintReports = {
      "my-tool": { errors: [], warnings: ["Missing install", "Missing quickstart"] },
    };
    const result = computeSubmissionFrictionBySlug(subs, lintReports, {
      now: new Date("2026-02-15T00:00:00Z"),
    });
    assert.equal(result["my-tool"], 2); // 2 warnings, 1 day pending (not stuck)
  });

  it("needs-info adds penalty of 2", () => {
    const subs = [
      { slug: "stuck-tool", status: "needs-info", submittedAt: "2026-02-14T00:00:00Z" },
    ];
    const result = computeSubmissionFrictionBySlug(subs, {}, {
      now: new Date("2026-02-15T00:00:00Z"),
    });
    assert.equal(result["stuck-tool"], 2); // needs-info penalty only
  });

  it("stuck (>7d) adds penalty of 1", () => {
    const subs = [
      { slug: "old-one", status: "pending", submittedAt: "2026-02-01T00:00:00Z" },
    ];
    const result = computeSubmissionFrictionBySlug(subs, {}, {
      now: new Date("2026-02-15T00:00:00Z"),
    });
    assert.equal(result["old-one"], 1); // stuck penalty only (>7d)
  });
});

// ── buildRecommendations ─────────────────────────────────────

describe("buildRecommendations", () => {
  it("empty inputs produces no recommendations", () => {
    const result = buildRecommendations(makeInputs());
    assert.equal(result.recommendations.length, 0);
    assert.ok(result.generatedAt);
    assert.ok(result.signals);
    assert.ok(result.guardrails);
    assert.ok(result.lintInsights);
  });

  it("high-trust tool generates re-feature recommendation", () => {
    const inputs = makeInputs({
      rollup: {
        totalEvents: 100,
        byType: {},
        bySlug: {
          "popular-tool": {
            click_evidence_link: 10,
            copy_proof_bullets: 5,
          },
        },
        byWeek: {},
        metrics: { trustInteractionScoreByWeek: {} },
      },
    });
    const result = buildRecommendations(inputs);
    const reFeature = result.recommendations.filter((r) => r.category === "re-feature");
    assert.ok(reFeature.length > 0, "should have re-feature recommendation");
    assert.equal(reFeature[0].slug, "popular-tool");
    assert.equal(reFeature[0].priority, "high");
  });

  it("high-install low-proof tool generates improve-proof recommendation", () => {
    const inputs = makeInputs({
      rollup: {
        totalEvents: 100,
        byType: {},
        bySlug: {
          "low-proof-tool": { copy_install: 20 }, // high installs, no proof events
        },
        byWeek: {},
        metrics: { trustInteractionScoreByWeek: {} },
      },
    });
    const result = buildRecommendations(inputs);
    const improveProof = result.recommendations.filter((r) => r.category === "improve-proof");
    assert.ok(improveProof.length > 0, "should have improve-proof recommendation");
    assert.equal(improveProof[0].slug, "low-proof-tool");
  });

  it("high-friction submission generates stuck-submission recommendation", () => {
    const inputs = makeInputs({
      submissions: {
        submissions: [
          {
            slug: "stuck-sub",
            status: "needs-info",
            submittedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
      lintReports: {
        "stuck-sub": {
          errors: [],
          warnings: ["Missing install", "Missing proof link", "Missing quickstart"],
        },
      },
    });
    const result = buildRecommendations(inputs, { now: new Date("2026-02-15T00:00:00Z") });
    const stuck = result.recommendations.filter((r) => r.category === "stuck-submission");
    assert.ok(stuck.length > 0, "should have stuck-submission recommendation");
    assert.equal(stuck[0].slug, "stuck-sub");
  });

  it("winner-found experiment generates graduation recommendation", () => {
    const inputs = makeInputs({
      experimentDecisions: {
        evaluations: [
          {
            experimentId: "exp-001",
            status: "winner-found",
            winnerKey: "variant-b",
            recommendation: "Apply variant B",
          },
        ],
        warnings: [],
      },
    });
    const result = buildRecommendations(inputs);
    const grad = result.recommendations.filter((r) => r.category === "experiment-graduation");
    assert.ok(grad.length > 0, "should have experiment-graduation recommendation");
    assert.equal(grad[0].slug, "exp-001");
  });

  it("topLintFailures generates lint-promotion recommendations + lintInsights", () => {
    const inputs = makeInputs({
      queueHealth: {
        stuckCount: 0,
        stuckSlugs: [],
        topLintFailures: [
          { reason: "Missing install command", count: 8 },
          { reason: "Missing quickstart", count: 5 },
          { reason: "Only 1 proof link", count: 2 }, // below threshold
        ],
        byStatus: {},
      },
    });
    const result = buildRecommendations(inputs);
    const lint = result.recommendations.filter((r) => r.category === "lint-promotion");
    assert.ok(lint.length >= 2, "should have at least 2 lint-promotion recs");
    assert.ok(result.lintInsights.warningsToElevate.length >= 2);
    // "Only 1 proof link" has count 2, below threshold of 3 — excluded
    assert.ok(!result.lintInsights.warningsToElevate.some((w) => w.warning === "Only 1 proof link"));
  });

  it("respects maxRecommendations cap", () => {
    const inputs = makeInputs({
      rollup: {
        totalEvents: 1000,
        byType: {},
        bySlug: {
          "a": { click_evidence_link: 10, copy_proof_bullets: 10 },
          "b": { click_evidence_link: 10, copy_proof_bullets: 10 },
          "c": { click_evidence_link: 10, copy_proof_bullets: 10 },
          "d": { click_evidence_link: 10, copy_proof_bullets: 10 },
          "e": { click_evidence_link: 10, copy_proof_bullets: 10 },
        },
        byWeek: {},
        metrics: { trustInteractionScoreByWeek: {} },
      },
    });
    const result = buildRecommendations(inputs, { maxRecommendations: 2 });
    assert.ok(result.recommendations.length <= 2);
  });

  it("priority sorting: high before medium before low", () => {
    const inputs = makeInputs({
      rollup: {
        totalEvents: 100,
        byType: {},
        bySlug: {
          "high-engage": { click_evidence_link: 10, copy_proof_bullets: 5 },
          "low-proof": { copy_install: 20 },
        },
        byWeek: {},
        metrics: { trustInteractionScoreByWeek: {} },
      },
      queueHealth: {
        stuckCount: 0,
        stuckSlugs: [],
        topLintFailures: [{ reason: "Missing install", count: 5 }],
        byStatus: {},
      },
    });
    const result = buildRecommendations(inputs);
    if (result.recommendations.length >= 2) {
      const priorities = result.recommendations.map((r) => r.priority);
      const order = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < priorities.length; i++) {
        assert.ok(
          order[priorities[i]] >= order[priorities[i - 1]],
          `priorities should be non-decreasing: ${priorities.join(", ")}`
        );
      }
    }
  });
});

// ── Exported constants ───────────────────────────────────────

describe("exported constants", () => {
  it("VALID_CATEGORIES has 5 entries", () => {
    assert.equal(VALID_CATEGORIES.length, 5);
  });

  it("VALID_PRIORITIES has 3 entries", () => {
    assert.equal(VALID_PRIORITIES.length, 3);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFeedbackLines, computeFeedbackSummary } from "../../scripts/gen-feedback-summary.mjs";

describe("parseFeedbackLines", () => {
  it("handles empty input", () => {
    assert.deepStrictEqual(parseFeedbackLines(""), []);
    assert.deepStrictEqual(parseFeedbackLines("\n\n"), []);
  });

  it("skips malformed lines", () => {
    const content = [
      '{"date":"2026-02-17","slug":"tool-a","channel":"email","outcome":"sent"}',
      'not valid json',
      '{"date":"2026-02-17"}',  // missing required fields
      '',
      '{"date":"2026-02-17","slug":"tool-b","channel":"dm","outcome":"replied"}',
    ].join("\n");

    const result = parseFeedbackLines(content);
    assert.equal(result.length, 2);
    assert.equal(result[0].slug, "tool-a");
    assert.equal(result[1].slug, "tool-b");
  });
});

describe("computeFeedbackSummary", () => {
  it("aggregates per-channel correctly", () => {
    const entries = [
      { date: "2026-02-17", slug: "tool-a", channel: "email", outcome: "sent" },
      { date: "2026-02-17", slug: "tool-a", channel: "email", outcome: "replied" },
      { date: "2026-02-17", slug: "tool-b", channel: "dm", outcome: "ignored" },
    ];

    const summary = computeFeedbackSummary(entries);
    assert.equal(summary.perChannel.email.sent, 1);
    assert.equal(summary.perChannel.email.replied, 1);
    assert.equal(summary.perChannel.dm.ignored, 1);
  });

  it("aggregates per-slug correctly", () => {
    const entries = [
      { date: "2026-02-17", slug: "tool-a", channel: "email", outcome: "sent" },
      { date: "2026-02-17", slug: "tool-a", channel: "dm", outcome: "replied" },
      { date: "2026-02-17", slug: "tool-b", channel: "email", outcome: "bounced" },
    ];

    const summary = computeFeedbackSummary(entries);
    assert.equal(summary.perSlug["tool-a"].sent, 1);
    assert.equal(summary.perSlug["tool-a"].replied, 1);
    assert.equal(summary.perSlug["tool-b"].bounced, 1);
  });

  it("generates recommendation for high-reply channel", () => {
    // 3 entries in "email" channel, 2 replied = 67% reply rate (>50%)
    const entries = [
      { date: "2026-02-17", slug: "t", channel: "email", outcome: "replied" },
      { date: "2026-02-17", slug: "t", channel: "email", outcome: "replied" },
      { date: "2026-02-17", slug: "t", channel: "email", outcome: "sent" },
    ];

    const summary = computeFeedbackSummary(entries);
    assert.ok(
      summary.recommendations.some(r => r.includes("email") && r.includes("performs well")),
      "should recommend high-performing email channel"
    );
  });

  it("generates recommendation for underperforming channel", () => {
    // 10 entries in "dm", 8 ignored = 80% ignored rate (>70%)
    const entries = [];
    for (let i = 0; i < 8; i++) {
      entries.push({ date: "2026-02-17", slug: "t", channel: "dm", outcome: "ignored" });
    }
    entries.push({ date: "2026-02-17", slug: "t", channel: "dm", outcome: "sent" });
    entries.push({ date: "2026-02-17", slug: "t", channel: "dm", outcome: "opened" });

    const summary = computeFeedbackSummary(entries);
    assert.ok(
      summary.recommendations.some(r => r.includes("dm") && r.includes("underperforming")),
      "should flag underperforming dm channel"
    );
  });

  it("empty entries produces zero-state", () => {
    const summary = computeFeedbackSummary([]);
    assert.equal(summary.totalEntries, 0);
    assert.equal(summary.replyRate, 0);
    assert.equal(summary.bestPerformingChannel, null);
    assert.deepStrictEqual(summary.perChannel, {});
    assert.deepStrictEqual(summary.perSlug, {});
    assert.deepStrictEqual(summary.recommendations, []);
    assert.deepStrictEqual(summary.perExperiment, {});
  });
});

describe("computeFeedbackSummary - experiment variants", () => {
  it("aggregates perExperiment correctly", () => {
    const entries = [
      { date: "2026-03-01", slug: "tool-a", channel: "email", outcome: "sent", experimentId: "exp-001", variantKey: "control" },
      { date: "2026-03-01", slug: "tool-a", channel: "email", outcome: "replied", experimentId: "exp-001", variantKey: "control" },
      { date: "2026-03-01", slug: "tool-a", channel: "email", outcome: "sent", experimentId: "exp-001", variantKey: "variant-a" },
      { date: "2026-03-01", slug: "tool-a", channel: "email", outcome: "replied", experimentId: "exp-001", variantKey: "variant-a" },
      { date: "2026-03-01", slug: "tool-a", channel: "email", outcome: "replied", experimentId: "exp-001", variantKey: "variant-a" },
    ];

    const summary = computeFeedbackSummary(entries);
    assert.ok(summary.perExperiment["exp-001"], "must have exp-001");
    assert.equal(summary.perExperiment["exp-001"]["control"].sent, 1);
    assert.equal(summary.perExperiment["exp-001"]["control"].replied, 1);
    assert.equal(summary.perExperiment["exp-001"]["variant-a"].sent, 1);
    assert.equal(summary.perExperiment["exp-001"]["variant-a"].replied, 2);
  });

  it("entries without experimentId do not appear in perExperiment", () => {
    const entries = [
      { date: "2026-03-01", slug: "tool-a", channel: "email", outcome: "sent" },
      { date: "2026-03-01", slug: "tool-a", channel: "dm", outcome: "replied" },
    ];

    const summary = computeFeedbackSummary(entries);
    assert.deepStrictEqual(summary.perExperiment, {});
  });

  it("experiment recommendation for variant outperforming control", () => {
    // Control: 6 entries, 1 replied (17%). Variant: 6 entries, 4 replied (67%). Ratio ~3.9x
    const entries = [];
    for (let i = 0; i < 5; i++) entries.push({ date: "2026-03-01", slug: "t", channel: "email", outcome: "sent", experimentId: "exp-002", variantKey: "control" });
    entries.push({ date: "2026-03-01", slug: "t", channel: "email", outcome: "replied", experimentId: "exp-002", variantKey: "control" });
    for (let i = 0; i < 2; i++) entries.push({ date: "2026-03-01", slug: "t", channel: "email", outcome: "sent", experimentId: "exp-002", variantKey: "variant-b" });
    for (let i = 0; i < 4; i++) entries.push({ date: "2026-03-01", slug: "t", channel: "email", outcome: "replied", experimentId: "exp-002", variantKey: "variant-b" });

    const summary = computeFeedbackSummary(entries);
    assert.ok(
      summary.recommendations.some(r => r.includes("exp-002") && r.includes("outperforms")),
      "should recommend variant outperforming control"
    );
  });

  it("experiment recommendation for insufficient data", () => {
    // Only 2 entries per arm (< 5)
    const entries = [
      { date: "2026-03-01", slug: "t", channel: "email", outcome: "sent", experimentId: "exp-003", variantKey: "control" },
      { date: "2026-03-01", slug: "t", channel: "email", outcome: "replied", experimentId: "exp-003", variantKey: "control" },
      { date: "2026-03-01", slug: "t", channel: "email", outcome: "sent", experimentId: "exp-003", variantKey: "variant-c" },
      { date: "2026-03-01", slug: "t", channel: "email", outcome: "replied", experimentId: "exp-003", variantKey: "variant-c" },
    ];

    const summary = computeFeedbackSummary(entries);
    assert.ok(
      summary.recommendations.some(r => r.includes("exp-003") && r.includes("insufficient")),
      "should flag insufficient data"
    );
  });

  it("mixed experiment and non-experiment entries both aggregate", () => {
    const entries = [
      { date: "2026-03-01", slug: "tool-a", channel: "email", outcome: "sent" },
      { date: "2026-03-01", slug: "tool-a", channel: "email", outcome: "sent", experimentId: "exp-004", variantKey: "control" },
    ];

    const summary = computeFeedbackSummary(entries);
    assert.equal(summary.totalEntries, 2);
    assert.equal(summary.perChannel.email.sent, 2);
    assert.ok(summary.perExperiment["exp-004"], "experiment entries tracked");
    assert.equal(summary.perExperiment["exp-004"]["control"].sent, 1);
  });

  it("perExperiment zero state when no experiment entries exist", () => {
    const entries = [
      { date: "2026-03-01", slug: "tool-a", channel: "email", outcome: "sent" },
    ];

    const summary = computeFeedbackSummary(entries);
    assert.deepStrictEqual(summary.perExperiment, {});
  });
});

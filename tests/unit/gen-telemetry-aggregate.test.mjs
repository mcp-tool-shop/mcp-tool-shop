import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseEventsFile,
  aggregateEvents,
  computeMetrics,
  VALID_EVENT_TYPES,
} from "../../scripts/gen-telemetry-aggregate.mjs";

// ── parseEventsFile ──────────────────────────────────────────

describe("parseEventsFile", () => {
  it("parses valid JSONL", () => {
    const content = [
      JSON.stringify({ type: "copy_install", timestamp: "2026-02-01T00:00:00Z", payload: { slug: "foo" } }),
      JSON.stringify({ type: "copy_bundle", timestamp: "2026-02-01T01:00:00Z", payload: { week: "2026-W05" } }),
    ].join("\n");
    const events = parseEventsFile(content);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "copy_install");
    assert.equal(events[1].type, "copy_bundle");
  });

  it("skips malformed lines", () => {
    const content = [
      '{"type": "copy_install", "timestamp": "2026-02-01T00:00:00Z", "payload": {}}',
      "NOT JSON",
      '{"type": "copy_bundle", "timestamp": "2026-02-01T01:00:00Z", "payload": {}}',
      "{}",  // missing type and timestamp
    ].join("\n");
    const events = parseEventsFile(content);
    assert.equal(events.length, 2);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(parseEventsFile(""), []);
    assert.deepEqual(parseEventsFile("  \n  "), []);
    assert.deepEqual(parseEventsFile(null), []);
    assert.deepEqual(parseEventsFile(undefined), []);
  });
});

// ── aggregateEvents ──────────────────────────────────────────

describe("aggregateEvents", () => {
  const sampleEvents = [
    { type: "copy_install", timestamp: "2026-02-01T10:00:00Z", payload: { slug: "tool-a" } },
    { type: "copy_install", timestamp: "2026-02-01T11:00:00Z", payload: { slug: "tool-b" } },
    { type: "copy_bundle", timestamp: "2026-02-01T12:00:00Z", payload: { week: "2026-W05" } },
    { type: "copy_proof_link", timestamp: "2026-02-01T13:00:00Z", payload: { week: "2026-W05", slug: "tool-a" } },
    { type: "click_evidence_link", timestamp: "2026-02-01T14:00:00Z", payload: { slug: "tool-a", evidenceType: "image" } },
  ];

  it("groups by type correctly", () => {
    const result = aggregateEvents(sampleEvents);
    assert.equal(result.byType.copy_install, 2);
    assert.equal(result.byType.copy_bundle, 1);
    assert.equal(result.byType.copy_proof_link, 1);
    assert.equal(result.byType.click_evidence_link, 1);
  });

  it("groups by slug correctly", () => {
    const result = aggregateEvents(sampleEvents);
    assert.equal(result.bySlug["tool-a"].copy_install, 1);
    assert.equal(result.bySlug["tool-b"].copy_install, 1);
    assert.equal(result.bySlug["tool-a"].copy_proof_link, 1);
    assert.equal(result.bySlug["tool-a"].click_evidence_link, 1);
  });

  it("groups by week correctly", () => {
    const result = aggregateEvents(sampleEvents);
    assert.equal(result.byWeek["2026-W05"].copy_bundle, 1);
    assert.equal(result.byWeek["2026-W05"].copy_proof_link, 1);
  });

  it("empty events returns zero-state", () => {
    const result = aggregateEvents([]);
    assert.equal(result.totalEvents, 0);
    assert.deepEqual(result.byType, {});
    assert.deepEqual(result.bySlug, {});
    assert.deepEqual(result.byWeek, {});
  });

  it("multiple events for same type accumulate", () => {
    const events = [
      { type: "copy_install", timestamp: "2026-02-01T10:00:00Z", payload: { slug: "x" } },
      { type: "copy_install", timestamp: "2026-02-01T11:00:00Z", payload: { slug: "x" } },
      { type: "copy_install", timestamp: "2026-02-01T12:00:00Z", payload: { slug: "y" } },
    ];
    const result = aggregateEvents(events);
    assert.equal(result.byType.copy_install, 3);
    assert.equal(result.bySlug["x"].copy_install, 2);
    assert.equal(result.bySlug["y"].copy_install, 1);
  });

  it("totalEvents matches event count", () => {
    const result = aggregateEvents(sampleEvents);
    assert.equal(result.totalEvents, sampleEvents.length);
  });

  it("has generatedAt ISO string", () => {
    const result = aggregateEvents(sampleEvents);
    assert.ok(result.generatedAt);
    assert.ok(!isNaN(new Date(result.generatedAt).getTime()));
  });
});

// ── computeMetrics ───────────────────────────────────────────

describe("computeMetrics", () => {
  it("verification rate calculated correctly", () => {
    const byType = { copy_proof_link: 10, copy_bundle: 5, copy_verify_cmd: 5 };
    const metrics = computeMetrics(byType);
    // rate = 5 / (10 + 5 + 5) = 0.25
    assert.equal(metrics.verificationRate, 0.25);
    assert.equal(metrics.totalVerifyActions, 20);
  });

  it("division by zero returns 0", () => {
    const metrics = computeMetrics({});
    assert.equal(metrics.verificationRate, 0);
    assert.equal(metrics.totalVerifyActions, 0);
  });

  it("Trust Interaction Score calculated correctly", () => {
    const byType = { copy_bundle: 3, copy_verify_cmd: 2, click_receipt_link: 1 };
    const byWeek = {
      "2026-W05": { copy_bundle: 3, copy_verify_cmd: 2, click_receipt_link: 1 },
    };
    const metrics = computeMetrics(byType, byWeek);
    assert.equal(metrics.trustInteractionScoreByWeek["2026-W05"], 6);
  });

  it("all metrics present in output", () => {
    const metrics = computeMetrics({ copy_proof_bullets: 2, copy_claim: 3, click_evidence_link: 1, click_submit_link: 4 });
    assert.ok("verificationRate" in metrics);
    assert.ok("totalVerifyActions" in metrics);
    assert.ok("totalProofActions" in metrics);
    assert.ok("submissionClicks" in metrics);
    assert.ok("trustInteractionScoreByWeek" in metrics);
    assert.equal(metrics.totalProofActions, 6);
    assert.equal(metrics.submissionClicks, 4);
  });
});

// ── Anti-Gaming Guardrails ───────────────────────────────────

describe("aggregateEvents guardrails", () => {
  it("caps events per day+type at dailyCapPerType", () => {
    // Generate 60 events of same type on same day — should be capped at 50
    const events = Array.from({ length: 60 }, (_, i) => ({
      type: "copy_install",
      timestamp: "2026-02-01T10:00:00Z",
      payload: { slug: `tool-${i}` },
    }));
    const result = aggregateEvents(events, { enableCaps: true, dailyCapPerType: 50 });
    assert.equal(result.totalEvents, 50);
    assert.equal(result.byType.copy_install, 50);
    assert.equal(result.guardrails.eventsCapped, 10);
    assert.equal(result.guardrails.totalEventsProcessed, 60);
  });

  it("flags suspicious days exceeding spikeThreshold", () => {
    // Create events across 2 types to get above spike threshold
    const events = [];
    for (let i = 0; i < 200; i++) {
      events.push({ type: "copy_install", timestamp: "2026-02-01T10:00:00Z", payload: { slug: "a" } });
      events.push({ type: "copy_bundle", timestamp: "2026-02-01T11:00:00Z", payload: { slug: "b" } });
    }
    const result = aggregateEvents(events, { enableCaps: false, spikeThreshold: 300 });
    assert.ok(result.guardrails.suspiciousDays.length > 0, "should flag suspicious day");
    assert.equal(result.guardrails.suspiciousDays[0].day, "2026-02-01");
    assert.equal(result.guardrails.suspiciousDays[0].count, 400);
  });

  it("disabling caps passes all events through", () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      type: "copy_install",
      timestamp: "2026-02-01T10:00:00Z",
      payload: { slug: "tool" },
    }));
    const result = aggregateEvents(events, { enableCaps: false });
    assert.equal(result.totalEvents, 100);
    assert.equal(result.guardrails.eventsCapped, 0);
  });
});

// ── VALID_EVENT_TYPES constant ───────────────────────────────

describe("VALID_EVENT_TYPES", () => {
  it("exports 9 event types", () => {
    assert.equal(VALID_EVENT_TYPES.length, 9);
  });

  it("includes all expected types", () => {
    const expected = [
      "copy_proof_link", "copy_bundle", "copy_verify_cmd",
      "copy_install", "copy_proof_bullets", "copy_claim",
      "click_evidence_link", "click_receipt_link", "click_submit_link",
    ];
    for (const t of expected) {
      assert.ok(VALID_EVENT_TYPES.includes(t), `missing event type: ${t}`);
    }
  });
});

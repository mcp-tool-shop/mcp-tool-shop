/**
 * Unit tests for gen-promo-calendar.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCalendar } from "../../scripts/gen-promo-calendar.mjs";

// ── Helpers ─────────────────────────────────────────────────

function makePromo(overrides = {}) {
  return { enabled: false, caps: { maxNamesPerRun: 50, failMode: "fail-closed" }, lastModified: "2026-02-16", modifiedBy: "human", ...overrides };
}

function makeQueue(overrides = {}) {
  return { week: "2026-02-17", slugs: [], promotionType: "own", notes: "", ...overrides };
}

function makeRun(overrides = {}) {
  return {
    runId: "nameops-2026-02-16",
    date: "2026-02-16T06:00:00Z",
    totalDurationMs: 120000,
    slugCount: 10,
    batchOk: true,
    costStats: { cacheHitRate: 0.83 },
    ...overrides,
  };
}

// ── buildCalendar ───────────────────────────────────────────

describe("buildCalendar", () => {
  it("frozen status detected from promo.json enabled=false", () => {
    const calendar = buildCalendar(makeQueue(), makePromo({ enabled: false }), []);
    assert.equal(calendar.freezeStatus.frozen, true);
    assert.equal(calendar.freezeStatus.since, "2026-02-16");
    assert.equal(calendar.freezeStatus.modifiedBy, "human");
  });

  it("active status detected from promo.json enabled=true", () => {
    const calendar = buildCalendar(makeQueue(), makePromo({ enabled: true }), []);
    assert.equal(calendar.freezeStatus.frozen, false);
  });

  it("last run extracted from most recent ops-history entry", () => {
    const history = [
      makeRun({ runId: "nameops-2026-02-16", date: "2026-02-16T06:00:00Z", slugCount: 10, costStats: { cacheHitRate: 0.83 } }),
      makeRun({ runId: "nameops-2026-02-09", date: "2026-02-09T06:00:00Z", slugCount: 8, costStats: { cacheHitRate: 0.75 } }),
    ];
    const calendar = buildCalendar(makeQueue(), makePromo(), history);

    assert.ok(calendar.lastRun);
    assert.equal(calendar.lastRun.runId, "nameops-2026-02-16");
    assert.equal(calendar.lastRun.slugCount, 10);
    assert.equal(calendar.lastRun.cacheHitRate, 0.83);
    assert.equal(calendar.lastRun.batchOk, true);
  });

  it("empty queue handled gracefully", () => {
    const calendar = buildCalendar({}, makePromo(), []);
    assert.equal(calendar.currentWeek.week, null);
    assert.deepEqual(calendar.currentWeek.slugs, []);
    assert.equal(calendar.currentWeek.promotionType, "own");
    assert.equal(calendar.lastRun, null);
    assert.equal(calendar.stats.totalRuns, 0);
  });

  it("channel plan defaults when queue has no slug-level channels", () => {
    const queue = makeQueue({ slugs: ["zip-meta-map", "another-tool"] });
    const calendar = buildCalendar(queue, makePromo(), []);

    // Should use default channels
    assert.ok(calendar.channelPlan.includes("presskit"));
    assert.ok(calendar.channelPlan.includes("snippets"));
    assert.ok(calendar.channelPlan.includes("campaigns"));
  });

  it("custom channels extracted from slug entries", () => {
    const queue = makeQueue({
      slugs: [
        { slug: "tool-a", channels: ["presskit"] },
        { slug: "tool-b", channels: ["snippets", "campaigns"] },
      ],
    });
    const calendar = buildCalendar(queue, makePromo(), []);

    assert.ok(calendar.channelPlan.includes("presskit"));
    assert.ok(calendar.channelPlan.includes("snippets"));
    assert.ok(calendar.channelPlan.includes("campaigns"));
  });
});

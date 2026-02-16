/**
 * Unit tests for gen-ops-actions.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeOpsHistory, buildCapsDiff } from "../../scripts/gen-ops-actions.mjs";

// ── Helpers ─────────────────────────────────────────────────

function makeRun(overrides = {}) {
  return {
    runId: "nameops-2026-02-16",
    date: "2026-02-16T06:00:00Z",
    totalDurationMs: 120000,
    slugCount: 10,
    batchOk: true,
    validationOk: true,
    publishErrors: 0,
    costStats: {
      totalApiCalls: 30,
      cachedCalls: 25,
      cacheHitRate: 0.83,
      adapterBreakdown: {
        npm: { calls: 10, cached: 8 },
        pypi: { calls: 10, cached: 9 },
        github: { calls: 10, cached: 8 },
      },
    },
    errorCodes: {},
    minutesEstimate: 2,
    ...overrides,
  };
}

// ── analyzeOpsHistory ───────────────────────────────────────

describe("analyzeOpsHistory", () => {
  it("cache below 0.70 emits warning with adapter name", () => {
    const run = makeRun({
      costStats: {
        totalApiCalls: 20,
        cachedCalls: 10,
        cacheHitRate: 0.5,
        adapterBreakdown: {
          npm: { calls: 10, cached: 3 },   // 30% — below threshold
          pypi: { calls: 10, cached: 9 },   // 90% — fine
        },
      },
    });

    const actions = analyzeOpsHistory([run]);
    const cacheWarnings = actions.filter((a) => a.category === "cache");
    assert.equal(cacheWarnings.length, 1, "should emit exactly 1 cache warning");
    assert.ok(cacheWarnings[0].message.includes("npm"), "should name the adapter");
    assert.equal(cacheWarnings[0].level, "warning");
  });

  it("cache above 0.70 emits no warning", () => {
    const run = makeRun(); // default has all adapters above 70%
    const actions = analyzeOpsHistory([run]);
    const cacheWarnings = actions.filter((a) => a.category === "cache");
    assert.equal(cacheWarnings.length, 0);
  });

  it("error codes mapped to runbook sections", () => {
    const run = makeRun({
      errorCodes: { RATE_LIMIT: 3, TIMEOUT: 1 },
    });

    const actions = analyzeOpsHistory([run]);
    const errorActions = actions.filter((a) => a.category === "errors");
    assert.equal(errorActions.length, 2);

    const rateLimitAction = errorActions.find((a) => a.message.includes("RATE_LIMIT"));
    assert.ok(rateLimitAction, "should have RATE_LIMIT action");
    assert.ok(rateLimitAction.action.includes("maxAgeHours"), "should suggest maxAgeHours fix");

    const timeoutAction = errorActions.find((a) => a.message.includes("TIMEOUT"));
    assert.ok(timeoutAction, "should have TIMEOUT action");
    assert.ok(timeoutAction.action.includes("concurrency"), "should suggest concurrency fix");
  });

  it("promotion disabled emits info action", () => {
    const run = makeRun();
    const actions = analyzeOpsHistory([run], {
      promo: { enabled: false },
    });

    const promoActions = actions.filter((a) => a.category === "promotion" && a.level === "info");
    assert.equal(promoActions.length, 1);
    assert.ok(promoActions[0].message.includes("disabled"));
  });

  it("queued slugs with promo disabled emits warning", () => {
    const run = makeRun();
    const actions = analyzeOpsHistory([run], {
      promo: { enabled: false },
      promoQueue: { slugs: ["zip-meta-map", "other-tool"] },
    });

    const warnings = actions.filter((a) => a.category === "promotion" && a.level === "warning");
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].message.includes("2 slug(s)"));
    assert.ok(warnings[0].message.includes("zip-meta-map"));
  });

  it("duration spike emits warning", () => {
    const runs = [
      makeRun({ totalDurationMs: 600000 }),  // latest: 600s — spike
      makeRun({ totalDurationMs: 120000 }),   // 120s
      makeRun({ totalDurationMs: 130000 }),   // 130s
      makeRun({ totalDurationMs: 110000 }),   // 110s
    ];

    const actions = analyzeOpsHistory(runs);
    const durationWarnings = actions.filter((a) => a.category === "duration");
    assert.equal(durationWarnings.length, 1);
    assert.ok(durationWarnings[0].message.includes("600s"), "should mention actual duration");
    assert.ok(durationWarnings[0].message.includes("2x"), "should mention 2x threshold");
  });

  it("empty history returns empty actions", () => {
    const actions = analyzeOpsHistory([]);
    assert.equal(actions.length, 0);
  });

  it("worthy gap emits warning for non-worthy queued slug", () => {
    const run = makeRun();
    const actions = analyzeOpsHistory([run], {
      promoQueue: { slugs: ["unknown-tool"] },
      worthy: { repos: { "zip-meta-map": { worthy: true, score: 5 } } },
    });

    const worthyWarnings = actions.filter((a) => a.category === "worthy");
    assert.equal(worthyWarnings.length, 1);
    assert.ok(worthyWarnings[0].message.includes("unknown-tool"));
  });
});

// ── buildCapsDiff ───────────────────────────────────────────

describe("buildCapsDiff", () => {
  it("detects no changes when no snapshot exists", () => {
    const promo = { enabled: false, caps: { maxNamesPerRun: 50, failMode: "fail-closed" } };
    const diff = buildCapsDiff(promo, [makeRun()]);

    assert.equal(diff.maxNamesPerRun.current, 50);
    assert.equal(diff.maxNamesPerRun.changed, false);
    assert.equal(diff.failMode.current, "fail-closed");
    assert.equal(diff.failMode.changed, false);
    assert.equal(diff.promoEnabled.current, false);
    assert.equal(diff.promoEnabled.changed, false);
  });

  it("detects changes when snapshot differs", () => {
    const promo = { enabled: true, caps: { maxNamesPerRun: 100, failMode: "fail-closed" } };
    const run = makeRun({
      capsSnapshot: { maxNamesPerRun: 50, failMode: "fail-closed", promoEnabled: false },
    });
    const diff = buildCapsDiff(promo, [run]);

    assert.equal(diff.maxNamesPerRun.changed, true, "maxNamesPerRun should show changed");
    assert.equal(diff.promoEnabled.changed, true, "promoEnabled should show changed");
    assert.equal(diff.failMode.changed, false, "failMode should not show changed");
  });
});

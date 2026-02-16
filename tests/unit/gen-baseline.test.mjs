/**
 * Unit tests for gen-baseline.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeBaseline, computeMinuteBudgets } from "../../scripts/gen-baseline.mjs";

// ── Helpers ─────────────────────────────────────────────────

function makeRun(overrides = {}) {
  return {
    runId: `nameops-${overrides.date?.slice(0, 10) || "2026-02-16"}`,
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

// ── computeBaseline ─────────────────────────────────────────

describe("computeBaseline", () => {
  it("computes averages correctly with known data", () => {
    const runs = [
      makeRun({ totalDurationMs: 100000, costStats: { cacheHitRate: 0.80, adapterBreakdown: {} }, minutesEstimate: 2 }),
      makeRun({ totalDurationMs: 200000, costStats: { cacheHitRate: 0.60, adapterBreakdown: {} }, minutesEstimate: 4 }),
    ];

    const baseline = computeBaseline(runs);
    assert.equal(baseline.runCount, 2);
    assert.equal(baseline.avgRuntimeMs, 150000); // (100000 + 200000) / 2
    assert.equal(baseline.avgCacheHitRate, 0.70); // (0.80 + 0.60) / 2
    assert.equal(baseline.avgMinutesPerRun, 3); // (2 + 4) / 2
  });

  it("p95 calculation correct", () => {
    // 10 runs with increasing durations
    const runs = [];
    for (let i = 1; i <= 10; i++) {
      runs.push(makeRun({
        totalDurationMs: i * 60000,
        date: `2026-02-${String(i).padStart(2, "0")}T06:00:00Z`,
        minutesEstimate: i,
        costStats: { cacheHitRate: 0.80, adapterBreakdown: {} },
      }));
    }

    const baseline = computeBaseline(runs);
    // Sorted: 60000, 120000, 180000, 240000, 300000, 360000, 420000, 480000, 540000, 600000
    // P95 index = ceil(0.95 * 10) - 1 = 10 - 1 = 9 → 600000
    assert.equal(baseline.p95RuntimeMs, 600000);
  });

  it("empty history returns zero-state baseline", () => {
    const baseline = computeBaseline([]);
    assert.equal(baseline.runCount, 0);
    assert.equal(baseline.avgRuntimeMs, 0);
    assert.equal(baseline.p95RuntimeMs, 0);
    assert.equal(baseline.stddevRuntimeMs, 0);
    assert.equal(baseline.confidenceLabel, "Low");
    assert.equal(baseline.avgCacheHitRate, 0);
    assert.equal(baseline.projection.monthlyRunCount, 4); // weekly default
    assert.equal(baseline.projection.estimatedMinutes, 0);
    assert.ok(baseline.projection.riskItems.length > 0, "should have risk items");
    // Schedule presets present
    assert.ok(baseline.schedulePresets.conservative);
    assert.ok(baseline.schedulePresets.standard);
    assert.ok(baseline.schedulePresets.aggressive);
  });

  it("low run count risk detected", () => {
    const runs = [makeRun(), makeRun()]; // only 2 runs
    const baseline = computeBaseline(runs);
    assert.ok(
      baseline.projection.riskItems.some((r) => r.includes("Low run count")),
      "should detect low run count risk"
    );
  });

  it("cost projection uses $0.006/min", () => {
    const runs = [
      makeRun({ minutesEstimate: 5 }),
      makeRun({ minutesEstimate: 5 }),
      makeRun({ minutesEstimate: 5 }),
      makeRun({ minutesEstimate: 5 }),
    ];

    const baseline = computeBaseline(runs);
    // avgMinutesPerRun = 5, monthlyRunCount = 4, estimatedMinutes = 20
    assert.equal(baseline.avgMinutesPerRun, 5);
    assert.equal(baseline.projection.estimatedMinutes, 20);
    // $0.006 * 20 = $0.120
    assert.equal(baseline.projection.estimatedCost, 0.120);
  });

  it("stddev calculation correct", () => {
    // Two runs: 100000ms and 200000ms
    // Mean = 150000, variance = ((100000-150000)^2 + (200000-150000)^2) / 2 = 2500000000
    // stddev = sqrt(2500000000) = 50000
    const runs = [
      makeRun({ totalDurationMs: 100000, costStats: { cacheHitRate: 0.80, adapterBreakdown: {} }, minutesEstimate: 2 }),
      makeRun({ totalDurationMs: 200000, costStats: { cacheHitRate: 0.80, adapterBreakdown: {} }, minutesEstimate: 3 }),
    ];

    const baseline = computeBaseline(runs);
    assert.equal(baseline.stddevRuntimeMs, 50000);
  });

  it("confidence label Low for < 4 runs", () => {
    const runs = [makeRun(), makeRun()]; // 2 runs
    const baseline = computeBaseline(runs);
    assert.equal(baseline.confidenceLabel, "Low");
  });

  it("confidence label Medium for 4-12 runs", () => {
    const runs = [];
    for (let i = 0; i < 6; i++) {
      runs.push(makeRun({
        date: `2026-02-${String(i + 1).padStart(2, "0")}T06:00:00Z`,
        minutesEstimate: 2,
        costStats: { cacheHitRate: 0.80, adapterBreakdown: {} },
      }));
    }
    const baseline = computeBaseline(runs);
    assert.equal(baseline.confidenceLabel, "Medium");
  });

  it("confidence label High for > 12 runs", () => {
    const runs = [];
    for (let i = 0; i < 15; i++) {
      runs.push(makeRun({
        date: `2026-02-${String(Math.min(i + 1, 28)).padStart(2, "0")}T06:00:00Z`,
        minutesEstimate: 2,
        costStats: { cacheHitRate: 0.80, adapterBreakdown: {} },
      }));
    }
    const baseline = computeBaseline(runs);
    assert.equal(baseline.confidenceLabel, "High");
  });

  it("schedule presets have 3 entries with correct cost math", () => {
    const runs = [
      makeRun({ minutesEstimate: 5 }),
      makeRun({ minutesEstimate: 5 }),
      makeRun({ minutesEstimate: 5 }),
      makeRun({ minutesEstimate: 5 }),
    ];

    const baseline = computeBaseline(runs);
    const presets = baseline.schedulePresets;

    assert.ok(presets.conservative);
    assert.ok(presets.standard);
    assert.ok(presets.aggressive);

    // Conservative: 2 runs * 5 min = 10 min * $0.006 = $0.060
    assert.equal(presets.conservative.monthlyRuns, 2);
    assert.equal(presets.conservative.estimatedMinutes, 10);
    assert.equal(presets.conservative.estimatedCost, 0.060);

    // Standard: 4 runs * 5 min = 20 min * $0.006 = $0.120
    assert.equal(presets.standard.monthlyRuns, 4);
    assert.equal(presets.standard.estimatedMinutes, 20);
    assert.equal(presets.standard.estimatedCost, 0.120);

    // Aggressive: 8 runs * 5 min = 40 min * $0.006 = $0.240
    assert.equal(presets.aggressive.monthlyRuns, 8);
    assert.equal(presets.aggressive.estimatedMinutes, 40);
    assert.equal(presets.aggressive.estimatedCost, 0.240);
  });
});

// ── computeMinuteBudgets ──────────────────────────────────────

describe("computeMinuteBudgets", () => {
  const makePresets = (avgMin) => ({
    conservative: { cadence: "biweekly", monthlyRuns: 2, estimatedMinutes: avgMin * 2, estimatedCost: 0 },
    standard: { cadence: "weekly", monthlyRuns: 4, estimatedMinutes: avgMin * 4, estimatedCost: 0 },
    aggressive: { cadence: "2x-weekly", monthlyRuns: 8, estimatedMinutes: avgMin * 8, estimatedCost: 0 },
  });

  it("computeBaseline includes minuteBudgets object", () => {
    const runs = [makeRun({ minutesEstimate: 5 })];
    const baseline = computeBaseline(runs);
    assert.ok(baseline.minuteBudgets, "must have minuteBudgets");
    assert.ok(typeof baseline.minuteBudgets === "object");
  });

  it("minuteBudgets has entries for 200, 500, 1000", () => {
    const budgets = computeMinuteBudgets(5, makePresets(5), {});
    assert.ok(budgets[200], "must have 200-minute tier");
    assert.ok(budgets[500], "must have 500-minute tier");
    assert.ok(budgets[1000], "must have 1000-minute tier");
  });

  it("maxRunsPerMonth = floor(budget / avgMinutesPerRun)", () => {
    const budgets = computeMinuteBudgets(7, makePresets(7), {});
    assert.equal(budgets[200].maxRunsPerMonth, Math.floor(200 / 7)); // 28
    assert.equal(budgets[500].maxRunsPerMonth, Math.floor(500 / 7)); // 71
    assert.equal(budgets[1000].maxRunsPerMonth, Math.floor(1000 / 7)); // 142
  });

  it("recommendedPreset picks most aggressive that fits with 20% headroom", () => {
    // avgMin=5, aggressive=40min. 200*0.8=160, 40<=160 → aggressive
    const budgets = computeMinuteBudgets(5, makePresets(5), {});
    assert.equal(budgets[200].recommendedPreset, "aggressive");
    assert.equal(budgets[500].recommendedPreset, "aggressive");
    assert.equal(budgets[1000].recommendedPreset, "aggressive");
  });

  it("whatStops empty when all presets fit under budget", () => {
    // avgMin=1, all presets trivially fit
    const budgets = computeMinuteBudgets(1, makePresets(1), {});
    assert.equal(budgets[200].whatStops.length, 0);
    assert.equal(budgets[500].whatStops.length, 0);
    assert.equal(budgets[1000].whatStops.length, 0);
  });

  it("whatStops reports aggressive not viable when budget tight", () => {
    // avgMin=30, aggressive=240, standard=120, conservative=60
    const budgets = computeMinuteBudgets(30, makePresets(30), {});
    // 200-minute tier: aggressive(240)>200
    assert.ok(
      budgets[200].whatStops.some((s) => s.includes("Aggressive")),
      "should flag aggressive not viable at 200 min"
    );
    // 500-minute tier: all fit
    assert.ok(
      !budgets[500].whatStops.some((s) => s.includes("Aggressive")),
      "should NOT flag aggressive at 500 min"
    );
  });

  it("whatStops reports all schedules not viable on tiny budget", () => {
    // avgMin=120, conservative=240 > any tier below 240
    const budgets = computeMinuteBudgets(120, makePresets(120), {});
    // 200-minute tier: all exceed
    assert.ok(
      budgets[200].whatStops.some((s) => s.includes("biweekly")),
      "should flag biweekly exceeds budget at 200 min"
    );
  });

  it("zero-state baseline has minuteBudgets with zero values", () => {
    const baseline = computeBaseline([]);
    assert.ok(baseline.minuteBudgets, "zero-state must have minuteBudgets");
    assert.equal(baseline.minuteBudgets[200].maxRunsPerMonth, 0);
    assert.equal(baseline.minuteBudgets[500].maxRunsPerMonth, 0);
    assert.equal(baseline.minuteBudgets[1000].maxRunsPerMonth, 0);
  });
});

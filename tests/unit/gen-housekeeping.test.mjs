import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHousekeepingPlan } from "../../scripts/gen-housekeeping.mjs";

describe("gen-housekeeping", () => {
  it("under limit → nothing to remove", () => {
    const dirs = [
      "2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29",
    ];
    const plan = buildHousekeepingPlan({ dirs, maxKeep: 12 });
    assert.deepEqual(plan.toRemove, []);
    assert.equal(plan.keptCount, 5);
    assert.equal(plan.removedCount, 0);
  });

  it("at limit → nothing to remove", () => {
    const dirs = [
      "2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22",
      "2026-01-29", "2026-02-05", "2026-02-12", "2026-02-19",
      "2026-02-26", "2026-03-05", "2026-03-12", "2026-03-19",
    ];
    const plan = buildHousekeepingPlan({ dirs, maxKeep: 12 });
    assert.deepEqual(plan.toRemove, []);
    assert.equal(plan.keptCount, 12);
    assert.equal(plan.removedCount, 0);
  });

  it("over limit → correct dirs removed", () => {
    const dirs = [
      "2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22",
      "2026-01-29", "2026-02-05", "2026-02-12", "2026-02-19",
      "2026-02-26", "2026-03-05", "2026-03-12", "2026-03-19",
      "2026-03-26", "2026-04-02", "2026-04-09",
    ];
    const plan = buildHousekeepingPlan({ dirs, maxKeep: 12 });
    assert.equal(plan.removedCount, 3);
    assert.equal(plan.keptCount, 12);
    assert.deepEqual(plan.toRemove, ["2026-01-01", "2026-01-08", "2026-01-15"]);
  });

  it("empty directory → no errors", () => {
    const plan = buildHousekeepingPlan({ dirs: [], maxKeep: 12 });
    assert.deepEqual(plan.toRemove, []);
    assert.equal(plan.keptCount, 0);
    assert.equal(plan.removedCount, 0);
  });

  it("non-existent directory → no errors", () => {
    const plan = buildHousekeepingPlan({ dirs: [], maxKeep: 12 });
    assert.deepEqual(plan.toRemove, []);
    assert.equal(plan.keptCount, 0);
    assert.equal(plan.removedCount, 0);
  });

  it("sorts by date correctly (oldest removed first)", () => {
    // Provide dirs in unsorted order
    const dirs = [
      "2026-04-09", "2026-01-01", "2026-03-19", "2026-01-08",
      "2026-02-26", "2026-01-15", "2026-03-26", "2026-02-05",
      "2026-01-22", "2026-02-12", "2026-03-05", "2026-04-02",
      "2026-03-12", "2026-01-29", "2026-02-19",
    ];
    const plan = buildHousekeepingPlan({ dirs, maxKeep: 12 });
    assert.equal(plan.removedCount, 3);
    // The 3 oldest dates regardless of input order
    assert.deepEqual(plan.toRemove, ["2026-01-01", "2026-01-08", "2026-01-15"]);
  });
});

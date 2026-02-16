import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDrift } from "../../scripts/gen-decision-drift.mjs";

function makeDecisions(...slugs) {
  return {
    decisions: slugs.map(([slug, score, action]) => ({ slug, score, action })),
  };
}

describe("buildDrift", () => {
  it("empty previous + non-empty current → all entrants", () => {
    const result = buildDrift(null, makeDecisions(["a", 10, "promote"], ["b", 8, "skip"]));
    assert.deepEqual(result.entrants, ["a", "b"]);
    assert.deepEqual(result.exits, []);
    assert.equal(result.scoreDeltas.length, 0);
    assert.equal(result.summary.totalChanged, 2);
  });

  it("non-empty previous + empty current → all exits", () => {
    const result = buildDrift(makeDecisions(["a", 10, "promote"], ["b", 8, "skip"]), { decisions: [] });
    assert.deepEqual(result.entrants, []);
    assert.deepEqual(result.exits, ["a", "b"]);
    assert.equal(result.summary.totalChanged, 2);
  });

  it("same decisions → no drift", () => {
    const decisions = makeDecisions(["a", 10, "promote"], ["b", 8, "skip"]);
    const result = buildDrift(decisions, decisions);
    assert.deepEqual(result.entrants, []);
    assert.deepEqual(result.exits, []);
    assert.equal(result.scoreDeltas.length, 2);
    assert.ok(result.scoreDeltas.every((d) => d.delta === 0));
    assert.equal(result.reasonChanges.length, 0);
    assert.equal(result.summary.totalChanged, 0);
    assert.equal(result.summary.totalStable, 2);
  });

  it("score change → delta computed correctly", () => {
    const prev = makeDecisions(["a", 10, "promote"]);
    const curr = makeDecisions(["a", 15, "promote"]);
    const result = buildDrift(prev, curr);
    assert.equal(result.scoreDeltas.length, 1);
    assert.equal(result.scoreDeltas[0].prevScore, 10);
    assert.equal(result.scoreDeltas[0].currScore, 15);
    assert.equal(result.scoreDeltas[0].delta, 5);
  });

  it("action change → detected (promote→skip)", () => {
    const prev = makeDecisions(["a", 10, "promote"]);
    const curr = makeDecisions(["a", 10, "skip"]);
    const result = buildDrift(prev, curr);
    assert.equal(result.reasonChanges.length, 1);
    assert.equal(result.reasonChanges[0].prevAction, "promote");
    assert.equal(result.reasonChanges[0].currAction, "skip");
  });

  it("mixed: new + removed + changed", () => {
    const prev = makeDecisions(["a", 10, "promote"], ["b", 8, "skip"], ["c", 5, "skip"]);
    const curr = makeDecisions(["a", 12, "promote"], ["c", 5, "promote"], ["d", 9, "promote"]);
    const result = buildDrift(prev, curr);
    assert.deepEqual(result.entrants, ["d"]);
    assert.deepEqual(result.exits, ["b"]);
    assert.equal(result.scoreDeltas.length, 2); // a and c are common
    const aDelta = result.scoreDeltas.find((d) => d.slug === "a");
    assert.equal(aDelta.delta, 2);
    assert.equal(result.reasonChanges.length, 1); // c changed action
    assert.equal(result.reasonChanges[0].slug, "c");
  });

  it("both empty → no drift", () => {
    const result = buildDrift({ decisions: [] }, { decisions: [] });
    assert.deepEqual(result.entrants, []);
    assert.deepEqual(result.exits, []);
    assert.equal(result.scoreDeltas.length, 0);
    assert.equal(result.reasonChanges.length, 0);
    assert.equal(result.summary.totalChanged, 0);
    assert.equal(result.summary.totalStable, 0);
  });

  it("missing fields handled gracefully", () => {
    // Decisions with missing score/action
    const prev = { decisions: [{ slug: "a" }] };
    const curr = { decisions: [{ slug: "a", score: 5 }] };
    const result = buildDrift(prev, curr);
    assert.equal(result.scoreDeltas.length, 1);
    assert.equal(result.scoreDeltas[0].prevScore, 0); // defaults to 0
    assert.equal(result.scoreDeltas[0].currScore, 5);
    assert.equal(result.scoreDeltas[0].delta, 5);
  });
});

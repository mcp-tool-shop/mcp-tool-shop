import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateExperiments } from "../../scripts/gen-experiment-decisions.mjs";

function makeExp(id, name, { status = "active", controlKey = "control", variantKey = "variant-a" } = {}) {
  return { id, name, status, slug: "test-tool", dimension: "tagline", control: { key: controlKey }, variant: { key: variantKey } };
}

function makeArmStats(sent, opened, replied, ignored, bounced) {
  return { sent, opened, replied, ignored, bounced };
}

describe("evaluateExperiments", () => {
  it("empty experiments returns empty evaluations", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [] },
      { perExperiment: {} },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 0);
    assert.ok(result.warnings.some((w) => w.includes("No active experiments")));
  });

  it("draft experiments are skipped", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "Draft Test", { status: "draft" })] },
      { perExperiment: {} },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 0);
  });

  it("concluded experiments are skipped", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "Concluded Test", { status: "concluded" })] },
      { perExperiment: {} },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 0);
  });

  it("needs-more-data when no perExperiment data exists", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "No Data Test")] },
      { perExperiment: {} },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 1);
    assert.equal(result.evaluations[0].status, "needs-more-data");
    assert.ok(result.evaluations[0].recommendation.includes("No feedback data"));
  });

  it("needs-more-data when entries below threshold", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "Low Data Test")] },
      {
        perExperiment: {
          "exp-1": {
            control: makeArmStats(3, 1, 1, 0, 0),
            "variant-a": makeArmStats(2, 1, 1, 0, 1),
          },
        },
      },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 1);
    assert.equal(result.evaluations[0].status, "needs-more-data");
    assert.ok(result.evaluations[0].recommendation.includes("Insufficient"));
  });

  it("winner-found: variant wins when reply rate > 2x control", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "Variant Wins")] },
      {
        perExperiment: {
          "exp-1": {
            control: makeArmStats(5, 2, 1, 1, 1),
            "variant-a": makeArmStats(3, 2, 4, 0, 1),
          },
        },
      },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 1);
    assert.equal(result.evaluations[0].status, "winner-found");
    assert.equal(result.evaluations[0].winnerKey, "variant-a");
  });

  it("winner-found: control wins when reply rate > 2x variant", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "Control Wins")] },
      {
        perExperiment: {
          "exp-1": {
            control: makeArmStats(3, 2, 4, 0, 1),
            "variant-a": makeArmStats(5, 2, 1, 1, 1),
          },
        },
      },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 1);
    assert.equal(result.evaluations[0].status, "winner-found");
    assert.equal(result.evaluations[0].winnerKey, "control");
  });

  it("no-decision when performance is similar", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "Similar Performance")] },
      {
        perExperiment: {
          "exp-1": {
            control: makeArmStats(4, 2, 2, 1, 1),
            "variant-a": makeArmStats(3, 3, 2, 1, 1),
          },
        },
      },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 1);
    assert.equal(result.evaluations[0].status, "no-decision");
    assert.equal(result.evaluations[0].winnerKey, null);
  });

  it("recommendation includes ratio when winner found", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "Ratio Check")] },
      {
        perExperiment: {
          "exp-1": {
            control: makeArmStats(5, 2, 1, 1, 1),
            "variant-a": makeArmStats(3, 2, 4, 0, 1),
          },
        },
      },
      { minExperimentDataThreshold: 10 }
    );
    const rec = result.evaluations[0].recommendation;
    assert.ok(rec.includes("outperforms"));
    assert.ok(/\d/.test(rec), "recommendation should include the ratio number");
  });

  it("multiple active experiments evaluated independently", () => {
    const result = evaluateExperiments(
      {
        schemaVersion: 1,
        experiments: [
          makeExp("exp-1", "Winner Experiment"),
          makeExp("exp-2", "Needs Data Experiment"),
        ],
      },
      {
        perExperiment: {
          "exp-1": {
            control: makeArmStats(5, 2, 1, 1, 1),
            "variant-a": makeArmStats(3, 2, 4, 0, 1),
          },
        },
      },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 2);
    const exp1 = result.evaluations.find((e) => e.experimentId === "exp-1");
    const exp2 = result.evaluations.find((e) => e.experimentId === "exp-2");
    assert.equal(exp1.status, "winner-found");
    assert.equal(exp2.status, "needs-more-data");
  });

  it("zero reply rate in both arms returns no-decision (no division by zero)", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "Zero Replies")] },
      {
        perExperiment: {
          "exp-1": {
            control: makeArmStats(5, 3, 0, 1, 1),
            "variant-a": makeArmStats(4, 4, 0, 1, 1),
          },
        },
      },
      { minExperimentDataThreshold: 10 }
    );
    assert.equal(result.evaluations.length, 1);
    assert.equal(result.evaluations[0].status, "no-decision");
  });

  it("respects governance.minExperimentDataThreshold value", () => {
    const result = evaluateExperiments(
      { schemaVersion: 1, experiments: [makeExp("exp-1", "Low Threshold")] },
      {
        perExperiment: {
          "exp-1": {
            control: makeArmStats(3, 1, 0, 1, 1),
            "variant-a": makeArmStats(2, 1, 3, 0, 0),
          },
        },
      },
      { minExperimentDataThreshold: 5 }
    );
    assert.equal(result.evaluations.length, 1);
    assert.notEqual(result.evaluations[0].status, "needs-more-data");
    assert.equal(result.evaluations[0].status, "winner-found");
    assert.equal(result.evaluations[0].winnerKey, "variant-a");
  });
});

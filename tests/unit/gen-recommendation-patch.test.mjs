import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  translateRecommendation,
  buildPatchPlan,
  applyPatchesToFiles,
  ALLOWED_TARGET_FILES,
  MAX_DATA_PATCHES_DEFAULT,
} from "../../scripts/gen-recommendation-patch.mjs";

// ── Factory helpers ─────────────────────────────────────────

function makeGovernance(overrides = {}) {
  return {
    schemaVersion: 2,
    decisionsFrozen: false,
    experimentsFrozen: false,
    maxPromosPerWeek: 3,
    cooldownDaysPerSlug: 14,
    cooldownDaysPerPartner: 14,
    minCoverageScore: 80,
    minExperimentDataThreshold: 10,
    hardRules: ["never push directly to main"],
    ...overrides,
  };
}

function makeCurrentData(overrides = {}) {
  return {
    promoQueue: { week: "2026-02-17", slugs: [], promotionType: "own", notes: "" },
    experiments: { schemaVersion: 1, experiments: [] },
    ...overrides,
  };
}

function makeRec(category, slug, overrides = {}) {
  return {
    priority: "high",
    category,
    slug,
    title: `Test: ${slug}`,
    insight: "test insight",
    action: "test action",
    evidence: { proofEngagementScore: 10 },
    ...overrides,
  };
}

// ── translateRecommendation ─────────────────────────────────

describe("translateRecommendation", () => {
  it("re-feature with unfrozen governance produces a patch", () => {
    const rec = makeRec("re-feature", "cool-tool");
    const result = translateRecommendation(rec, makeGovernance(), makeCurrentData());
    assert.equal(result.type, "patch");
    assert.equal(result.patch.targetFile, "promo-queue.json");
    assert.equal(result.patch.slug, "cool-tool");
    assert.ok(result.patch.apply.slugs.includes("cool-tool"));
    assert.ok(result.patch.description.includes("cool-tool"));
    assert.ok(result.riskNote);
  });

  it("re-feature with decisionsFrozen produces frozen action", () => {
    const rec = makeRec("re-feature", "cool-tool");
    const result = translateRecommendation(rec, makeGovernance({ decisionsFrozen: true }), makeCurrentData());
    assert.equal(result.type, "frozen");
    assert.ok(result.note.includes("decisionsFrozen"));
  });

  it("re-feature with slug already in queue produces advisory", () => {
    const rec = makeRec("re-feature", "cool-tool");
    const data = makeCurrentData({ promoQueue: { week: "2026-02-17", slugs: ["cool-tool"], promotionType: "own", notes: "" } });
    const result = translateRecommendation(rec, makeGovernance(), data);
    assert.equal(result.type, "advisory");
    assert.ok(result.note.includes("Already in"));
  });

  it("re-feature with queue at capacity produces advisory", () => {
    const rec = makeRec("re-feature", "new-tool");
    const data = makeCurrentData({
      promoQueue: { week: "2026-02-17", slugs: ["a", "b", "c"], promotionType: "own", notes: "" },
    });
    const result = translateRecommendation(rec, makeGovernance({ maxPromosPerWeek: 3 }), data);
    assert.equal(result.type, "advisory");
    assert.ok(result.note.includes("full"));
  });

  it("experiment-graduation with matching active experiment produces patch", () => {
    const rec = makeRec("experiment-graduation", "exp-001", {
      evidence: { experimentId: "exp-001", winnerKey: "variant-a" },
    });
    const data = makeCurrentData({
      experiments: {
        schemaVersion: 1,
        experiments: [{ id: "exp-001", status: "running", dimension: "tagline" }],
      },
    });
    const result = translateRecommendation(rec, makeGovernance(), data);
    assert.equal(result.type, "patch");
    assert.equal(result.patch.targetFile, "experiments.json");
    assert.ok(result.patch.apply.experiments.find((e) => e.id === "exp-001" && e.status === "concluded"));
  });

  it("experiment-graduation with experimentsFrozen produces frozen action", () => {
    const rec = makeRec("experiment-graduation", "exp-001");
    const data = makeCurrentData({
      experiments: {
        schemaVersion: 1,
        experiments: [{ id: "exp-001", status: "running" }],
      },
    });
    const result = translateRecommendation(rec, makeGovernance({ experimentsFrozen: true }), data);
    assert.equal(result.type, "frozen");
    assert.ok(result.note.includes("experimentsFrozen"));
  });

  it("experiment-graduation with already-concluded experiment produces advisory", () => {
    const rec = makeRec("experiment-graduation", "exp-001");
    const data = makeCurrentData({
      experiments: {
        schemaVersion: 1,
        experiments: [{ id: "exp-001", status: "concluded" }],
      },
    });
    const result = translateRecommendation(rec, makeGovernance(), data);
    assert.equal(result.type, "advisory");
    assert.ok(result.note.includes("concluded"));
  });

  it("experiment-graduation with unknown experiment produces advisory", () => {
    const rec = makeRec("experiment-graduation", "exp-unknown");
    const result = translateRecommendation(rec, makeGovernance(), makeCurrentData());
    assert.equal(result.type, "advisory");
    assert.ok(result.note.includes("not found"));
  });

  it("improve-proof always produces advisory", () => {
    const rec = makeRec("improve-proof", "tool-x", { insight: "low proof engagement" });
    const result = translateRecommendation(rec, makeGovernance(), makeCurrentData());
    assert.equal(result.type, "advisory");
  });

  it("stuck-submission always produces advisory", () => {
    const rec = makeRec("stuck-submission", "tool-y", { insight: "high friction" });
    const result = translateRecommendation(rec, makeGovernance(), makeCurrentData());
    assert.equal(result.type, "advisory");
  });

  it("lint-promotion always produces advisory", () => {
    const rec = makeRec("lint-promotion", "missing-install", { insight: "5 occurrences" });
    const result = translateRecommendation(rec, makeGovernance(), makeCurrentData());
    assert.equal(result.type, "advisory");
  });

  it("unknown category produces advisory", () => {
    const rec = makeRec("unknown-category", "something");
    const result = translateRecommendation(rec, makeGovernance(), makeCurrentData());
    assert.equal(result.type, "advisory");
    assert.ok(result.note.includes("Unknown category"));
  });
});

// ── buildPatchPlan ──────────────────────────────────────────

describe("buildPatchPlan", () => {
  it("empty recommendations produces empty plan", () => {
    const plan = buildPatchPlan([], makeGovernance(), makeCurrentData());
    assert.equal(plan.patches.length, 0);
    assert.equal(plan.advisoryNotes.length, 0);
    assert.equal(plan.riskNotes.length, 0);
    assert.equal(plan.frozenActions.length, 0);
  });

  it("single re-feature recommendation produces one patch", () => {
    const recs = [makeRec("re-feature", "tool-a")];
    const plan = buildPatchPlan(recs, makeGovernance(), makeCurrentData());
    assert.equal(plan.patches.length, 1);
    assert.equal(plan.patches[0].slug, "tool-a");
    assert.equal(plan.patches[0].targetFile, "promo-queue.json");
  });

  it("mixed categories produce correct patch/advisory/frozen buckets", () => {
    const recs = [
      makeRec("re-feature", "tool-a"),
      makeRec("improve-proof", "tool-b"),
      makeRec("stuck-submission", "tool-c"),
    ];
    const plan = buildPatchPlan(recs, makeGovernance(), makeCurrentData());
    assert.equal(plan.patches.length, 1);
    assert.equal(plan.advisoryNotes.length, 2);
    assert.equal(plan.frozenActions.length, 0);
  });

  it("maxPatches cap limits data patches, excess become advisory", () => {
    const recs = [
      makeRec("re-feature", "tool-a"),
      makeRec("re-feature", "tool-b"),
      makeRec("re-feature", "tool-c"),
    ];
    const gov = makeGovernance({ maxPromosPerWeek: 10 });
    const plan = buildPatchPlan(recs, gov, makeCurrentData(), { maxPatches: 2 });
    assert.equal(plan.patches.length, 2);
    assert.equal(plan.advisoryNotes.length, 1);
    assert.ok(plan.advisoryNotes[0].note.includes("Exceeded max patch cap"));
  });

  it("queue fills incrementally — second re-feature sees updated count", () => {
    const recs = [
      makeRec("re-feature", "tool-a"),
      makeRec("re-feature", "tool-b"),
    ];
    const gov = makeGovernance({ maxPromosPerWeek: 3 });
    const plan = buildPatchPlan(recs, gov, makeCurrentData());
    assert.equal(plan.patches.length, 2);
    // Second patch should show updated slug list
    assert.ok(plan.patches[1].apply.slugs.includes("tool-a"));
    assert.ok(plan.patches[1].apply.slugs.includes("tool-b"));
  });

  it("all frozen governance produces zero patches, all frozenActions", () => {
    const recs = [
      makeRec("re-feature", "tool-a"),
      makeRec("experiment-graduation", "exp-001"),
    ];
    const gov = makeGovernance({ decisionsFrozen: true, experimentsFrozen: true });
    const data = makeCurrentData({
      experiments: {
        schemaVersion: 1,
        experiments: [{ id: "exp-001", status: "running" }],
      },
    });
    const plan = buildPatchPlan(recs, gov, data);
    assert.equal(plan.patches.length, 0);
    assert.equal(plan.frozenActions.length, 2);
  });

  it("deterministic: same inputs produce same output", () => {
    const recs = [makeRec("re-feature", "tool-a"), makeRec("improve-proof", "tool-b")];
    const gov = makeGovernance();
    const data = makeCurrentData();

    const plan1 = buildPatchPlan(recs, gov, data);
    const plan2 = buildPatchPlan(recs, gov, data);

    assert.deepEqual(plan1.patches, plan2.patches);
    assert.deepEqual(plan1.advisoryNotes, plan2.advisoryNotes);
    assert.deepEqual(plan1.riskNotes, plan2.riskNotes);
    assert.deepEqual(plan1.frozenActions, plan2.frozenActions);
  });

  it("risk notes populated for every data patch", () => {
    const recs = [makeRec("re-feature", "tool-a")];
    const plan = buildPatchPlan(recs, makeGovernance(), makeCurrentData());
    assert.equal(plan.riskNotes.length, 1);
    assert.ok(plan.riskNotes[0].includes("slots filled"));
  });

  it("re-feature + experiment-graduation together produces patches for different files", () => {
    const recs = [
      makeRec("re-feature", "tool-a"),
      makeRec("experiment-graduation", "exp-001", {
        evidence: { experimentId: "exp-001", winnerKey: "variant-a" },
      }),
    ];
    const data = makeCurrentData({
      experiments: {
        schemaVersion: 1,
        experiments: [{ id: "exp-001", status: "running" }],
      },
    });
    const plan = buildPatchPlan(recs, makeGovernance(), data);
    assert.equal(plan.patches.length, 2);
    const targets = plan.patches.map((p) => p.targetFile);
    assert.ok(targets.includes("promo-queue.json"));
    assert.ok(targets.includes("experiments.json"));
  });
});

// ── applyPatchesToFiles ─────────────────────────────────────

describe("applyPatchesToFiles", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `test-rec-patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("re-feature patch appends slug to promo-queue.json", () => {
    const promoQueue = { week: "2026-02-17", slugs: ["existing"], promotionType: "own", notes: "" };
    writeFileSync(join(tmpDir, "promo-queue.json"), JSON.stringify(promoQueue));

    const patches = [{
      category: "re-feature",
      slug: "new-tool",
      targetFile: "promo-queue.json",
      description: "Add new-tool",
      riskNote: "test",
      apply: { slugs: ["existing", "new-tool"] },
    }];

    applyPatchesToFiles(patches, { promoQueue }, { dataDir: tmpDir });

    const updated = JSON.parse(readFileSync(join(tmpDir, "promo-queue.json"), "utf8"));
    assert.deepEqual(updated.slugs, ["existing", "new-tool"]);
    assert.equal(updated.week, "2026-02-17");
    assert.equal(updated.promotionType, "own");
  });

  it("graduation patch sets experiment status to concluded", () => {
    const experiments = {
      schemaVersion: 1,
      experiments: [
        { id: "exp-001", status: "running", dimension: "tagline" },
        { id: "exp-002", status: "running", dimension: "proof" },
      ],
    };
    writeFileSync(join(tmpDir, "experiments.json"), JSON.stringify(experiments));

    const patches = [{
      category: "experiment-graduation",
      slug: "exp-001",
      targetFile: "experiments.json",
      description: "Graduate exp-001",
      riskNote: "test",
      apply: {
        experiments: [
          { id: "exp-001", status: "concluded", dimension: "tagline" },
          { id: "exp-002", status: "running", dimension: "proof" },
        ],
      },
    }];

    applyPatchesToFiles(patches, { experiments }, { dataDir: tmpDir });

    const updated = JSON.parse(readFileSync(join(tmpDir, "experiments.json"), "utf8"));
    assert.equal(updated.experiments[0].status, "concluded");
    assert.equal(updated.experiments[1].status, "running");
  });

  it("schemaVersion is preserved after experiment graduation", () => {
    const experiments = {
      schemaVersion: 1,
      experiments: [{ id: "exp-001", status: "running" }],
    };
    writeFileSync(join(tmpDir, "experiments.json"), JSON.stringify(experiments));

    const patches = [{
      category: "experiment-graduation",
      slug: "exp-001",
      targetFile: "experiments.json",
      description: "Graduate exp-001",
      riskNote: "test",
      apply: { experiments: [{ id: "exp-001", status: "concluded" }] },
    }];

    applyPatchesToFiles(patches, { experiments }, { dataDir: tmpDir });

    const updated = JSON.parse(readFileSync(join(tmpDir, "experiments.json"), "utf8"));
    assert.equal(updated.schemaVersion, 1);
  });
});

// ── Exported constants ──────────────────────────────────────

describe("exported constants", () => {
  it("ALLOWED_TARGET_FILES contains expected entries", () => {
    assert.ok(ALLOWED_TARGET_FILES.has("promo-queue.json"));
    assert.ok(ALLOWED_TARGET_FILES.has("experiments.json"));
    assert.equal(ALLOWED_TARGET_FILES.size, 2);
  });

  it("MAX_DATA_PATCHES_DEFAULT is 5", () => {
    assert.equal(MAX_DATA_PATCHES_DEFAULT, 5);
  });
});

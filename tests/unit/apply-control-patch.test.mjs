import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePatch, applyPatch } from "../../scripts/apply-control-patch.mjs";

// ── validatePatch tests ─────────────────────────────────────

describe("validatePatch", () => {
  it("valid governance patch passes", () => {
    const result = validatePatch({ "governance.json": { decisionsFrozen: true } });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("valid promo patch passes", () => {
    const result = validatePatch({ "promo.json": { enabled: false } });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects unknown target file", () => {
    const result = validatePatch({ "bad.json": {} });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("bad.json")));
  });

  it("rejects protected field hardRules", () => {
    const result = validatePatch({ "governance.json": { hardRules: [] } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("hardRules") && e.includes("protected")));
  });

  it("rejects invalid type for decisionsFrozen", () => {
    const result = validatePatch({ "governance.json": { decisionsFrozen: "yes" } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("decisionsFrozen")));
  });

  it("rejects out-of-range maxPromosPerWeek", () => {
    const result = validatePatch({ "governance.json": { maxPromosPerWeek: 100 } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("maxPromosPerWeek")));
  });

  it("rejects patch to schemaVersion", () => {
    const result = validatePatch({ "governance.json": { schemaVersion: 99 } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("schemaVersion") && e.includes("protected")));
  });
});

// ── applyPatch tests ────────────────────────────────────────

describe("applyPatch", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `control-patch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merge preserves existing fields", () => {
    const existing = { schemaVersion: 1, maxPromosPerWeek: 5, existingField: "keep" };
    writeFileSync(join(tmpDir, "governance.json"), JSON.stringify(existing), "utf8");

    const result = applyPatch(
      { "governance.json": { decisionsFrozen: true } },
      { dataDir: tmpDir },
    );

    assert.deepEqual(result.applied, ["governance.json"]);

    const updated = JSON.parse(readFileSync(join(tmpDir, "governance.json"), "utf8"));
    assert.equal(updated.schemaVersion, 1);
    assert.equal(updated.maxPromosPerWeek, 5);
    assert.equal(updated.existingField, "keep");
    assert.equal(updated.decisionsFrozen, true);
  });

  it("risk notes generated for freeze changes", () => {
    const result = applyPatch(
      { "governance.json": { decisionsFrozen: true } },
      { dataDir: tmpDir },
    );

    assert.ok(result.riskNotes.some((n) => n.includes("will NOT update")));
  });

  it("risk notes generated for enable/disable", () => {
    const result = applyPatch(
      { "promo.json": { enabled: false } },
      { dataDir: tmpDir },
    );

    assert.ok(result.riskNotes.some((n) => n.includes("DISABLED")));
  });

  it("empty patch produces no changes", () => {
    const result = applyPatch({}, { dataDir: tmpDir });

    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.riskNotes, []);
  });

  it("handles missing learningMode values", () => {
    const result = validatePatch({ "promo.json": { learningMode: "invalid" } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("learningMode")));
  });
});

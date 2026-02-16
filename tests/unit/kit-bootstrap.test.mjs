import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrap } from "../../scripts/kit-bootstrap.mjs";
import { resetConfigCache } from "../../scripts/lib/config.mjs";

// ── Temp dir helper ─────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = join(tmpdir(), `test-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmpDir, { recursive: true });
  resetConfigCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  resetConfigCache();
});

// ── bootstrap ───────────────────────────────────────────────

describe("kit-bootstrap", () => {
  it("creates seed files in a fresh directory with valid config", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({
        kitVersion: 1,
        paths: { dataDir: "data", publicDir: "public" },
      })
    );

    const result = bootstrap(tmpDir);
    assert.equal(result.success, true);
    assert.ok(result.created.length > 0, "should create files");

    // Core seed files exist
    assert.ok(existsSync(join(tmpDir, "data", "governance.json")));
    assert.ok(existsSync(join(tmpDir, "data", "promo-queue.json")));
    assert.ok(existsSync(join(tmpDir, "data", "experiments.json")));
    assert.ok(existsSync(join(tmpDir, "data", "submissions.json")));
    assert.ok(existsSync(join(tmpDir, "data", "overrides.json")));
    assert.ok(existsSync(join(tmpDir, "data", "recommendations.json")));
    assert.ok(existsSync(join(tmpDir, "data", "recommendation-patch.json")));
  });

  it("is idempotent — skips existing files on second run", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, paths: { dataDir: "data", publicDir: "public" } })
    );

    const result1 = bootstrap(tmpDir);
    assert.equal(result1.success, true);
    const createdCount = result1.created.length;

    resetConfigCache();
    const result2 = bootstrap(tmpDir);
    assert.equal(result2.success, true);
    assert.equal(result2.created.length, 0, "no files should be created on second run");
    assert.ok(result2.skipped.length > 0, "should report skipped files");
  });

  it("seed governance.json has correct default schema", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, paths: { dataDir: "data", publicDir: "public" } })
    );

    bootstrap(tmpDir);
    const gov = JSON.parse(readFileSync(join(tmpDir, "data", "governance.json"), "utf8"));
    assert.equal(gov.schemaVersion, 2);
    assert.equal(gov.decisionsFrozen, false);
    assert.equal(gov.experimentsFrozen, false);
    assert.ok(typeof gov.maxPromosPerWeek === "number");
    assert.ok(Array.isArray(gov.hardRules));
  });

  it("seed promo-queue.json has valid structure", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, paths: { dataDir: "data", publicDir: "public" } })
    );

    bootstrap(tmpDir);
    const pq = JSON.parse(readFileSync(join(tmpDir, "data", "promo-queue.json"), "utf8"));
    assert.ok(pq.week, "must have week");
    assert.ok(Array.isArray(pq.slugs), "slugs must be array");
    assert.equal(pq.slugs.length, 0, "slugs should be empty");
    assert.ok(pq.promotionType, "must have promotionType");
  });

  it("creates telemetry directories", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, paths: { dataDir: "data", publicDir: "public" } })
    );

    bootstrap(tmpDir);
    assert.ok(existsSync(join(tmpDir, "data", "telemetry", "events")));
    assert.ok(existsSync(join(tmpDir, "data", "telemetry", "daily")));
    assert.ok(existsSync(join(tmpDir, "data", "telemetry", "rollup.json")));
  });

  it("uses config.paths.dataDir for seed file placement", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, paths: { dataDir: "custom/data/path", publicDir: "pub" } })
    );

    bootstrap(tmpDir);
    assert.ok(existsSync(join(tmpDir, "custom", "data", "path", "governance.json")));
    assert.ok(!existsSync(join(tmpDir, "data", "governance.json")));
  });

  it("creates feedback.jsonl as empty file", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, paths: { dataDir: "data", publicDir: "public" } })
    );

    bootstrap(tmpDir);
    const content = readFileSync(join(tmpDir, "data", "feedback.jsonl"), "utf8");
    assert.equal(content, "");
  });

  it("seed decision-drift.json has correct schema", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, paths: { dataDir: "data", publicDir: "public" } })
    );

    bootstrap(tmpDir);
    const drift = JSON.parse(readFileSync(join(tmpDir, "data", "decision-drift.json"), "utf8"));
    assert.ok(Array.isArray(drift.entrants), "entrants must be array");
    assert.ok(Array.isArray(drift.exits), "exits must be array");
    assert.ok(Array.isArray(drift.scoreDeltas), "scoreDeltas must be array");
    assert.ok(Array.isArray(drift.reasonChanges), "reasonChanges must be array");
    assert.ok(drift.summary && typeof drift.summary === "object", "summary must be object");
  });
});

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildOpsRecord, appendOpsRecord } from "../../scripts/ingest-ops.mjs";

function makeTempDir(label) {
  const dir = join(tmpdir(), `ops-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("buildOpsRecord", () => {
  let outputDir;

  beforeEach(() => {
    outputDir = makeTempDir("build");
  });

  afterEach(() => {
    try { rmSync(outputDir, { recursive: true, force: true }); } catch {}
  });

  it("builds record from metadata.json", () => {
    writeFileSync(join(outputDir, "metadata.json"), JSON.stringify({
      date: "2026-02-18T06:00:00Z",
      durationMs: 45000,
      durationHuman: "45s",
      slugCount: 8,
      publishedCount: 8,
      publishErrors: 0,
      batchOk: true,
      validationOk: true,
      batchOutputDir: join(outputDir, "batch"),
    }));

    const record = buildOpsRecord(outputDir, {
      commitSha: "abc123",
      nameopsCommitSha: "def456",
    });

    assert.equal(record.runId, "nameops-2026-02-18");
    assert.equal(record.date, "2026-02-18T06:00:00Z");
    assert.equal(record.commitSha, "abc123");
    assert.equal(record.nameopsCommitSha, "def456");
    assert.equal(record.totalDurationMs, 45000);
    assert.equal(record.totalDurationHuman, "45s");
    assert.equal(record.slugCount, 8);
    assert.equal(record.publishedCount, 8);
    assert.equal(record.publishErrors, 0);
    assert.equal(record.batchOk, true);
    assert.equal(record.validationOk, true);
    assert.equal(record.minutesEstimate, 1);
  });

  it("aggregates adapter cost stats from batch results", () => {
    writeFileSync(join(outputDir, "metadata.json"), JSON.stringify({
      date: "2026-02-18T06:00:00Z",
      durationMs: 30000,
      batchOutputDir: join(outputDir, "batch", "2026-02-18"),
    }));

    // Create batch results
    const batchResultsDir = join(outputDir, "batch", "2026-02-18", "batch");
    mkdirSync(batchResultsDir, { recursive: true });

    const results = [
      {
        name: "alpha",
        run: {
          checks: [
            { namespace: "npm", cacheHit: true },
            { namespace: "npm", cacheHit: false },
            { namespace: "pypi", cacheHit: true },
          ],
        },
      },
      {
        name: "beta",
        run: {
          checks: [
            { namespace: "npm", cacheHit: true },
            { namespace: "docker", cacheHit: false },
          ],
        },
      },
    ];
    writeFileSync(join(batchResultsDir, "results.json"), JSON.stringify(results));

    const record = buildOpsRecord(outputDir);

    assert.equal(record.costStats.totalApiCalls, 5);
    assert.equal(record.costStats.cachedCalls, 3);
    assert.equal(record.costStats.cacheHitRate, 0.6);
    assert.equal(record.costStats.adapterBreakdown.npm.calls, 3);
    assert.equal(record.costStats.adapterBreakdown.npm.cached, 2);
    assert.equal(record.costStats.adapterBreakdown.pypi.calls, 1);
    assert.equal(record.costStats.adapterBreakdown.docker.calls, 1);
  });

  it("extracts error codes histogram", () => {
    writeFileSync(join(outputDir, "metadata.json"), JSON.stringify({
      date: "2026-02-18T06:00:00Z",
      durationMs: 10000,
      batchOutputDir: join(outputDir, "batch"),
    }));

    const batchDir = join(outputDir, "batch", "batch");
    mkdirSync(batchDir, { recursive: true });

    const results = [
      { name: "a", error: "RATE_LIMIT: too many requests" },
      { name: "b", error: "RATE_LIMIT: throttled" },
      { name: "c", error: "TIMEOUT: adapter timed out" },
      { name: "d", run: { checks: [] } },
    ];
    writeFileSync(join(batchDir, "results.json"), JSON.stringify(results));

    const record = buildOpsRecord(outputDir);

    assert.equal(record.errorCodes.RATE_LIMIT, 2);
    assert.equal(record.errorCodes.TIMEOUT, 1);
  });

  it("handles missing metadata gracefully", () => {
    // No metadata.json at all
    const record = buildOpsRecord(outputDir);

    assert.ok(record.runId.startsWith("nameops-"));
    assert.equal(record.slugCount, 0);
    assert.equal(record.costStats.totalApiCalls, 0);
    assert.equal(record.minutesEstimate, 1);
  });

  it("handles empty batch results", () => {
    writeFileSync(join(outputDir, "metadata.json"), JSON.stringify({
      date: "2026-02-18T06:00:00Z",
      durationMs: 5000,
      slugCount: 0,
    }));

    const record = buildOpsRecord(outputDir);

    assert.equal(record.costStats.totalApiCalls, 0);
    assert.equal(record.costStats.cachedCalls, 0);
    assert.equal(record.costStats.cacheHitRate, 0);
    assert.deepEqual(record.errorCodes, {});
  });
});

describe("appendOpsRecord", () => {
  let historyDir;
  let historyPath;

  beforeEach(() => {
    historyDir = makeTempDir("append");
    historyPath = join(historyDir, "ops-history.json");
  });

  afterEach(() => {
    try { rmSync(historyDir, { recursive: true, force: true }); } catch {}
  });

  it("appends to empty history", () => {
    writeFileSync(historyPath, "[]");

    const record = { runId: "nameops-2026-02-18", date: "2026-02-18T06:00:00Z", slugCount: 8 };
    const result = appendOpsRecord(record, historyPath);

    assert.equal(result.appended, true);
    assert.equal(result.totalEntries, 1);

    const history = JSON.parse(readFileSync(historyPath, "utf8"));
    assert.equal(history.length, 1);
    assert.equal(history[0].runId, "nameops-2026-02-18");
  });

  it("deduplicates by runId", () => {
    writeFileSync(historyPath, JSON.stringify([
      { runId: "nameops-2026-02-18", date: "2026-02-18T06:00:00Z", slugCount: 5 },
      { runId: "nameops-2026-02-11", date: "2026-02-11T06:00:00Z", slugCount: 3 },
    ]));

    const record = { runId: "nameops-2026-02-18", date: "2026-02-18T06:00:00Z", slugCount: 8 };
    const result = appendOpsRecord(record, historyPath);

    assert.equal(result.totalEntries, 2);

    const history = JSON.parse(readFileSync(historyPath, "utf8"));
    const entry = history.find((r) => r.runId === "nameops-2026-02-18");
    assert.equal(entry.slugCount, 8); // replaced with new value
  });

  it("caps at maxEntries", () => {
    const existing = Array.from({ length: 35 }, (_, i) => ({
      runId: `nameops-2026-01-${String(i + 1).padStart(2, "0")}`,
      date: `2026-01-${String(i + 1).padStart(2, "0")}T06:00:00Z`,
    }));
    writeFileSync(historyPath, JSON.stringify(existing));

    const record = { runId: "nameops-2026-02-18", date: "2026-02-18T06:00:00Z" };
    const result = appendOpsRecord(record, historyPath, { maxEntries: 30 });

    assert.equal(result.totalEntries, 30);

    const history = JSON.parse(readFileSync(historyPath, "utf8"));
    assert.equal(history.length, 30);
    assert.equal(history[0].runId, "nameops-2026-02-18"); // newest first
  });

  it("prepends newest record first", () => {
    writeFileSync(historyPath, JSON.stringify([
      { runId: "nameops-2026-02-11", date: "2026-02-11T06:00:00Z" },
    ]));

    const record = { runId: "nameops-2026-02-18", date: "2026-02-18T06:00:00Z" };
    appendOpsRecord(record, historyPath);

    const history = JSON.parse(readFileSync(historyPath, "utf8"));
    assert.equal(history[0].runId, "nameops-2026-02-18");
    assert.equal(history[1].runId, "nameops-2026-02-11");
  });

  it("dry-run does not write", () => {
    writeFileSync(historyPath, "[]");

    const record = { runId: "nameops-2026-02-18", date: "2026-02-18T06:00:00Z" };
    const result = appendOpsRecord(record, historyPath, { dryRun: true });

    assert.equal(result.appended, true);

    const history = JSON.parse(readFileSync(historyPath, "utf8"));
    assert.deepEqual(history, []);
  });

  it("handles missing history file", () => {
    // historyPath doesn't exist yet
    const record = { runId: "nameops-2026-02-18", date: "2026-02-18T06:00:00Z" };
    const result = appendOpsRecord(record, historyPath);

    assert.equal(result.totalEntries, 1);
    assert.ok(existsSync(historyPath));
  });
});

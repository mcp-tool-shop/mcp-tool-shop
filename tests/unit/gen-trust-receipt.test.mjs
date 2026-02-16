/**
 * Unit tests for gen-trust-receipt.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildTrustReceipt } from "../../scripts/gen-trust-receipt.mjs";

// ── Helpers ─────────────────────────────────────────────────

function makeTempDir(label) {
  const dir = join(tmpdir(), `trust-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedDataDir(dir) {
  // Create a minimal data directory structure
  mkdirSync(join(dir, "marketir", "data", "tools"), { recursive: true });
  mkdirSync(join(dir, "marketir", "manifests"), { recursive: true });

  // projects.json
  writeFileSync(join(dir, "projects.json"), JSON.stringify([{ name: "test-project" }]));

  // overrides.json
  writeFileSync(join(dir, "overrides.json"), JSON.stringify({}));

  // worthy.json
  writeFileSync(join(dir, "worthy.json"), JSON.stringify({
    rubric: { criteria: ["License", "Releases"], minimumScore: 1 },
    repos: {
      "tool-a": { worthy: true, score: 2, missing: [] },
      "tool-b": { worthy: false, score: 0, missing: ["License", "Releases"] },
    },
  }));

  // promo.json
  writeFileSync(join(dir, "promo.json"), JSON.stringify({ enabled: false }));

  // baseline.json
  writeFileSync(join(dir, "baseline.json"), JSON.stringify({ runCount: 0 }));

  // ops-history.json
  writeFileSync(join(dir, "ops-history.json"), JSON.stringify([]));

  // promo-decisions.json
  writeFileSync(join(dir, "promo-decisions.json"), JSON.stringify({
    generatedAt: "2026-02-16T00:00:00.000Z",
    decisions: [],
    budget: { tier: 200, headroom: 200, itemsAllowed: 3 },
    warnings: [],
  }));

  // experiment-decisions.json
  writeFileSync(join(dir, "experiment-decisions.json"), JSON.stringify({
    generatedAt: "2026-02-16T00:00:00.000Z",
    evaluations: [],
    warnings: [],
  }));

  // MarketIR snapshot
  writeFileSync(join(dir, "marketir", "marketir.snapshot.json"), JSON.stringify({
    lockSha256: "abc123def456",
    fileCount: 7,
  }));

  // MarketIR tool with proven claims
  writeFileSync(join(dir, "marketir", "data", "tools", "test-tool.json"), JSON.stringify({
    claims: [
      { id: "c1", status: "proven", text: "Fast" },
      { id: "c2", status: "aspirational", text: "Fastest" },
      { id: "c3", status: "proven", text: "Reliable" },
    ],
  }));
}

// ── Tests ───────────────────────────────────────────────────

describe("buildTrustReceipt", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir("receipt");
    seedDataDir(tempDir);
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("receipt includes commit SHA", () => {
    const receipt = buildTrustReceipt({ dataDir: tempDir });
    assert.ok(receipt.commit, "commit should be present");
    assert.ok(typeof receipt.commit === "string");
    // In a git repo, commit should not be "unknown"
    // (we're running tests from within the git repo)
    assert.notEqual(receipt.commit, "");
  });

  it("receipt includes marketirLockHash from snapshot", () => {
    const receipt = buildTrustReceipt({ dataDir: tempDir });
    assert.equal(receipt.marketirLockHash, "abc123def456");
  });

  it("receipt includes provenClaims count", () => {
    const receipt = buildTrustReceipt({ dataDir: tempDir });
    // test-tool.json has 2 proven claims (c1 and c3)
    assert.equal(receipt.provenClaims, 2);
  });

  it("receipt includes worthyStats", () => {
    const receipt = buildTrustReceipt({ dataDir: tempDir });
    assert.deepEqual(receipt.worthyStats, {
      total: 2,
      worthy: 1,
      notWorthy: 1,
    });
  });

  it("artifact manifest has SHA-256 hashes for data files", () => {
    const receipt = buildTrustReceipt({ dataDir: tempDir });
    const manifest = receipt.artifactManifest;

    // All seeded files should be hashed
    assert.ok(manifest["projects.json"], "projects.json should be hashed");
    assert.ok(manifest["overrides.json"], "overrides.json should be hashed");
    assert.ok(manifest["worthy.json"], "worthy.json should be hashed");
    assert.ok(manifest["promo.json"], "promo.json should be hashed");
    assert.ok(manifest["baseline.json"], "baseline.json should be hashed");
    assert.ok(manifest["ops-history.json"], "ops-history.json should be hashed");
    assert.ok(manifest["promo-decisions.json"], "promo-decisions.json should be hashed");
    assert.ok(manifest["experiment-decisions.json"], "experiment-decisions.json should be hashed");

    // All hashes should start with "sha256:"
    for (const [, hash] of Object.entries(manifest)) {
      assert.ok(hash.startsWith("sha256:"), `hash should start with sha256: prefix`);
      assert.ok(hash.length > 10, "hash should be non-trivial");
    }
  });

  it("missing snapshot/worthy files produce safe defaults", () => {
    // Use an empty directory
    const emptyDir = makeTempDir("empty");
    try {
      const receipt = buildTrustReceipt({ dataDir: emptyDir });

      assert.equal(receipt.marketirLockHash, null);
      assert.equal(receipt.provenClaims, 0);
      assert.deepEqual(receipt.worthyStats, { total: 0, worthy: 0, notWorthy: 0 });
      assert.deepEqual(receipt.artifactManifest, {});
    } finally {
      try { rmSync(emptyDir, { recursive: true, force: true }); } catch {}
    }
  });
});

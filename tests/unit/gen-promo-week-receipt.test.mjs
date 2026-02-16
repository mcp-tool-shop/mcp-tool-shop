import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPromoWeekReceipt } from "../../scripts/gen-promo-week-receipt.mjs";

function makeTempDir() {
  const dir = join(tmpdir(), `receipt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("gen-promo-week-receipt", () => {
  let dataDir;
  let publicDir;

  beforeEach(() => {
    dataDir = makeTempDir();
    publicDir = makeTempDir();
    // Seed minimal data files
    writeFileSync(join(dataDir, "governance.json"), JSON.stringify({ version: 1 }));
    writeFileSync(join(dataDir, "promo-decisions.json"), JSON.stringify({ decisions: [] }));
    writeFileSync(join(dataDir, "experiment-decisions.json"), JSON.stringify({ experiments: [] }));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(publicDir, { recursive: true, force: true });
  });

  it("receipt includes all required fields", () => {
    writeFileSync(join(publicDir, "trust.json"), JSON.stringify({ trust: true }));
    const receipt = buildPromoWeekReceipt({ dataDir, publicDir, week: "2026-02-17" });
    assert.ok(receipt.generatedAt, "generatedAt should be present");
    assert.ok(receipt.week, "week should be present");
    assert.ok(receipt.trustReceiptHash !== undefined, "trustReceiptHash should be present");
    assert.ok(receipt.inputs, "inputs should be present");
    assert.ok(receipt.artifactManifestSubset, "artifactManifestSubset should be present");
  });

  it("SHA hashes are valid sha256 format", () => {
    writeFileSync(join(publicDir, "trust.json"), JSON.stringify({ trust: true }));
    const receipt = buildPromoWeekReceipt({ dataDir, publicDir, week: "2026-02-17" });

    const allHashes = [
      receipt.trustReceiptHash,
      receipt.inputs.promoDecisionsSha,
      receipt.inputs.experimentDecisionsSha,
      receipt.inputs.governanceSha,
      receipt.artifactManifestSubset["promo-decisions.json"],
      receipt.artifactManifestSubset["experiment-decisions.json"],
      receipt.artifactManifestSubset["governance.json"],
    ];

    for (const hash of allHashes) {
      assert.ok(hash !== null, "hash should not be null when file exists");
      assert.ok(hash.startsWith("sha256:"), `hash should start with "sha256:", got: ${hash}`);
      assert.ok(hash.length > 10, `hash should have length > 10, got: ${hash.length}`);
    }
  });

  it("week field matches input", () => {
    const receipt = buildPromoWeekReceipt({ dataDir, publicDir, week: "2026-02-17" });
    assert.equal(receipt.week, "2026-02-17");
  });

  it("missing trust.json → null hash", () => {
    // Do NOT seed trust.json in publicDir
    const receipt = buildPromoWeekReceipt({ dataDir, publicDir, week: "2026-02-17" });
    assert.equal(receipt.trustReceiptHash, null);
  });

  it("generatedAt is valid ISO date", () => {
    const receipt = buildPromoWeekReceipt({ dataDir, publicDir, week: "2026-02-17" });
    const parsed = new Date(receipt.generatedAt);
    assert.ok(!isNaN(parsed.getTime()), "generatedAt should be a valid ISO date");
  });
});

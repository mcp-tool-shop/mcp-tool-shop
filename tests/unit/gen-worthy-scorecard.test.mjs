/**
 * Unit tests for gen-worthy-scorecard.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildScorecard, generateScorecards } from "../../scripts/gen-worthy-scorecard.mjs";

function makeTempDir(label) {
  const dir = join(tmpdir(), `worthy-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const RUBRIC = {
  criteria: [
    "License is OSI-approved",
    "At least 1 release published",
    "README has install + usage",
    "Activity within last 90 days",
    "No known security issues",
  ],
  minimumScore: 3,
};

describe("buildScorecard", () => {
  it("worthy repo produces scorecard with all checks passed", () => {
    const entry = {
      worthy: true,
      score: 5,
      assessedDate: "2026-02-16",
      reason: "Flagship tool",
      missing: [],
    };

    const md = buildScorecard("zip-meta-map", entry, RUBRIC);
    assert.ok(md.includes("# Scorecard: zip-meta-map"));
    assert.ok(md.includes("**Status:** Worthy"));
    assert.ok(md.includes("5/5"));

    // All criteria should have check marks
    for (const c of RUBRIC.criteria) {
      assert.ok(md.includes(`\u2705 ${c}`), `should show checkmark for: ${c}`);
    }

    // Should NOT have Next Steps
    assert.ok(!md.includes("## Next Steps"));
  });

  it("non-worthy repo shows X marks for missing criteria", () => {
    const entry = {
      worthy: false,
      score: 2,
      assessedDate: "2026-02-16",
      reason: "Missing docs and release",
      missing: ["At least 1 release published", "README has install + usage"],
    };

    const md = buildScorecard("bad-tool", entry, RUBRIC);
    assert.ok(md.includes("**Status:** Not Worthy"));
    assert.ok(md.includes("2/5"));
    assert.ok(md.includes("\u274c At least 1 release published"));
    assert.ok(md.includes("\u274c README has install + usage"));
    assert.ok(md.includes("\u2705 License is OSI-approved"));

    // Should have Next Steps section
    assert.ok(md.includes("## Next Steps"));
    assert.ok(md.includes("Address: At least 1 release published"));
  });
});

describe("generateScorecards", () => {
  let tempDir, outDir;

  beforeEach(() => {
    tempDir = makeTempDir("scorecards");
    outDir = join(tempDir, "output");
    mkdirSync(outDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("empty repos object handled gracefully", () => {
    const worthyPath = join(tempDir, "worthy.json");
    writeFileSync(worthyPath, JSON.stringify({
      rubric: RUBRIC,
      repos: {},
    }));

    const result = generateScorecards(worthyPath, outDir);
    assert.equal(result.generated, 0);
    assert.equal(result.skipped, 0);
  });

  it("dry-run does not write files", () => {
    const worthyPath = join(tempDir, "worthy.json");
    writeFileSync(worthyPath, JSON.stringify({
      rubric: RUBRIC,
      repos: {
        "test-tool": { worthy: true, score: 5, reason: "test", missing: [] },
      },
    }));

    const result = generateScorecards(worthyPath, outDir, { dryRun: true });
    assert.equal(result.generated, 1);

    // File should NOT exist
    assert.ok(!existsSync(join(outDir, "test-tool", "scorecard.md")));
  });

  it("writes scorecard files to output directory", () => {
    const worthyPath = join(tempDir, "worthy.json");
    writeFileSync(worthyPath, JSON.stringify({
      rubric: RUBRIC,
      repos: {
        "alpha": { worthy: true, score: 5, reason: "great", missing: [] },
        "beta": { worthy: false, score: 2, reason: "needs work", missing: ["At least 1 release published"] },
      },
    }));

    const result = generateScorecards(worthyPath, outDir);
    assert.equal(result.generated, 2);

    // Alpha scorecard should exist
    const alphaMd = readFileSync(join(outDir, "alpha", "scorecard.md"), "utf8");
    assert.ok(alphaMd.includes("# Scorecard: alpha"));
    assert.ok(alphaMd.includes("Worthy"));

    // Beta scorecard should exist
    const betaMd = readFileSync(join(outDir, "beta", "scorecard.md"), "utf8");
    assert.ok(betaMd.includes("Not Worthy"));
    assert.ok(betaMd.includes("## Next Steps"));
  });
});

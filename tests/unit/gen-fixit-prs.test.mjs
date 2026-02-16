/**
 * Unit tests for gen-fixit-prs.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectGaps, generateFixTemplate, generateFixitPrs } from "../../scripts/gen-fixit-prs.mjs";

// ── Helpers ─────────────────────────────────────────────────

function makeTempDir(label) {
  const dir = join(tmpdir(), `fixit-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

// ── detectGaps ──────────────────────────────────────────────

describe("detectGaps", () => {
  it("gaps detected for non-worthy repo with missing criteria", () => {
    const worthy = {
      rubric: RUBRIC,
      repos: {
        "bad-tool": {
          worthy: false,
          score: 2,
          reason: "Missing docs",
          missing: ["License is OSI-approved", "README has install + usage"],
        },
      },
    };

    const gaps = detectGaps(worthy);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].slug, "bad-tool");
    assert.equal(gaps[0].missing.length, 2);
    assert.ok(gaps[0].missing.includes("License is OSI-approved"));
  });

  it("no gaps for fully-worthy repo", () => {
    const worthy = {
      rubric: RUBRIC,
      repos: {
        "good-tool": {
          worthy: true,
          score: 5,
          reason: "Complete",
          missing: [],
        },
      },
    };

    const gaps = detectGaps(worthy);
    assert.equal(gaps.length, 0);
  });

  it("repos in automation.ignore.json are skipped", () => {
    const worthy = {
      rubric: RUBRIC,
      repos: {
        "ignored-tool": {
          worthy: false,
          score: 1,
          reason: "Missing everything",
          missing: ["License is OSI-approved"],
        },
      },
    };

    const gaps = detectGaps(worthy, { ignoreList: ["ignored-tool"] });
    assert.equal(gaps.length, 0);
  });

  it("empty worthy.json repos returns empty gaps", () => {
    const gaps = detectGaps({ repos: {} });
    assert.equal(gaps.length, 0);
  });

  it("null worthy returns empty gaps", () => {
    const gaps = detectGaps(null);
    assert.equal(gaps.length, 0);
  });
});

// ── generateFixTemplate ─────────────────────────────────────

describe("generateFixTemplate", () => {
  it("template generated for fixable criteria (License)", () => {
    const result = generateFixTemplate("my-tool", "License is OSI-approved");
    assert.equal(result.fixable, true);
    assert.equal(result.filename, "LICENSE.md");
    assert.ok(result.content.includes("MIT License"));
    assert.ok(result.content.includes("mcp-tool-shop-org"));
  });

  it("template generated for fixable criteria (README)", () => {
    const result = generateFixTemplate("my-tool", "README has install + usage");
    assert.equal(result.fixable, true);
    assert.equal(result.filename, "README-sections.md");
    assert.ok(result.content.includes("my-tool"));
    assert.ok(result.content.includes("## Install"));
    assert.ok(result.content.includes("## Usage"));
  });

  it("non-fixable criteria produce info-only entry", () => {
    const result = generateFixTemplate("my-tool", "At least 1 release published");
    assert.equal(result.fixable, false);
    assert.equal(result.filename, null);
    assert.equal(result.content, null);
    assert.ok(result.info.includes("Publish a release"));
  });

  it("unknown criteria produce info-only entry", () => {
    const result = generateFixTemplate("my-tool", "Some unknown criterion");
    assert.equal(result.fixable, false);
    assert.ok(result.info.includes("Unknown criterion"));
  });
});

// ── generateFixitPrs (integration) ──────────────────────────

describe("generateFixitPrs", () => {
  let tempDir, outDir;

  beforeEach(() => {
    tempDir = makeTempDir("fixit");
    outDir = join(tempDir, "output");
    mkdirSync(outDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("dry-run writes no files", () => {
    writeFileSync(join(tempDir, "worthy.json"), JSON.stringify({
      rubric: RUBRIC,
      repos: {
        "test-tool": { worthy: false, score: 2, reason: "test", missing: ["License is OSI-approved"] },
      },
    }));
    writeFileSync(join(tempDir, "automation.ignore.json"), "[]");

    const result = generateFixitPrs({ dataDir: tempDir, outDir, dryRun: true });
    assert.equal(result.gaps, 1);
    assert.equal(result.templates, 1);

    // Should NOT have written any files
    assert.ok(!existsSync(join(outDir, "test-tool")));
  });

  it("writes templates for gaps", () => {
    writeFileSync(join(tempDir, "worthy.json"), JSON.stringify({
      rubric: RUBRIC,
      repos: {
        "fix-me": {
          worthy: false,
          score: 2,
          reason: "needs work",
          missing: ["License is OSI-approved", "No known security issues", "At least 1 release published"],
        },
      },
    }));
    writeFileSync(join(tempDir, "automation.ignore.json"), "[]");

    const result = generateFixitPrs({ dataDir: tempDir, outDir });
    assert.equal(result.gaps, 1);
    assert.equal(result.templates, 2);  // LICENSE + SECURITY
    assert.equal(result.infos, 1);      // release is info-only

    // Check files exist
    assert.ok(existsSync(join(outDir, "fix-me", "LICENSE.md")));
    assert.ok(existsSync(join(outDir, "fix-me", "SECURITY.md")));
    assert.ok(existsSync(join(outDir, "fix-me", "summary.md")));

    // Verify LICENSE content
    const license = readFileSync(join(outDir, "fix-me", "LICENSE.md"), "utf8");
    assert.ok(license.includes("MIT License"));

    // Verify summary content
    const summary = readFileSync(join(outDir, "fix-me", "summary.md"), "utf8");
    assert.ok(summary.includes("Fix-It: fix-me"));
    assert.ok(summary.includes("License is OSI-approved"));
  });
});

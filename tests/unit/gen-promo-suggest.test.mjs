/**
 * Unit tests for gen-promo-suggest.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeCandidates } from "../../scripts/gen-promo-suggest.mjs";

// ── Helpers ─────────────────────────────────────────────────

function makeTempDir(label) {
  const dir = join(tmpdir(), `suggest-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeWorthy(repos = {}) {
  return {
    rubric: { criteria: ["License", "Releases"], minimumScore: 1 },
    repos,
  };
}

function makeClearanceReport(slug, score = 95) {
  return {
    slug,
    overallScore: score,
    tier: score >= 80 ? "GREEN" : score >= 50 ? "YELLOW" : "RED",
    assessedAt: "2026-02-16T06:00:00Z",
  };
}

// ── analyzeCandidates ───────────────────────────────────────

describe("analyzeCandidates", () => {
  let clearanceDir;

  beforeEach(() => {
    clearanceDir = makeTempDir("clearance");
  });

  afterEach(() => {
    try { rmSync(clearanceDir, { recursive: true, force: true }); } catch {}
  });

  it("GREEN candidate + worthy = suggested", () => {
    writeFileSync(join(clearanceDir, "tool-a.json"), JSON.stringify(makeClearanceReport("tool-a", 95)));

    const worthy = makeWorthy({
      "tool-a": { worthy: true, score: 2, missing: [] },
    });

    const suggestions = analyzeCandidates(clearanceDir, worthy);
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].slug, "tool-a");
    assert.equal(suggestions[0].score, 95);
    assert.equal(suggestions[0].worthy, true);
    assert.ok(suggestions[0].channels.length > 0);
  });

  it("GREEN candidate + not worthy = not suggested", () => {
    writeFileSync(join(clearanceDir, "tool-b.json"), JSON.stringify(makeClearanceReport("tool-b", 90)));

    const worthy = makeWorthy({
      "tool-b": { worthy: false, score: 1, missing: ["License"] },
    });

    const suggestions = analyzeCandidates(clearanceDir, worthy);
    assert.equal(suggestions.length, 0);
  });

  it("already-queued slug = not suggested", () => {
    writeFileSync(join(clearanceDir, "tool-c.json"), JSON.stringify(makeClearanceReport("tool-c", 92)));

    const worthy = makeWorthy({
      "tool-c": { worthy: true, score: 2, missing: [] },
    });

    const queue = { slugs: ["tool-c"], promotionType: "own" };
    const suggestions = analyzeCandidates(clearanceDir, worthy, { queue });
    assert.equal(suggestions.length, 0);
  });

  it("ignored slug = not suggested", () => {
    writeFileSync(join(clearanceDir, "tool-d.json"), JSON.stringify(makeClearanceReport("tool-d", 88)));

    const worthy = makeWorthy({
      "tool-d": { worthy: true, score: 2, missing: [] },
    });

    const suggestions = analyzeCandidates(clearanceDir, worthy, { ignoreList: ["tool-d"] });
    assert.equal(suggestions.length, 0);
  });

  it("empty clearance directory = empty suggestions", () => {
    const emptyDir = makeTempDir("empty-clearance");
    try {
      const worthy = makeWorthy({ "tool-e": { worthy: true, score: 2, missing: [] } });
      const suggestions = analyzeCandidates(emptyDir, worthy);
      assert.equal(suggestions.length, 0);
    } finally {
      try { rmSync(emptyDir, { recursive: true, force: true }); } catch {}
    }
  });

  it("below-threshold score = not suggested", () => {
    writeFileSync(join(clearanceDir, "tool-f.json"), JSON.stringify(makeClearanceReport("tool-f", 60)));

    const worthy = makeWorthy({
      "tool-f": { worthy: true, score: 2, missing: [] },
    });

    const suggestions = analyzeCandidates(clearanceDir, worthy);
    assert.equal(suggestions.length, 0);
  });
});

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ingestClearance } from "../../scripts/ingest-clearance.mjs";

/**
 * Creates a temp directory with a unique name for test isolation.
 */
function makeTempDir(label) {
  const dir = join(tmpdir(), `ingest-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("ingestClearance", () => {
  let sourceDir;
  let destDir;

  beforeEach(() => {
    sourceDir = makeTempDir("src");
    destDir = makeTempDir("dest");
  });

  afterEach(() => {
    try { rmSync(sourceDir, { recursive: true, force: true }); } catch {}
    try { rmSync(destDir, { recursive: true, force: true }); } catch {}
  });

  it("merges source entries into empty dest", () => {
    // Source runs.json with 2 entries
    const sourceEntries = [
      { name: "alpha", slug: "alpha", tier: "GREEN", score: 85, date: "2026-02-16" },
      { name: "beta", slug: "beta", tier: "YELLOW", score: 45, date: "2026-02-15" },
    ];
    writeFileSync(join(sourceDir, "runs.json"), JSON.stringify(sourceEntries));

    // Create slug dirs with files
    for (const entry of sourceEntries) {
      const slugDir = join(sourceDir, entry.slug);
      mkdirSync(slugDir, { recursive: true });
      writeFileSync(join(slugDir, "report.html"), `<html>${entry.name}</html>`);
      writeFileSync(join(slugDir, "summary.json"), JSON.stringify({ name: entry.name }));
      writeFileSync(join(slugDir, "clearance-index.json"), JSON.stringify({ name: entry.name }));
      writeFileSync(join(slugDir, "run.json"), JSON.stringify({ name: entry.name }));
    }

    // Empty dest runs.json
    writeFileSync(join(destDir, "runs.json"), "[]");

    const result = ingestClearance(sourceDir, destDir);

    assert.equal(result.merged, 2);
    assert.equal(result.copied, 8); // 4 files × 2 slugs
    assert.equal(result.skipped, 0);

    // Verify merged runs.json
    const merged = JSON.parse(readFileSync(join(destDir, "runs.json"), "utf8"));
    assert.equal(merged.length, 2);
    assert.equal(merged[0].slug, "alpha"); // newest first
    assert.equal(merged[1].slug, "beta");
  });

  it("deduplicates by slug (source replaces dest)", () => {
    // Dest has an older alpha entry
    writeFileSync(join(destDir, "runs.json"), JSON.stringify([
      { name: "alpha", slug: "alpha", tier: "YELLOW", score: 30, date: "2026-01-01" },
      { name: "gamma", slug: "gamma", tier: "GREEN", score: 90, date: "2026-01-15" },
    ]));

    // Source has a newer alpha entry
    const sourceEntries = [
      { name: "alpha", slug: "alpha", tier: "GREEN", score: 85, date: "2026-02-16" },
    ];
    writeFileSync(join(sourceDir, "runs.json"), JSON.stringify(sourceEntries));

    const slugDir = join(sourceDir, "alpha");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "report.html"), "<html>alpha v2</html>");
    writeFileSync(join(slugDir, "summary.json"), "{}");
    writeFileSync(join(slugDir, "clearance-index.json"), "{}");
    writeFileSync(join(slugDir, "run.json"), "{}");

    const result = ingestClearance(sourceDir, destDir);

    assert.equal(result.merged, 2); // alpha (updated) + gamma (kept)

    const merged = JSON.parse(readFileSync(join(destDir, "runs.json"), "utf8"));
    const alphaEntry = merged.find((e) => e.slug === "alpha");
    assert.equal(alphaEntry.tier, "GREEN"); // replaced with source
    assert.equal(alphaEntry.score, 85);

    // gamma should still be there
    const gammaEntry = merged.find((e) => e.slug === "gamma");
    assert.ok(gammaEntry);
  });

  it("sorts merged entries by date descending", () => {
    writeFileSync(join(destDir, "runs.json"), JSON.stringify([
      { name: "old", slug: "old", tier: "GREEN", score: 70, date: "2025-12-01" },
    ]));

    writeFileSync(join(sourceDir, "runs.json"), JSON.stringify([
      { name: "new", slug: "new", tier: "GREEN", score: 90, date: "2026-02-16" },
      { name: "mid", slug: "mid", tier: "YELLOW", score: 50, date: "2026-01-15" },
    ]));

    // Create slug dirs
    for (const slug of ["new", "mid"]) {
      const dir = join(sourceDir, slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "report.html"), "<html></html>");
    }

    const result = ingestClearance(sourceDir, destDir);

    const merged = JSON.parse(readFileSync(join(destDir, "runs.json"), "utf8"));
    assert.equal(merged[0].slug, "new");   // 2026-02-16
    assert.equal(merged[1].slug, "mid");   // 2026-01-15
    assert.equal(merged[2].slug, "old");   // 2025-12-01
  });

  it("handles empty source gracefully", () => {
    writeFileSync(join(sourceDir, "runs.json"), "[]");
    writeFileSync(join(destDir, "runs.json"), JSON.stringify([
      { name: "existing", slug: "existing", tier: "GREEN", score: 80, date: "2026-02-10" },
    ]));

    const result = ingestClearance(sourceDir, destDir);

    assert.equal(result.merged, 0);
    assert.equal(result.copied, 0);
  });

  it("handles missing source runs.json", () => {
    // No runs.json in source dir at all
    writeFileSync(join(destDir, "runs.json"), "[]");

    const result = ingestClearance(sourceDir, destDir);

    assert.equal(result.merged, 0);
  });

  it("copies per-slug files to dest directory", () => {
    writeFileSync(join(sourceDir, "runs.json"), JSON.stringify([
      { name: "test-tool", slug: "test-tool", tier: "GREEN", score: 95, date: "2026-02-16" },
    ]));

    const slugDir = join(sourceDir, "test-tool");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "report.html"), "<html>test report</html>");
    writeFileSync(join(slugDir, "summary.json"), '{"name":"test-tool"}');
    writeFileSync(join(slugDir, "clearance-index.json"), '{"name":"test-tool"}');
    writeFileSync(join(slugDir, "run.json"), '{"name":"test-tool"}');

    ingestClearance(sourceDir, destDir);

    // Verify files were copied
    const destSlugDir = join(destDir, "test-tool");
    assert.ok(existsSync(join(destSlugDir, "report.html")));
    assert.ok(existsSync(join(destSlugDir, "summary.json")));
    assert.ok(existsSync(join(destSlugDir, "clearance-index.json")));
    assert.ok(existsSync(join(destSlugDir, "run.json")));

    // Verify content
    const html = readFileSync(join(destSlugDir, "report.html"), "utf8");
    assert.equal(html, "<html>test report</html>");
  });

  it("dry-run does not write files", () => {
    writeFileSync(join(sourceDir, "runs.json"), JSON.stringify([
      { name: "dry", slug: "dry", tier: "GREEN", score: 50, date: "2026-02-16" },
    ]));

    const slugDir = join(sourceDir, "dry");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "report.html"), "<html>dry</html>");

    writeFileSync(join(destDir, "runs.json"), "[]");

    const result = ingestClearance(sourceDir, destDir, { dryRun: true });

    // Should report counts but not actually write
    assert.equal(result.merged, 1);

    // Dest should still be empty array
    const destRuns = JSON.parse(readFileSync(join(destDir, "runs.json"), "utf8"));
    assert.deepEqual(destRuns, []);

    // No slug directory created
    assert.ok(!existsSync(join(destDir, "dry")));
  });

  it("skips entries with missing source directory", () => {
    writeFileSync(join(sourceDir, "runs.json"), JSON.stringify([
      { name: "exists", slug: "exists", tier: "GREEN", score: 90, date: "2026-02-16" },
      { name: "missing", slug: "missing", tier: "RED", score: 20, date: "2026-02-15" },
    ]));

    // Only create one slug dir
    const existsDir = join(sourceDir, "exists");
    mkdirSync(existsDir, { recursive: true });
    writeFileSync(join(existsDir, "report.html"), "<html>exists</html>");

    const result = ingestClearance(sourceDir, destDir);

    assert.equal(result.skipped, 1);
    assert.ok(existsSync(join(destDir, "exists", "report.html")));
    assert.ok(!existsSync(join(destDir, "missing")));
  });
});

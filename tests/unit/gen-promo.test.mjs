import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { isPromotionEnabled, loadPromoQueue, generatePromoReport, generateCampaignBundle } from "../../scripts/gen-promo.mjs";

function makeTempDir(label) {
  const dir = join(tmpdir(), `promo-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("isPromotionEnabled", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir("enabled");
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("returns true when enabled", () => {
    const p = join(tempDir, "promo.json");
    writeFileSync(p, JSON.stringify({ enabled: true }));
    assert.equal(isPromotionEnabled(p), true);
  });

  it("returns false when disabled", () => {
    const p = join(tempDir, "promo.json");
    writeFileSync(p, JSON.stringify({ enabled: false }));
    assert.equal(isPromotionEnabled(p), false);
  });

  it("returns false when file missing", () => {
    const p = join(tempDir, "nonexistent.json");
    assert.equal(isPromotionEnabled(p), false);
  });
});

describe("loadPromoQueue", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir("queue");
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("loads queue with slugs", () => {
    const p = join(tempDir, "queue.json");
    writeFileSync(p, JSON.stringify({
      week: "2026-02-17",
      slugs: [{ slug: "zip-meta-map", channels: ["presskit"], reason: "launch" }],
      promotionType: "own",
    }));

    const queue = loadPromoQueue(p);
    assert.equal(queue.week, "2026-02-17");
    assert.equal(queue.slugs.length, 1);
    assert.equal(queue.slugs[0].slug, "zip-meta-map");
  });

  it("returns empty defaults for missing file", () => {
    const p = join(tempDir, "nonexistent.json");
    const queue = loadPromoQueue(p);
    assert.deepEqual(queue.slugs, []);
    assert.equal(queue.promotionType, "own");
  });
});

describe("generatePromoReport", () => {
  it("generates report with results", () => {
    const queue = {
      week: "2026-02-17",
      slugs: [{ slug: "alpha" }],
      promotionType: "own",
    };
    const results = [
      { slug: "alpha", channel: "presskit", ok: true },
      { slug: "alpha", channel: "snippets", ok: false, error: "missing data" },
    ];

    const report = generatePromoReport(queue, results);
    assert.ok(report.includes("# Promotion Report"));
    assert.ok(report.includes("2026-02-17"));
    assert.ok(report.includes("alpha"));
    assert.ok(report.includes("OK"));
    assert.ok(report.includes("FAIL: missing data"));
    assert.ok(report.includes("1 succeeded, 1 failed"));
  });

  it("generates empty report for no results", () => {
    const queue = { week: "2026-02-17", slugs: [], promotionType: "own" };
    const report = generatePromoReport(queue, []);
    assert.ok(report.includes("No promotion actions taken"));
  });
});

describe("generateCampaignBundle", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir("campaign");
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("generates bundle when campaign is present", () => {
    const queue = {
      week: "2026-02-17",
      slugs: [{ slug: "zip-meta-map" }],
      promotionType: "own",
      campaign: {
        id: "zmm-launch-2026-02",
        goal: "Drive first 10 GitHub stars",
        period: { start: "2026-02-17", end: "2026-03-03" },
      },
    };
    const results = [{ slug: "zip-meta-map", channel: "presskit", ok: true }];
    const outDir = join(tempDir, "bundles", queue.campaign.id);

    const result = generateCampaignBundle(queue, results, { outDir });
    assert.equal(result.generated, true);

    // Verify JSON bundle
    const bundleJson = JSON.parse(readFileSync(join(outDir, "promo-bundle.json"), "utf8"));
    assert.equal(bundleJson.campaignId, "zmm-launch-2026-02");
    assert.equal(bundleJson.goal, "Drive first 10 GitHub stars");
    assert.deepEqual(bundleJson.slugs, ["zip-meta-map"]);
    assert.ok(bundleJson.links["zip-meta-map"]);
    assert.ok(bundleJson.links["zip-meta-map"].pressPage.includes("/press/zip-meta-map/"));

    // Verify markdown bundle
    const bundleMd = readFileSync(join(outDir, "promo-bundle.md"), "utf8");
    assert.ok(bundleMd.includes("zmm-launch-2026-02"));
    assert.ok(bundleMd.includes("zip-meta-map"));
    assert.ok(bundleMd.includes("Press"));
  });

  it("skips when campaign is absent", () => {
    const queue = {
      week: "2026-02-17",
      slugs: [{ slug: "zip-meta-map" }],
      promotionType: "own",
    };
    const result = generateCampaignBundle(queue, []);
    assert.equal(result.generated, false);
  });

  it("promo-bundle.md includes all slug links", () => {
    const queue = {
      week: "2026-02-17",
      slugs: ["alpha", "beta"],
      promotionType: "own",
      campaign: {
        id: "multi-launch",
        goal: "Multi-tool launch",
        period: { start: "2026-02-17", end: "2026-03-03" },
      },
    };
    const outDir = join(tempDir, "bundles", "multi-launch");

    generateCampaignBundle(queue, [], { outDir });
    const md = readFileSync(join(outDir, "promo-bundle.md"), "utf8");
    assert.ok(md.includes("alpha"), "should include alpha slug");
    assert.ok(md.includes("beta"), "should include beta slug");
    assert.ok(md.includes("/press/alpha/"), "should have alpha press link");
    assert.ok(md.includes("/press/beta/"), "should have beta press link");
  });
});

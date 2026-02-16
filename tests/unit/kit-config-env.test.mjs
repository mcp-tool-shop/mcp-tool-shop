import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadKitConfig, getConfig, getRoot, resetConfigCache } from "../../scripts/lib/config.mjs";
import { bootstrap } from "../../scripts/kit-bootstrap.mjs";

// ── Temp dir helper ─────────────────────────────────────────

let tmpDir;
let originalEnv;

beforeEach(() => {
  tmpDir = join(tmpdir(), `test-kitconfig-env-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmpDir, { recursive: true });
  originalEnv = process.env.KIT_CONFIG;
  delete process.env.KIT_CONFIG;
  resetConfigCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv !== undefined) {
    process.env.KIT_CONFIG = originalEnv;
  } else {
    delete process.env.KIT_CONFIG;
  }
  resetConfigCache();
});

// ── KIT_CONFIG env var ──────────────────────────────────────

describe("KIT_CONFIG env var", () => {
  it("getRoot() returns env var dirname when KIT_CONFIG points to valid file", () => {
    writeFileSync(join(tmpDir, "kit.config.json"), JSON.stringify({ kitVersion: 1 }));
    process.env.KIT_CONFIG = join(tmpDir, "kit.config.json");
    resetConfigCache();

    const root = getRoot();
    assert.equal(root, tmpDir);
  });

  it("getRoot() falls back to auto-discovery when KIT_CONFIG file missing", () => {
    process.env.KIT_CONFIG = join(tmpDir, "nonexistent", "kit.config.json");
    resetConfigCache();

    const root = getRoot();
    // Should fall back to auto-discovery (repo root), not the nonexistent dir
    assert.ok(!root.includes("nonexistent"), "should not use missing config path");
  });

  it("getConfig() loads config from KIT_CONFIG path", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({
        kitVersion: 1,
        org: { name: "env-test-org" },
        site: { title: "Env Test Site" },
      })
    );
    process.env.KIT_CONFIG = join(tmpDir, "kit.config.json");
    resetConfigCache();

    const config = getConfig();
    assert.equal(config.org.name, "env-test-org");
    assert.equal(config.site.title, "Env Test Site");
  });

  it("loadKitConfig(getRoot()) loads env var config", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({
        kitVersion: 1,
        org: { name: "direct-load-org" },
      })
    );
    process.env.KIT_CONFIG = join(tmpDir, "kit.config.json");
    resetConfigCache();

    const config = loadKitConfig(getRoot());
    assert.equal(config.org.name, "direct-load-org");
  });

  it("resetConfigCache() causes re-evaluation of env var", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, org: { name: "first" } })
    );
    process.env.KIT_CONFIG = join(tmpDir, "kit.config.json");
    resetConfigCache();

    assert.equal(getConfig().org.name, "first");

    // Change env var to point elsewhere
    const tmpDir2 = join(tmpdir(), `test-kitconfig-env2-${Date.now()}`);
    mkdirSync(tmpDir2, { recursive: true });
    writeFileSync(
      join(tmpDir2, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, org: { name: "second" } })
    );
    process.env.KIT_CONFIG = join(tmpDir2, "kit.config.json");
    resetConfigCache();

    assert.equal(getConfig().org.name, "second");

    // Cleanup tmpDir2
    rmSync(tmpDir2, { recursive: true, force: true });
  });

  it("getRoot() without env var returns auto-discovered root", () => {
    delete process.env.KIT_CONFIG;
    resetConfigCache();

    const root = getRoot();
    // Should find the repo root (which has kit.config.json)
    assert.ok(existsSync(join(root, "kit.config.json")), "auto-discovered root should have kit.config.json");
  });
});

// ── KIT_CONFIG + bootstrap integration ──────────────────────

describe("KIT_CONFIG + bootstrap", () => {
  it("bootstrap with KIT_CONFIG creates seeds in env var root", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({
        kitVersion: 1,
        paths: { dataDir: "data", publicDir: "public" },
      })
    );
    process.env.KIT_CONFIG = join(tmpDir, "kit.config.json");
    resetConfigCache();

    const result = bootstrap(tmpDir);
    assert.equal(result.success, true);
    assert.ok(result.created.length > 0, "should create files");
    assert.ok(existsSync(join(tmpDir, "data", "governance.json")), "governance.json in data/");
    assert.ok(existsSync(join(tmpDir, "data", "promo-queue.json")), "promo-queue.json in data/");
  });

  it("bootstrap is idempotent with KIT_CONFIG", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({
        kitVersion: 1,
        paths: { dataDir: "data", publicDir: "public" },
      })
    );
    process.env.KIT_CONFIG = join(tmpDir, "kit.config.json");
    resetConfigCache();

    const result1 = bootstrap(tmpDir);
    assert.equal(result1.success, true);
    const createdCount = result1.created.length;

    resetConfigCache();
    const result2 = bootstrap(tmpDir);
    assert.equal(result2.success, true);
    assert.equal(result2.created.length, 0, "no files should be created on second run");
  });

  it("no mcp-tool-shop strings in pilot-org seed files", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({
        kitVersion: 1,
        org: { name: "test-org-clean" },
        site: { title: "Clean Test" },
        paths: { dataDir: "data", publicDir: "public" },
      })
    );
    process.env.KIT_CONFIG = join(tmpDir, "kit.config.json");
    resetConfigCache();

    bootstrap(tmpDir);

    // Check all JSON seed files for org-specific strings
    const dataDir = join(tmpDir, "data");
    const files = [
      "governance.json", "promo-queue.json", "experiments.json",
      "submissions.json", "overrides.json", "ops-history.json",
      "promo-decisions.json", "experiment-decisions.json",
      "baseline.json", "feedback-summary.json", "queue-health.json",
      "recommendations.json", "recommendation-patch.json", "decision-drift.json",
    ];

    for (const file of files) {
      const content = readFileSync(join(dataDir, file), "utf8");
      assert.ok(
        !content.includes("mcp-tool-shop"),
        `${file} should not contain mcp-tool-shop`
      );
    }
  });
});

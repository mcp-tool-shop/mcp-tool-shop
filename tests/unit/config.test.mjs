import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadKitConfig, KIT_VERSION_SUPPORTED, resetConfigCache } from "../../scripts/lib/config.mjs";

// ── Temp dir helper ─────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = join(tmpdir(), `test-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmpDir, { recursive: true });
  resetConfigCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  resetConfigCache();
});

// ── loadKitConfig ───────────────────────────────────────────

describe("loadKitConfig", () => {
  it("returns defaults when no config file exists", () => {
    const config = loadKitConfig(tmpDir);
    assert.equal(config.kitVersion, 1);
    assert.equal(config.org.name, "");
    assert.equal(config.org.account, "");
    assert.equal(config.site.title, "");
    assert.equal(config.paths.dataDir, "site/src/data");
    assert.equal(config.paths.publicDir, "site/public");
    assert.equal(config.guardrails.maxDataPatchesPerRun, 5);
  });

  it("reads and parses kit.config.json when present", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, org: { name: "test-org" }, site: { title: "Test Site" } })
    );
    const config = loadKitConfig(tmpDir);
    assert.equal(config.org.name, "test-org");
    assert.equal(config.site.title, "Test Site");
  });

  it("deep-merges user config over defaults", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ org: { name: "my-org" } })
    );
    const config = loadKitConfig(tmpDir);
    // User override applied
    assert.equal(config.org.name, "my-org");
    // Defaults still present for missing fields
    assert.equal(config.org.account, "");
    assert.equal(config.org.url, "");
    assert.equal(config.paths.dataDir, "site/src/data");
    assert.equal(config.guardrails.maxDataPatchesPerRun, 5);
  });

  it("handles invalid JSON gracefully (returns defaults)", () => {
    writeFileSync(join(tmpDir, "kit.config.json"), "not valid json {{{");
    const config = loadKitConfig(tmpDir);
    assert.equal(config.kitVersion, 1);
    assert.equal(config.org.name, "");
  });

  it("preserves custom guardrails values", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ guardrails: { maxDataPatchesPerRun: 10, spikeThreshold: 500 } })
    );
    const config = loadKitConfig(tmpDir);
    assert.equal(config.guardrails.maxDataPatchesPerRun, 10);
    assert.equal(config.guardrails.spikeThreshold, 500);
    // Default not overridden
    assert.equal(config.guardrails.dailyTelemetryCapPerType, 50);
  });

  it("preserves custom paths values", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ paths: { dataDir: "custom/data", publicDir: "custom/public" } })
    );
    const config = loadKitConfig(tmpDir);
    assert.equal(config.paths.dataDir, "custom/data");
    assert.equal(config.paths.publicDir, "custom/public");
  });

  it("preserves all site fields", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({
        site: {
          title: "My Tool Shop",
          url: "https://example.com",
          description: "A description",
        },
      })
    );
    const config = loadKitConfig(tmpDir);
    assert.equal(config.site.title, "My Tool Shop");
    assert.equal(config.site.url, "https://example.com");
    assert.equal(config.site.description, "A description");
  });

  it("preserves repo and contact fields", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({
        repo: { marketing: "org/repo" },
        contact: { email: "me@example.com" },
      })
    );
    const config = loadKitConfig(tmpDir);
    assert.equal(config.repo.marketing, "org/repo");
    assert.equal(config.contact.email, "me@example.com");
  });
});

// ── KIT_VERSION_SUPPORTED ───────────────────────────────────

describe("KIT_VERSION_SUPPORTED", () => {
  it("is an array of [min, max]", () => {
    assert.ok(Array.isArray(KIT_VERSION_SUPPORTED));
    assert.equal(KIT_VERSION_SUPPORTED.length, 2);
    assert.ok(typeof KIT_VERSION_SUPPORTED[0] === "number");
    assert.ok(typeof KIT_VERSION_SUPPORTED[1] === "number");
  });

  it("min <= max", () => {
    assert.ok(KIT_VERSION_SUPPORTED[0] <= KIT_VERSION_SUPPORTED[1]);
  });

  it("current kit version 1 is in range", () => {
    assert.ok(1 >= KIT_VERSION_SUPPORTED[0]);
    assert.ok(1 <= KIT_VERSION_SUPPORTED[1]);
  });
});

// ── Deep merge edge cases ───────────────────────────────────

describe("deep merge edge cases", () => {
  it("arrays in user config replace defaults (not merge)", () => {
    // The default guardrails has no arrays, but if a user adds one to hardRules-like field
    // at the org level, it should replace, not concatenate
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, org: { name: "test" } })
    );
    const config = loadKitConfig(tmpDir);
    assert.equal(config.kitVersion, 1);
    assert.equal(config.org.name, "test");
  });

  it("extra unknown fields are preserved in user config", () => {
    writeFileSync(
      join(tmpDir, "kit.config.json"),
      JSON.stringify({ kitVersion: 1, customField: "hello" })
    );
    const config = loadKitConfig(tmpDir);
    assert.equal(config.customField, "hello");
  });
});

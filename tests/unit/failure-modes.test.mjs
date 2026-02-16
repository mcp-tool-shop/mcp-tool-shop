import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { loadKitConfig, resetConfigCache } from "../../scripts/lib/config.mjs";

// ── Temp dir helper ─────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = join(tmpdir(), `test-fm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmpDir, { recursive: true });
  resetConfigCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  resetConfigCache();
});

// Helper: run selftest against a temp dir and capture output
function runSelftest(dir) {
  const script = join(import.meta.dirname, "..", "..", "scripts", "kit-selftest.mjs");
  try {
    const output = execSync(`node "${script}"`, {
      cwd: dir,
      env: { ...process.env, KIT_CONFIG: join(dir, "kit.config.json") },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    });
    return { code: 0, stdout: output, stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || "", stderr: err.stderr || "" };
  }
}

// ── Failure mode 1: Typo detection ──────────────────────────

describe("failure mode: config typo detection", () => {
  it("detects paths.data as typo for paths.dataDir", () => {
    const config = { kitVersion: 1, paths: { data: "data" } };
    const merged = loadKitConfig(tmpDir);
    // After loadKitConfig with no file, paths.data won't exist
    // Write config with typo, then check via selftest
    writeFileSync(join(tmpDir, "kit.config.json"), JSON.stringify({
      kitVersion: 1,
      org: { name: "test", account: "test" },
      site: { title: "Test" },
      contact: { email: "test@test.com" },
      paths: { data: "data" },
    }));
    mkdirSync(join(tmpDir, "site", "src", "data"), { recursive: true });

    const result = runSelftest(tmpDir);
    assert.ok(
      result.stdout.includes("did you mean") || result.stdout.includes("paths.data"),
      `Expected typo warning in output, got: ${result.stdout.slice(0, 500)}`
    );
  });

  it("detects org.handle as typo for org.account", () => {
    writeFileSync(join(tmpDir, "kit.config.json"), JSON.stringify({
      kitVersion: 1,
      org: { name: "test", handle: "myhandle" },
      site: { title: "Test" },
      contact: { email: "test@test.com" },
    }));
    mkdirSync(join(tmpDir, "site", "src", "data"), { recursive: true });

    const result = runSelftest(tmpDir);
    assert.ok(
      result.stdout.includes("did you mean") || result.stdout.includes("org.handle"),
      `Expected typo warning for org.handle, got: ${result.stdout.slice(0, 500)}`
    );
  });
});

// ── Failure mode 2: Missing required fields ─────────────────

describe("failure mode: missing required fields", () => {
  it("reports missing org.name and site.title", () => {
    writeFileSync(join(tmpDir, "kit.config.json"), JSON.stringify({
      kitVersion: 1,
    }));

    const result = runSelftest(tmpDir);
    assert.notEqual(result.code, 0, "Should fail when required fields missing");
    assert.ok(
      result.stdout.includes("Missing required fields") || result.stdout.includes("org name or account"),
      `Expected missing fields error, got: ${result.stdout.slice(0, 500)}`
    );
  });

  it("reports missing contact.email", () => {
    writeFileSync(join(tmpDir, "kit.config.json"), JSON.stringify({
      kitVersion: 1,
      org: { name: "test", account: "test" },
      site: { title: "Test" },
      // contact.email missing
    }));

    const result = runSelftest(tmpDir);
    assert.notEqual(result.code, 0, "Should fail when contact.email missing");
    assert.ok(
      result.stdout.includes("contact.email"),
      `Expected contact.email in missing fields, got: ${result.stdout.slice(0, 500)}`
    );
  });
});

// ── Failure mode 3: Bad paths ───────────────────────────────

describe("failure mode: bad paths", () => {
  it("reports missing data directory", () => {
    writeFileSync(join(tmpDir, "kit.config.json"), JSON.stringify({
      kitVersion: 1,
      org: { name: "test", account: "test" },
      site: { title: "Test" },
      contact: { email: "test@test.com" },
      paths: { dataDir: "nonexistent/data", publicDir: "site/public" },
    }));

    const result = runSelftest(tmpDir);
    assert.ok(
      result.stdout.includes("Data directory not found") || result.stdout.includes("nonexistent"),
      `Expected data dir error, got: ${result.stdout.slice(0, 500)}`
    );
  });
});

// ── Failure mode 4: Git repo / commit SHA ───────────────────

describe("failure mode: git repo detection", () => {
  it("warns when not a git repo (selftest still passes)", () => {
    writeFileSync(join(tmpDir, "kit.config.json"), JSON.stringify({
      kitVersion: 1,
      org: { name: "test", account: "test" },
      site: { title: "Test" },
      contact: { email: "test@test.com" },
    }));
    // Create data dir so seed checks have something
    const dataDir = join(tmpDir, "site", "src", "data");
    mkdirSync(dataDir, { recursive: true });
    // Create minimal seed files
    const seeds = [
      "governance.json", "promo-queue.json", "experiments.json",
      "submissions.json", "overrides.json", "ops-history.json",
      "worthy.json", "promo-decisions.json", "experiment-decisions.json",
      "baseline.json", "feedback-summary.json", "queue-health.json",
      "recommendations.json", "recommendation-patch.json", "decision-drift.json",
    ];
    for (const f of seeds) {
      writeFileSync(join(dataDir, f), "{}");
    }

    const result = runSelftest(tmpDir);
    assert.ok(
      result.stdout.includes("git repo detected") || result.stdout.includes("Not a git repo"),
      `Expected git warning in output, got: ${result.stdout.slice(0, 500)}`
    );
  });
});

// ── Failure mode 5: Node version (structural test) ──────────

describe("failure mode: node version gate", () => {
  it("CLI bin contains node version check", () => {
    // Structural test: verify the version gate exists in the bin file
    const bin = readFileSync(
      join(import.meta.dirname, "..", "..", "packages", "promo-kit", "bin", "promo-kit.mjs"),
      "utf8"
    );
    assert.ok(bin.includes("major < 22"), "Bin should check for Node >= 22");
    assert.ok(bin.includes("process.exit(1)"), "Should exit 1 on version mismatch");
    assert.ok(
      bin.includes("nvm") || bin.includes("volta"),
      "Should suggest nvm or volta as fix"
    );
  });
});

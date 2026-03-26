import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

describe("repo hygiene", () => {
  const requiredFiles = [
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "SCORECARD.md",
    "SHIP_GATE.md",
  ];

  for (const file of requiredFiles) {
    it(`${file} exists`, () => {
      assert.ok(existsSync(join(ROOT, file)), `Missing ${file}`);
    });
  }

  it("LICENSE is MIT", () => {
    const license = readFileSync(join(ROOT, "LICENSE"), "utf-8");
    assert.ok(license.includes("MIT"), "LICENSE should be MIT");
  });

  it("CHANGELOG mentions 1.0.0", () => {
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf-8");
    assert.ok(changelog.includes("[1.0.0]"), "CHANGELOG should contain [1.0.0]");
  });

  it("site directory exists", () => {
    assert.ok(existsSync(join(ROOT, "site")), "site/ directory required");
  });

  it("data directory exists with required files", () => {
    assert.ok(existsSync(join(ROOT, "data")), "data/ directory required");
  });
});

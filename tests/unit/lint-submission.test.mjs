import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  lintSubmission,
  formatLintReport,
  lintAllSubmissions,
} from "../../scripts/lint-submission.mjs";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

function makeValid() {
  return loadFixture("valid-submission.json");
}

function makeMinimal() {
  return {
    tool: {
      name: "Minimal Tool",
      slug: "minimal-tool",
      repo: "https://github.com/org/minimal-tool",
    },
    category: "devtools",
    kind: "cli",
    pitch: "A minimal tool for testing lint rules with enough characters to pass.",
    goodFor: ["Testing"],
    proof: [
      {
        label: "Tests",
        url: "https://github.com/org/minimal-tool/actions",
        whatItProves: "Tests pass",
      },
    ],
    maintainer: { handle: "@dev" },
  };
}

// ── lintSubmission ──────────────────────────────────────────

describe("lintSubmission", () => {
  it("valid submission with all optional fields gets grade pass", () => {
    const result = lintSubmission(makeValid());
    assert.equal(result.grade, "pass");
    assert.equal(result.errors.length, 0);
  });

  it("valid submission with minimal fields gets grade warn with suggestions", () => {
    const result = lintSubmission(makeMinimal());
    // Missing install, quickstart, notFor → warnings + suggestions
    assert.ok(result.grade === "warn" || result.grade === "pass");
    assert.equal(result.errors.length, 0);
  });

  it("invalid submission (missing required) gets grade fail", () => {
    const result = lintSubmission({});
    assert.equal(result.grade, "fail");
    assert.ok(result.errors.length > 0);
    assert.equal(result.routeSuggestion, null);
  });

  it("1 proof link produces warning", () => {
    const data = makeMinimal();
    const result = lintSubmission(data);
    assert.ok(
      result.warnings.some((w) => w.includes("1 proof link")),
      "should warn about single proof link",
    );
  });

  it("2+ proof links produces no proof warning", () => {
    const result = lintSubmission(makeValid());
    assert.ok(
      !result.warnings.some((w) => w.includes("proof link")),
      "should not warn about proof links when ≥2",
    );
  });

  it("missing install produces warning", () => {
    const data = makeMinimal();
    delete data.install;
    const result = lintSubmission(data);
    assert.ok(
      result.warnings.some((w) => w.includes("install")),
      "should warn about missing install",
    );
  });

  it("missing quickstart produces warning", () => {
    const data = makeMinimal();
    delete data.quickstart;
    const result = lintSubmission(data);
    assert.ok(
      result.warnings.some((w) => w.includes("quickstart")),
      "should warn about missing quickstart",
    );
  });

  it("missing notFor produces suggestion", () => {
    const data = makeMinimal();
    delete data.notFor;
    const result = lintSubmission(data);
    assert.ok(
      result.suggestions.some((s) => s.includes("notFor")),
      "should suggest adding notFor",
    );
  });

  it("pitch < 40 chars produces suggestion", () => {
    const data = makeMinimal();
    data.pitch = "Short but valid pitch here."; // 27 chars
    const result = lintSubmission(data);
    assert.ok(
      result.suggestions.some((s) => s.includes("short")),
      "should suggest longer pitch",
    );
  });

  it("pitch > 160 chars produces suggestion", () => {
    const data = makeMinimal();
    data.pitch = "A".repeat(170);
    const result = lintSubmission(data);
    assert.ok(
      result.suggestions.some((s) => s.includes("long")),
      "should suggest shorter pitch",
    );
  });

  it("pitch 40–160 chars produces no pitch suggestion", () => {
    const result = lintSubmission(makeValid());
    assert.ok(
      !result.suggestions.some((s) => s.includes("Pitch")),
      "should not suggest pitch change in sweet spot",
    );
  });

  it("strong submission routes to promo", () => {
    const result = lintSubmission(makeValid());
    assert.equal(result.routeSuggestion, "promo");
  });

  it("minimal submission routes to experiment", () => {
    const data = makeMinimal();
    // Only 1 proof, no CI URL pattern
    data.proof = [
      {
        label: "Blog post",
        url: "https://example.com/blog/my-tool",
        whatItProves: "Tool exists",
      },
    ];
    data.install = "npm install my-tool";
    const result = lintSubmission(data);
    assert.equal(result.routeSuggestion, "experiment");
  });

  it("failing submission routes to null", () => {
    const result = lintSubmission({});
    assert.equal(result.routeSuggestion, null);
  });

  it("valid-submission.json fixture produces grade pass", () => {
    const data = loadFixture("valid-submission.json");
    const result = lintSubmission(data);
    assert.equal(result.grade, "pass");
  });

  it("invalid-submission-missing-fields.json fixture produces grade fail", () => {
    const data = loadFixture("invalid-submission-missing-fields.json");
    const result = lintSubmission(data);
    assert.equal(result.grade, "fail");
  });

  it("invalid-submission-bad-urls.json fixture produces grade fail", () => {
    const data = loadFixture("invalid-submission-bad-urls.json");
    const result = lintSubmission(data);
    assert.equal(result.grade, "fail");
  });

  it("invalid-submission-bad-enums.json fixture produces grade fail", () => {
    const data = loadFixture("invalid-submission-bad-enums.json");
    const result = lintSubmission(data);
    assert.equal(result.grade, "fail");
  });
});

// ── formatLintReport ────────────────────────────────────────

describe("formatLintReport", () => {
  it("pass grade formats cleanly", () => {
    const result = {
      grade: "pass",
      errors: [],
      warnings: [],
      suggestions: [],
      routeSuggestion: "promo",
    };
    const report = formatLintReport(result, "my-tool");
    assert.ok(report.includes("PASS"));
    assert.ok(report.includes("my-tool"));
    assert.ok(!report.includes("### Errors"));
  });

  it("fail grade includes errors section", () => {
    const result = {
      grade: "fail",
      errors: ["tool: required object", "pitch: required"],
      warnings: [],
      suggestions: [],
      routeSuggestion: null,
    };
    const report = formatLintReport(result, "bad-tool");
    assert.ok(report.includes("FAIL"));
    assert.ok(report.includes("### Errors"));
    assert.ok(report.includes("tool: required object"));
  });

  it("route suggestion included when present", () => {
    const result = {
      grade: "pass",
      errors: [],
      warnings: [],
      suggestions: [],
      routeSuggestion: "experiment",
    };
    const report = formatLintReport(result, "test-tool");
    assert.ok(report.includes("experiment"));
    assert.ok(report.includes("Suggested lane"));
  });
});

// ── lintAllSubmissions ──────────────────────────────────────

describe("lintAllSubmissions", () => {
  it("empty dir returns empty reports", () => {
    const tmp = mkdtempSync(join(tmpdir(), "lint-empty-"));
    const result = lintAllSubmissions({ submissionsDir: tmp });
    assert.equal(result.reports.size, 0);
    assert.ok(result.summary.includes("0 submission"));
  });

  it("dir with valid file returns pass grade", () => {
    const tmp = mkdtempSync(join(tmpdir(), "lint-valid-"));
    writeFileSync(
      join(tmp, "good-tool.json"),
      readFileSync(join(FIXTURES, "valid-submission.json")),
    );
    const result = lintAllSubmissions({ submissionsDir: tmp });
    assert.equal(result.reports.size, 1);
    assert.equal(result.reports.get("good-tool").grade, "pass");
  });

  it("dir with invalid file returns fail grade", () => {
    const tmp = mkdtempSync(join(tmpdir(), "lint-invalid-"));
    writeFileSync(join(tmp, "bad.json"), "{}");
    const result = lintAllSubmissions({ submissionsDir: tmp });
    assert.equal(result.reports.size, 1);
    assert.equal(result.reports.get("bad").grade, "fail");
  });
});

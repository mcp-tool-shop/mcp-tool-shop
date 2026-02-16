import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  validateSubmission,
  validateSubmissionsJson,
  validateAllSubmissions,
  VALID_KINDS,
  VALID_CATEGORIES,
  VALID_STATUSES,
  VALID_LANES,
} from "../../scripts/validate-submissions.mjs";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

function makeValid() {
  return loadFixture("valid-submission.json");
}

// ── validateSubmission ──────────────────────────────────────

describe("validateSubmission", () => {
  it("valid submission passes", () => {
    const result = validateSubmission(makeValid());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("null input fails", () => {
    const result = validateSubmission(null);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("missing tool.name fails", () => {
    const data = makeValid();
    delete data.tool.name;
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("tool.name")));
  });

  it("missing tool.slug fails", () => {
    const data = makeValid();
    delete data.tool.slug;
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("tool.slug")));
  });

  it("invalid slug format (uppercase) fails", () => {
    const data = makeValid();
    data.tool.slug = "BadSlug";
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("tool.slug")));
  });

  it("invalid slug format (spaces) fails", () => {
    const data = makeValid();
    data.tool.slug = "bad slug";
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("tool.slug")));
  });

  it("missing tool.repo fails", () => {
    const data = makeValid();
    delete data.tool.repo;
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("tool.repo")));
  });

  it("non-https repo URL fails", () => {
    const data = makeValid();
    data.tool.repo = "ftp://files.example.com/tool";
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("tool.repo")));
  });

  it("invalid category enum fails", () => {
    const data = makeValid();
    data.category = "social";
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("category")));
  });

  it("invalid kind enum fails", () => {
    const data = makeValid();
    data.kind = "webapp";
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("kind")));
  });

  it("missing pitch fails", () => {
    const data = makeValid();
    delete data.pitch;
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("pitch")));
  });

  it("pitch too short fails", () => {
    const data = makeValid();
    data.pitch = "Too short";
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("pitch") && e.includes("too short")));
  });

  it("pitch too long fails", () => {
    const data = makeValid();
    data.pitch = "x".repeat(201);
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("pitch") && e.includes("too long")));
  });

  it("missing goodFor fails", () => {
    const data = makeValid();
    delete data.goodFor;
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("goodFor")));
  });

  it("empty goodFor fails", () => {
    const data = makeValid();
    data.goodFor = [];
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("goodFor")));
  });

  it("too many goodFor items fails", () => {
    const data = makeValid();
    data.goodFor = ["a", "b", "c", "d", "e", "f"];
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("goodFor") && e.includes("too many")));
  });

  it("too many notFor items fails", () => {
    const data = makeValid();
    data.notFor = ["a", "b", "c", "d"];
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("notFor") && e.includes("too many")));
  });

  it("missing proof fails", () => {
    const data = makeValid();
    delete data.proof;
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("proof")));
  });

  it("empty proof array fails", () => {
    const data = makeValid();
    data.proof = [];
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("proof")));
  });

  it("proof entry missing URL fails", () => {
    const data = makeValid();
    data.proof = [{ label: "Test", whatItProves: "Something" }];
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("proof[0].url")));
  });

  it("proof entry with non-https URL fails", () => {
    const data = makeValid();
    data.proof = [{ label: "Test", url: "javascript:alert(1)", whatItProves: "Nothing" }];
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("proof[0].url")));
  });

  it("missing maintainer.handle fails", () => {
    const data = makeValid();
    data.maintainer = {};
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("maintainer.handle")));
  });

  it("optional fields absent still passes", () => {
    const data = makeValid();
    delete data.install;
    delete data.quickstart;
    delete data.notFor;
    delete data.maintainer.contact;
    const result = validateSubmission(data);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("fixture: missing-fields fails with multiple errors", () => {
    const data = loadFixture("invalid-submission-missing-fields.json");
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 3);
  });

  it("fixture: bad-urls fails", () => {
    const data = loadFixture("invalid-submission-bad-urls.json");
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("tool.repo")));
  });

  it("fixture: bad-enums fails", () => {
    const data = loadFixture("invalid-submission-bad-enums.json");
    const result = validateSubmission(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("category")));
    assert.ok(result.errors.some((e) => e.includes("kind")));
  });
});

// ── validateSubmissionsJson ─────────────────────────────────

describe("validateSubmissionsJson", () => {
  it("valid empty submissions passes", () => {
    const result = validateSubmissionsJson({ submissions: [] });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("valid non-empty submissions passes", () => {
    const result = validateSubmissionsJson({
      submissions: [
        {
          slug: "test-tool",
          status: "pending",
          lane: "promo",
          submittedAt: "2026-02-16T00:00:00Z",
        },
      ],
    });
    assert.equal(result.valid, true);
  });

  it("missing submissions array fails", () => {
    const result = validateSubmissionsJson({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("must be an array")));
  });

  it("invalid status enum fails", () => {
    const result = validateSubmissionsJson({
      submissions: [
        { slug: "x", status: "maybe", lane: "promo", submittedAt: "2026-02-16T00:00:00Z" },
      ],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("status")));
  });

  it("invalid lane enum fails", () => {
    const result = validateSubmissionsJson({
      submissions: [
        { slug: "x", status: "pending", lane: "turbo", submittedAt: "2026-02-16T00:00:00Z" },
      ],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("lane")));
  });

  it("duplicate slugs fails", () => {
    const result = validateSubmissionsJson({
      submissions: [
        { slug: "x", status: "pending", lane: "promo", submittedAt: "2026-02-16T00:00:00Z" },
        { slug: "x", status: "accepted", lane: "promo", submittedAt: "2026-02-16T00:00:00Z" },
      ],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("duplicate")));
  });

  it("missing required summary fields fails", () => {
    const result = validateSubmissionsJson({
      submissions: [{}],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 3);
  });
});

// ── validateAllSubmissions ──────────────────────────────────

describe("validateAllSubmissions", () => {
  it("empty directory returns zero counts", () => {
    const result = validateAllSubmissions({
      submissionsDir: join(FIXTURES, "nonexistent-dir"),
      summaryPath: join(FIXTURES, "nonexistent.json"),
    });
    assert.equal(result.valid, 0);
    assert.equal(result.invalid, 0);
    assert.equal(result.errors.length, 0);
  });

  it("fixtures directory validates files and reports errors", () => {
    // Point at the fixtures dir which has valid + invalid submission files
    // (plus other non-submission JSON files that will also fail)
    const result = validateAllSubmissions({
      submissionsDir: FIXTURES,
      summaryPath: join(FIXTURES, "nonexistent.json"),
    });
    assert.ok(result.valid >= 1, "at least 1 valid submission fixture");
    assert.ok(result.invalid >= 3, "at least 3 invalid fixtures");
    assert.ok(result.errors.length > 0, "should have errors");
  });

  it("dry-run does not throw", () => {
    const result = validateAllSubmissions({
      submissionsDir: FIXTURES,
      summaryPath: join(FIXTURES, "nonexistent.json"),
      dryRun: true,
    });
    assert.equal(typeof result.valid, "number");
    assert.equal(typeof result.invalid, "number");
  });
});

// ── Enum exports ────────────────────────────────────────────

describe("enum exports", () => {
  it("VALID_KINDS contains expected values", () => {
    assert.ok(VALID_KINDS.includes("mcp-server"));
    assert.ok(VALID_KINDS.includes("cli"));
    assert.ok(VALID_KINDS.length >= 9);
  });

  it("VALID_CATEGORIES contains expected values", () => {
    assert.ok(VALID_CATEGORIES.includes("mcp-core"));
    assert.ok(VALID_CATEGORIES.includes("ml"));
    assert.ok(VALID_CATEGORIES.length >= 9);
  });

  it("VALID_STATUSES contains expected values", () => {
    assert.deepEqual(VALID_STATUSES, ["pending", "accepted", "rejected", "withdrawn", "needs-info"]);
  });

  it("VALID_LANES contains expected values", () => {
    assert.deepEqual(VALID_LANES, ["promo", "experiment"]);
  });
});

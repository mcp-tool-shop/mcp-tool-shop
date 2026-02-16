import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateStatusPatch,
  applyStatusPatch,
  applySubmissionStatus,
  VALID_STATUSES,
} from "../../scripts/apply-submission-status.mjs";

function makeTmpSubmissions(submissions = []) {
  const tmp = mkdtempSync(join(tmpdir(), "sub-status-"));
  writeFileSync(
    join(tmp, "submissions.json"),
    JSON.stringify({ submissions }, null, 2),
    "utf8",
  );
  return tmp;
}

function makeSeedSubmission(overrides = {}) {
  return {
    slug: "test-tool",
    status: "pending",
    lane: "promo",
    submittedAt: "2025-01-15T10:00:00Z",
    tool: { name: "Test Tool", slug: "test-tool", repo: "https://github.com/org/test-tool" },
    ...overrides,
  };
}

// ── validateStatusPatch ─────────────────────────────────────

describe("validateStatusPatch", () => {
  it("valid status change passes", () => {
    const result = validateStatusPatch("test-tool", { status: "needs-info" });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("invalid status enum fails", () => {
    const result = validateStatusPatch("test-tool", { status: "deleted" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("status")));
  });

  it("protected field slug fails", () => {
    const result = validateStatusPatch("test-tool", { slug: "new-slug" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("protected")));
  });

  it("protected field submittedAt fails", () => {
    const result = validateStatusPatch("test-tool", { submittedAt: "2025-06-01T00:00:00Z" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("protected")));
  });

  it("reviewNotes too long (>500) fails", () => {
    const result = validateStatusPatch("test-tool", { reviewNotes: "x".repeat(501) });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reviewNotes")));
  });

  it("invalid ISO date for lastReviewedAt fails", () => {
    const result = validateStatusPatch("test-tool", { lastReviewedAt: "yesterday" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("lastReviewedAt")));
  });

  it("invalid URL for sourcePr fails", () => {
    const result = validateStatusPatch("test-tool", { sourcePr: "ftp://bad.com/pr" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("sourcePr")));
  });

  it("reason too long (>300) fails", () => {
    const result = validateStatusPatch("test-tool", { reason: "r".repeat(301) });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reason")));
  });

  it("empty slug fails", () => {
    const result = validateStatusPatch("", { status: "accepted" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("slug")));
  });

  it("multiple valid fields pass", () => {
    const result = validateStatusPatch("test-tool", {
      status: "needs-info",
      reviewNotes: "Please add a demo link",
      lastReviewedAt: "2025-06-01T12:00:00Z",
      sourcePr: "https://github.com/org/repo/pull/42",
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });
});

// ── applyStatusPatch ────────────────────────────────────────

describe("applyStatusPatch", () => {
  it("applies status to existing slug", () => {
    const tmp = makeTmpSubmissions([makeSeedSubmission()]);
    const result = applyStatusPatch("test-tool", { status: "needs-info" }, { dataDir: tmp });
    assert.equal(result.applied, true);
    assert.equal(result.submission.status, "needs-info");

    // Verify file was written
    const data = JSON.parse(readFileSync(join(tmp, "submissions.json"), "utf8"));
    assert.equal(data.submissions[0].status, "needs-info");
  });

  it("sets updatedAt automatically", () => {
    const tmp = makeTmpSubmissions([makeSeedSubmission()]);
    const before = new Date().toISOString();
    const result = applyStatusPatch("test-tool", { status: "accepted" }, { dataDir: tmp });
    assert.equal(result.applied, true);
    assert.ok(result.submission.updatedAt >= before);
  });

  it("slug not found returns error", () => {
    const tmp = makeTmpSubmissions([makeSeedSubmission()]);
    const result = applyStatusPatch("nonexistent", { status: "accepted" }, { dataDir: tmp });
    assert.equal(result.applied, false);
    assert.ok(result.error.includes("not found"));
  });

  it("risk notes generated for status changes", () => {
    const tmp = makeTmpSubmissions([makeSeedSubmission()]);
    const result = applyStatusPatch("test-tool", { status: "needs-info" }, { dataDir: tmp });
    assert.ok(result.riskNotes.length > 0);
    assert.ok(result.riskNotes.some((n) => n.includes("needs-info")));
  });

  it("reviewNotes risk note generated", () => {
    const tmp = makeTmpSubmissions([makeSeedSubmission()]);
    const result = applyStatusPatch(
      "test-tool",
      { reviewNotes: "Please add a demo" },
      { dataDir: tmp },
    );
    assert.ok(result.riskNotes.some((n) => n.includes("Review notes")));
  });
});

// ── applySubmissionStatus ───────────────────────────────────

describe("applySubmissionStatus", () => {
  it("valid JSON applies successfully", () => {
    const tmp = makeTmpSubmissions([makeSeedSubmission()]);
    process.exitCode = 0;
    const result = applySubmissionStatus(
      JSON.stringify({ slug: "test-tool", status: "accepted" }),
      { dataDir: tmp },
    );
    assert.equal(result.success, true);
    assert.equal(result.applied, true);
    process.exitCode = 0;
  });

  it("invalid JSON returns error", () => {
    process.exitCode = 0;
    const result = applySubmissionStatus("not-json", { dataDir: "/tmp" });
    assert.equal(result.success, false);
    assert.ok(result.error.includes("Invalid JSON"));
    process.exitCode = 0;
  });

  it("validation failure returns errors", () => {
    const tmp = makeTmpSubmissions([makeSeedSubmission()]);
    process.exitCode = 0;
    const result = applySubmissionStatus(
      JSON.stringify({ slug: "test-tool", status: "bogus" }),
      { dataDir: tmp },
    );
    assert.equal(result.success, false);
    assert.ok(result.errors.length > 0);
    process.exitCode = 0;
  });
});

// ── Enum exports ────────────────────────────────────────────

describe("VALID_STATUSES export", () => {
  it("contains needs-info status", () => {
    assert.ok(VALID_STATUSES.includes("needs-info"));
  });

  it("has 5 statuses", () => {
    assert.equal(VALID_STATUSES.length, 5);
  });
});

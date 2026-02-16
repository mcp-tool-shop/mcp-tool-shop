import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeQueueHealth,
  computeTimeInStatus,
} from "../../scripts/gen-queue-health.mjs";

// ── analyzeQueueHealth ───────────────────────────────────────

describe("analyzeQueueHealth", () => {
  it("empty submissions returns zero-state", () => {
    const result = analyzeQueueHealth([]);
    assert.equal(result.submissions, 0);
    assert.deepEqual(result.byStatus, {});
    assert.equal(result.stuckCount, 0);
    assert.deepEqual(result.stuckSlugs, []);
    assert.deepEqual(result.topLintFailures, []);
    assert.equal(result.medianDaysPending, null);
    assert.equal(result.throughput, 0);
  });

  it("null submissions returns zero-state", () => {
    const result = analyzeQueueHealth(null);
    assert.equal(result.submissions, 0);
  });

  it("counts by status correctly", () => {
    const subs = [
      { slug: "a", status: "pending", submittedAt: "2026-02-01T00:00:00Z" },
      { slug: "b", status: "pending", submittedAt: "2026-02-02T00:00:00Z" },
      { slug: "c", status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-05T00:00:00Z" },
      { slug: "d", status: "rejected", submittedAt: "2026-01-10T00:00:00Z", updatedAt: "2026-01-12T00:00:00Z" },
    ];
    const result = analyzeQueueHealth(subs, { now: new Date("2026-02-05T00:00:00Z") });
    assert.equal(result.byStatus.pending, 2);
    assert.equal(result.byStatus.accepted, 1);
    assert.equal(result.byStatus.rejected, 1);
  });

  it("identifies stuck submissions (>7 days in pending/needs-info)", () => {
    const subs = [
      { slug: "old-one", status: "pending", submittedAt: "2026-01-01T00:00:00Z" },
      { slug: "recent", status: "pending", submittedAt: "2026-02-10T00:00:00Z" },
      { slug: "stuck-info", status: "needs-info", submittedAt: "2026-01-15T00:00:00Z" },
      { slug: "accepted-one", status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-03T00:00:00Z" },
    ];
    const result = analyzeQueueHealth(subs, { now: new Date("2026-02-15T00:00:00Z") });
    assert.equal(result.stuckCount, 2);
    const stuckNames = result.stuckSlugs.map((s) => s.slug);
    assert.ok(stuckNames.includes("old-one"));
    assert.ok(stuckNames.includes("stuck-info"));
    assert.ok(!stuckNames.includes("recent"));
    assert.ok(!stuckNames.includes("accepted-one"));
  });

  it("computes median days pending for completed submissions", () => {
    const subs = [
      { slug: "a", status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-04T00:00:00Z" }, // 3 days
      { slug: "b", status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-06T00:00:00Z" }, // 5 days
      { slug: "c", status: "rejected", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-08T00:00:00Z" }, // 7 days
      { slug: "d", status: "pending", submittedAt: "2026-01-01T00:00:00Z" }, // excluded
    ];
    const result = analyzeQueueHealth(subs, { now: new Date("2026-02-01T00:00:00Z") });
    // median of [3, 5, 7] = 5
    assert.equal(result.medianDaysPending, 5);
  });

  it("computes throughput (accepted in trailing 30 days)", () => {
    const now = new Date("2026-02-15T00:00:00Z");
    const subs = [
      { slug: "a", status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-10T00:00:00Z" }, // within 30d
      { slug: "b", status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" }, // within 30d
      { slug: "c", status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }, // outside 30d
      { slug: "d", status: "rejected", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-10T00:00:00Z" }, // not accepted
    ];
    const result = analyzeQueueHealth(subs, { now });
    assert.equal(result.throughput, 2);
  });

  it("zero throughput when no accepted in window", () => {
    const subs = [
      { slug: "a", status: "pending", submittedAt: "2026-02-01T00:00:00Z" },
    ];
    const result = analyzeQueueHealth(subs, { now: new Date("2026-02-15T00:00:00Z") });
    assert.equal(result.throughput, 0);
  });

  it("aggregates lint failures from reports", () => {
    const subs = [
      { slug: "a", status: "pending", submittedAt: "2026-02-01T00:00:00Z" },
    ];
    const lintReports = {
      "tool-a": { errors: ["missing name", "missing slug"], warnings: ["no proof"] },
      "tool-b": { errors: ["missing name"], warnings: [] },
    };
    const result = analyzeQueueHealth(subs, { lintReports });
    assert.ok(result.topLintFailures.length > 0);
    const nameFailure = result.topLintFailures.find((f) => f.reason === "missing name");
    assert.equal(nameFailure.count, 2);
  });

  it("has generatedAt ISO string", () => {
    const result = analyzeQueueHealth([]);
    assert.ok(result.generatedAt);
    assert.ok(!isNaN(new Date(result.generatedAt).getTime()));
  });
});

// ── computeTimeInStatus ──────────────────────────────────────

describe("computeTimeInStatus", () => {
  it("no submissions returns empty map", () => {
    const result = computeTimeInStatus([]);
    assert.deepEqual(result, {});
  });

  it("single submission calculates correctly", () => {
    const subs = [
      { status: "pending", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-04T00:00:00Z" },
    ];
    const result = computeTimeInStatus(subs);
    assert.equal(result.pending, 3);
  });

  it("multiple submissions calculates median", () => {
    const subs = [
      { status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-03T00:00:00Z" }, // 2 days
      { status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-11T00:00:00Z" }, // 10 days
      { status: "accepted", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-05T00:00:00Z" }, // 4 days
    ];
    const result = computeTimeInStatus(subs);
    // median of [2, 4, 10] = 4
    assert.equal(result.accepted, 4);
  });

  it("handles missing submittedAt gracefully", () => {
    const subs = [
      { status: "pending", updatedAt: "2026-01-04T00:00:00Z" },
    ];
    const result = computeTimeInStatus(subs);
    // Should skip entries without submittedAt
    assert.deepEqual(result, {});
  });
});

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { buildOutreachRun } from "../../scripts/gen-outreach-run.mjs";

describe("buildOutreachRun", () => {
  it("returns null when promo disabled", () => {
    const queue = { week: "2026-02-17", slugs: ["test-tool"], promotionType: "own" };
    const promo = { enabled: false };
    const result = buildOutreachRun(queue, promo);
    assert.equal(result, null);
  });

  it("returns null when queue is empty", () => {
    const queue = { week: "2026-02-17", slugs: [], promotionType: "own" };
    const promo = { enabled: true };
    const result = buildOutreachRun(queue, promo);
    // Should return object with 0 items (not null, since promo is enabled)
    assert.equal(result.itemCount, 0);
  });

  it("caps items at maxItems (default 3)", () => {
    const queue = {
      week: "2026-02-17",
      slugs: ["t1", "t2", "t3", "t4", "t5"],
      promotionType: "own"
    };
    const promo = { enabled: true };
    // All slugs have publicProof
    const overrides = {
      t1: { publicProof: true },
      t2: { publicProof: true },
      t3: { publicProof: true },
      t4: { publicProof: true },
      t5: { publicProof: true },
    };
    const result = buildOutreachRun(queue, promo, { overrides, maxItems: 3 });
    assert.equal(result.itemCount, 3);
    assert.ok(result.warnings.some(w => w.includes("truncated") || w.includes("capped") || w.includes("exceeded")));
  });

  it("skips slugs without publicProof", () => {
    const queue = {
      week: "2026-02-17",
      slugs: ["has-proof", "no-proof"],
      promotionType: "own"
    };
    const promo = { enabled: true };
    const overrides = {
      "has-proof": { publicProof: true },
      "no-proof": { kind: "library" },  // no publicProof
    };
    const result = buildOutreachRun(queue, promo, { overrides });
    assert.equal(result.itemCount, 1);
    assert.equal(result.items[0].slug, "has-proof");
    assert.ok(result.warnings.some(w => w.includes("no-proof")));
  });

  it("ecosystem gate skips non-worthy slugs", () => {
    const queue = {
      week: "2026-02-17",
      slugs: ["worthy-tool", "unworthy-tool"],
      promotionType: "ecosystem"
    };
    const promo = { enabled: true };
    const overrides = {
      "worthy-tool": { publicProof: true },
      "unworthy-tool": { publicProof: true },
    };
    const worthy = {
      repos: {
        "worthy-tool": { worthy: true, score: 5 },
        "unworthy-tool": { worthy: false, score: 1 },
      }
    };
    const result = buildOutreachRun(queue, promo, { overrides, worthy });
    assert.equal(result.itemCount, 1);
    assert.equal(result.items[0].slug, "worthy-tool");
  });

  it("generates correct link URLs", () => {
    const queue = {
      week: "2026-02-17",
      slugs: ["test-tool"],
      promotionType: "own"
    };
    const promo = { enabled: true };
    const overrides = { "test-tool": { publicProof: true } };
    const siteBase = "https://example.com";
    const result = buildOutreachRun(queue, promo, { overrides, siteBase });
    assert.equal(result.items[0].links.presskit, "https://example.com/presskit/test-tool/");
    assert.equal(result.items[0].links.snippets, "https://example.com/snippets/test-tool.md");
    assert.equal(result.items[0].links.proofPage, "https://example.com/proof/test-tool/");
    assert.equal(result.items[0].links.partnerPack, "https://example.com/partners/test-tool/partner-pack.zip");
    assert.equal(result.items[0].links.outreachPack, "https://example.com/outreach/test-tool/");
  });

  it("includes channel text from MarketIR messages", () => {
    // Create a temp dir with MarketIR tool data
    const tmpDir = join(tmpdir(), "outreach-marketir-" + Date.now() + "-" + Math.random().toString(36).slice(2));
    mkdirSync(join(tmpDir, "data", "tools"), { recursive: true });
    writeFileSync(join(tmpDir, "data", "tools", "test-tool.json"), JSON.stringify({
      name: "Test Tool",
      positioning: { oneLiner: "A test tool" },
      messages: [
        { id: "msg.test-tool.hn", channel: "hn", text: "HN post text here", claimRefs: [] },
        { id: "msg.test-tool.web", channel: "web", text: "Web blurb here", claimRefs: [] },
      ]
    }));

    const queue = { week: "2026-02-17", slugs: ["test-tool"], promotionType: "own" };
    const promo = { enabled: true };
    const overrides = { "test-tool": { publicProof: true } };

    const result = buildOutreachRun(queue, promo, { overrides, marketirDir: tmpDir });
    assert.ok(result.items[0].channels.social.hn.text.includes("HN post text"));
    assert.ok(result.items[0].channels.social.hn.charCount > 0);

    // cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── learningMode tests ──────────────────────────────────────

describe("buildOutreachRun - learningMode", () => {
  const queue = { week: "2026-02-24", slugs: ["tool-a"], promotionType: "own" };
  const promo = { enabled: true };
  const overrides = { "tool-a": { publicProof: true } };

  // Totals per channel = sum of all outcomes (sent+opened+replied+ignored+bounced)
  // dm: total=10, ignored=8, ignoreRate=0.80 (>0.70 threshold)
  // email: total=20, replied=4, ignoreRate=1/20=0.05
  // hn: total=10, replied=2, ignoreRate=0/10=0.00
  const feedbackSummary = {
    perChannel: {
      email: { sent: 10, opened: 5, replied: 4, ignored: 1, bounced: 0 },
      dm: { sent: 1, opened: 0, replied: 1, ignored: 8, bounced: 0 },
      hn: { sent: 5, opened: 3, replied: 2, ignored: 0, bounced: 0 },
    },
  };

  it("learningMode 'off' → no channelSuggestions", () => {
    const result = buildOutreachRun(queue, promo, {
      overrides,
      learningMode: "off",
      feedbackSummary,
    });
    assert.equal(result.channelSuggestions, undefined);
  });

  it("learningMode 'suggest' → adds channelSuggestions to manifest", () => {
    const result = buildOutreachRun(queue, promo, {
      overrides,
      learningMode: "suggest",
      feedbackSummary,
    });
    assert.ok(Array.isArray(result.channelSuggestions), "must have channelSuggestions");
    assert.ok(result.channelSuggestions.length > 0, "must have at least one suggestion");
    // Should be sorted by score descending
    assert.ok(result.channelSuggestions[0].includes("hn") || result.channelSuggestions[0].includes("email"),
      "top channel should be hn or email (highest reply, lowest ignore)");
  });

  it("learningMode 'apply' → excludes channel with >70% ignore rate", () => {
    const result = buildOutreachRun(queue, promo, {
      overrides,
      learningMode: "apply",
      feedbackSummary,
    });
    // dm: total=10, ignored=8, ignoreRate=8/10=0.80 > 70% threshold
    assert.ok(
      result.warnings.some(w => w.includes("dropped") && w.includes("dm")),
      "should warn about dropping dm channel"
    );
  });

  it("learningMode defaults to 'off' when field absent", () => {
    const result = buildOutreachRun(queue, promo, {
      overrides,
      // no learningMode passed
      feedbackSummary,
    });
    assert.equal(result.channelSuggestions, undefined, "default should be off, no suggestions");
  });

  it("learningMode 'suggest' → does NOT produce drop warnings", () => {
    const result = buildOutreachRun(queue, promo, {
      overrides,
      learningMode: "suggest",
      feedbackSummary,
    });
    // In suggest mode, no channels should be dropped
    assert.ok(
      !result.warnings.some(w => w.includes("dropped")),
      "suggest mode should not drop channels"
    );
  });

  it("learningMode with no feedbackSummary → no channelSuggestions", () => {
    const result = buildOutreachRun(queue, promo, {
      overrides,
      learningMode: "suggest",
      // no feedbackSummary
    });
    assert.equal(result.channelSuggestions, undefined, "no feedback = no suggestions");
  });
});

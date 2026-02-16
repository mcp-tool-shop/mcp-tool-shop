/**
 * Unit tests for experiment variant generation in gen-outreach-run.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { buildOutreachRun } from "../../scripts/gen-outreach-run.mjs";

// ── Helpers ─────────────────────────────────────────────────

function makeToolJson(slug, name, oneLiner) {
  return {
    name,
    positioning: { oneLiner },
    messages: [
      { id: `msg.${slug}.hn`, channel: "hn", text: `HN text for ${name}`, claimRefs: [] },
      { id: `msg.${slug}.x`, channel: "x", text: `DM text for ${name}`, claimRefs: [] },
    ],
  };
}

let tmpDir;

function setupMarketir(slugs) {
  tmpDir = join(tmpdir(), "exp-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  mkdirSync(join(tmpDir, "data", "tools"), { recursive: true });
  for (const slug of slugs) {
    writeFileSync(
      join(tmpDir, "data", "tools", `${slug}.json`),
      JSON.stringify(makeToolJson(slug, slug.replace(/-/g, " "), `One-liner for ${slug}`))
    );
  }
  return tmpDir;
}

function cleanupMarketir() {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

function makeQueue(slugs, promotionType = "own") {
  return { week: "2026-02-24", slugs, promotionType, notes: "" };
}

function makePromo() {
  return { enabled: true };
}

function makeOverrides(slugs) {
  const o = {};
  for (const s of slugs) o[s] = { publicProof: true };
  return o;
}

// ── Tests ───────────────────────────────────────────────────

describe("experiment variant generation", () => {
  it("no experiments → standard items, no experimentId field", () => {
    const slugs = ["tool-a", "tool-b"];
    const mDir = setupMarketir(slugs);

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments: [] }
    );

    assert.equal(result.itemCount, 2);
    for (const item of result.items) {
      assert.equal(item.experimentId, undefined, `${item.slug} should have no experimentId`);
      assert.equal(item.variantKey, undefined, `${item.slug} should have no variantKey`);
    }
    assert.equal(result.activeExperiments, undefined);

    cleanupMarketir();
  });

  it("active experiment → emits control + variant items", () => {
    const slugs = ["tool-a"];
    const mDir = setupMarketir(slugs);
    const experiments = [
      {
        id: "exp-001",
        name: "Test tagline",
        status: "active",
        slugs: ["tool-a"],
        dimension: "tagline",
        control: { key: "control", value: "Original subject" },
        variant: { key: "variant-a", value: "New catchy subject" },
        targetChannels: ["email"],
      },
    ];

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments }
    );

    assert.equal(result.itemCount, 2, "should emit control + variant");
    assert.equal(result.items[0].experimentId, "exp-001");
    assert.equal(result.items[0].variantKey, "control");
    assert.equal(result.items[1].experimentId, "exp-001");
    assert.equal(result.items[1].variantKey, "variant-a");

    cleanupMarketir();
  });

  it("draft experiment → ignored", () => {
    const slugs = ["tool-a"];
    const mDir = setupMarketir(slugs);
    const experiments = [
      {
        id: "exp-draft",
        status: "draft",
        slugs: ["tool-a"],
        dimension: "tagline",
        control: { key: "control", value: "Original" },
        variant: { key: "variant-a", value: "Draft variant" },
      },
    ];

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments }
    );

    assert.equal(result.itemCount, 1, "draft experiment should not generate variants");
    assert.equal(result.items[0].experimentId, undefined);
    assert.equal(result.activeExperiments, undefined);

    cleanupMarketir();
  });

  it("concluded experiment → ignored", () => {
    const slugs = ["tool-a"];
    const mDir = setupMarketir(slugs);
    const experiments = [
      {
        id: "exp-done",
        status: "concluded",
        slugs: ["tool-a"],
        dimension: "tagline",
        control: { key: "control", value: "Original" },
        variant: { key: "variant-a", value: "Winner" },
        winnerKey: "variant-a",
      },
    ];

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments }
    );

    assert.equal(result.itemCount, 1, "concluded experiment should not generate variants");
    assert.equal(result.items[0].experimentId, undefined);

    cleanupMarketir();
  });

  it("variant item has modified email subject for tagline dimension", () => {
    const slugs = ["tool-a"];
    const mDir = setupMarketir(slugs);
    const experiments = [
      {
        id: "exp-tagline",
        status: "active",
        slugs: ["tool-a"],
        dimension: "tagline",
        control: { key: "control", value: "Original subject" },
        variant: { key: "variant-a", value: "Brand new subject line" },
      },
    ];

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments }
    );

    const control = result.items[0];
    const variant = result.items[1];

    // Control retains original subject
    assert.ok(control.channels.email.journalist.subject.includes("tool-a") || control.channels.email.journalist.subject.includes("One-liner"));
    // Variant has modified subject
    assert.equal(variant.channels.email.journalist.subject, "Brand new subject line");
    assert.equal(variant.channels.email.partner.subject, "Brand new subject line");
    assert.equal(variant.channels.email.integrator.subject, "Brand new subject line");

    cleanupMarketir();
  });

  it("variant item has modified social text for snippet dimension", () => {
    const slugs = ["tool-a"];
    const mDir = setupMarketir(slugs);
    const experiments = [
      {
        id: "exp-snippet",
        status: "active",
        slugs: ["tool-a"],
        dimension: "snippet",
        control: { key: "control", value: "Original snippet" },
        variant: { key: "variant-b", value: "Exciting new snippet text" },
      },
    ];

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments }
    );

    const control = result.items[0];
    const variant = result.items[1];

    // Control retains original social text
    assert.ok(control.channels.social.hn.text.includes("HN text for"));
    // Variant has modified social text
    assert.equal(variant.channels.social.hn.text, "Exciting new snippet text");
    assert.equal(variant.channels.social.hn.charCount, "Exciting new snippet text".length);
    assert.equal(variant.channels.social.dm.text, "Exciting new snippet text");
    assert.equal(variant.channels.social.dm.charCount, "Exciting new snippet text".length);

    cleanupMarketir();
  });

  it("activeExperiments field lists active experiment IDs", () => {
    const slugs = ["tool-a", "tool-b"];
    const mDir = setupMarketir(slugs);
    const experiments = [
      {
        id: "exp-001",
        status: "active",
        slugs: ["tool-a"],
        dimension: "tagline",
        control: { key: "control", value: "Orig" },
        variant: { key: "v-a", value: "Alt" },
      },
      {
        id: "exp-002",
        status: "active",
        slugs: ["tool-b"],
        dimension: "snippet",
        control: { key: "control", value: "Orig" },
        variant: { key: "v-b", value: "Alt snippet" },
      },
      {
        id: "exp-draft",
        status: "draft",
        slugs: ["tool-a"],
        dimension: "cta",
        control: { key: "control", value: "Orig" },
        variant: { key: "v-c", value: "Alt cta" },
      },
    ];

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments }
    );

    assert.ok(Array.isArray(result.activeExperiments));
    assert.equal(result.activeExperiments.length, 2);
    assert.ok(result.activeExperiments.includes("exp-001"));
    assert.ok(result.activeExperiments.includes("exp-002"));
    assert.ok(!result.activeExperiments.includes("exp-draft"));

    cleanupMarketir();
  });

  it("experiment on non-matching slug → no variant", () => {
    const slugs = ["tool-a"];
    const mDir = setupMarketir(slugs);
    const experiments = [
      {
        id: "exp-other",
        status: "active",
        slugs: ["tool-b"],  // does NOT match tool-a
        dimension: "tagline",
        control: { key: "control", value: "Orig" },
        variant: { key: "v-a", value: "Alt" },
      },
    ];

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments }
    );

    assert.equal(result.itemCount, 1, "no variant emitted for non-matching slug");
    assert.equal(result.items[0].experimentId, undefined);
    // activeExperiments still lists it since it's active
    assert.ok(Array.isArray(result.activeExperiments));
    assert.ok(result.activeExperiments.includes("exp-other"));

    cleanupMarketir();
  });

  it("cta dimension appends variant param to template URLs", () => {
    const slugs = ["tool-a"];
    const mDir = setupMarketir(slugs);
    const experiments = [
      {
        id: "exp-cta",
        status: "active",
        slugs: ["tool-a"],
        dimension: "cta",
        control: { key: "control", value: "Original CTA" },
        variant: { key: "cta-bold", value: "Bold CTA" },
      },
    ];

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments, siteBase: "https://example.com" }
    );

    const control = result.items[0];
    const variant = result.items[1];

    // Control URLs should NOT have variant param
    assert.ok(!control.channels.email.journalist.templateUrl.includes("?variant="));
    // Variant URLs should have variant param
    assert.ok(variant.channels.email.journalist.templateUrl.includes("?variant=cta-bold"));
    assert.ok(variant.channels.email.partner.templateUrl.includes("?variant=cta-bold"));
    assert.ok(variant.channels.email.integrator.templateUrl.includes("?variant=cta-bold"));

    cleanupMarketir();
  });

  it("multiple active experiments on different slugs → each gets variants", () => {
    const slugs = ["tool-a", "tool-b"];
    const mDir = setupMarketir(slugs);
    const experiments = [
      {
        id: "exp-001",
        status: "active",
        slugs: ["tool-a"],
        dimension: "tagline",
        control: { key: "control", value: "Orig A" },
        variant: { key: "v-a", value: "Alt A" },
      },
      {
        id: "exp-002",
        status: "active",
        slugs: ["tool-b"],
        dimension: "snippet",
        control: { key: "control", value: "Orig B" },
        variant: { key: "v-b", value: "Alt B" },
      },
    ];

    const result = buildOutreachRun(
      makeQueue(slugs),
      makePromo(),
      { overrides: makeOverrides(slugs), marketirDir: mDir, experiments }
    );

    // tool-a: control + variant = 2, tool-b: control + variant = 2, total = 4
    assert.equal(result.itemCount, 4);

    const toolAItems = result.items.filter((i) => i.slug === "tool-a");
    const toolBItems = result.items.filter((i) => i.slug === "tool-b");
    assert.equal(toolAItems.length, 2);
    assert.equal(toolBItems.length, 2);
    assert.equal(toolAItems[0].variantKey, "control");
    assert.equal(toolAItems[1].variantKey, "v-a");
    assert.equal(toolBItems[0].variantKey, "control");
    assert.equal(toolBItems[1].variantKey, "v-b");

    cleanupMarketir();
  });
});

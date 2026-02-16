import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchPartnersToOutreach } from "../../scripts/gen-partner-targets.mjs";

describe("matchPartnersToOutreach", () => {
  const makeItem = (slug) => ({
    slug,
    links: { presskit: `https://example.com/presskit/${slug}/` },
    channels: {},
  });

  it("returns empty matches when partners list is empty", () => {
    const items = [makeItem("test-tool")];
    const partnersData = { partners: [], schema: {} };
    const { matches, suppressed } = matchPartnersToOutreach(items, partnersData);
    assert.deepStrictEqual(matches, []);
    assert.deepStrictEqual(suppressed, []);
  });

  it("matches by slug", () => {
    const items = [makeItem("zip-meta-map")];
    const partnersData = {
      partners: [
        { name: "Alice", type: "journalist", slug: "zip-meta-map", tags: [] }
      ],
      schema: {}
    };
    const { matches } = matchPartnersToOutreach(items, partnersData);
    assert.equal(matches.length, 1);
    assert.deepStrictEqual(matches[0].matchedSlugs, ["zip-meta-map"]);
    assert.ok(matches[0].reason.includes("slug"));
  });

  it("matches by tags intersection", () => {
    const items = [makeItem("my-tool")];
    const partnersData = {
      partners: [
        { name: "Bob", type: "partner", tags: ["mcp", "security"] }
      ],
      schema: {}
    };
    const overrides = {
      "my-tool": { tags: ["mcp", "code-analysis"], publicProof: true }
    };
    const { matches } = matchPartnersToOutreach(items, partnersData, { overrides });
    assert.equal(matches.length, 1);
    assert.deepStrictEqual(matches[0].matchedSlugs, ["my-tool"]);
    assert.ok(matches[0].reason.includes("tag"));
  });

  it("selects correct template type per partner type", () => {
    const items = [makeItem("tool-a")];
    const makePartner = (type) => ({ name: `P-${type}`, type, slug: "tool-a", tags: [] });

    const { matches: journalistResult } = matchPartnersToOutreach(items, { partners: [makePartner("journalist")], schema: {} });
    assert.equal(journalistResult[0].templateType, "email-journalist");

    const { matches: partnerResult } = matchPartnersToOutreach(items, { partners: [makePartner("partner")], schema: {} });
    assert.equal(partnerResult[0].templateType, "email-partner");

    const { matches: integratorResult } = matchPartnersToOutreach(items, { partners: [makePartner("integrator")], schema: {} });
    assert.equal(integratorResult[0].templateType, "email-integrator");

    const { matches: amplifierResult } = matchPartnersToOutreach(items, { partners: [makePartner("amplifier")], schema: {} });
    assert.equal(amplifierResult[0].templateType, "email-partner"); // fallback
  });

  it("does not modify partners data", () => {
    const items = [makeItem("tool-x")];
    const partnersData = {
      partners: [
        { name: "Charlie", type: "partner", slug: "tool-x", tags: ["mcp"] }
      ],
      schema: { version: "1.0.0" }
    };
    const before = JSON.stringify(partnersData);
    matchPartnersToOutreach(items, partnersData);
    const after = JSON.stringify(partnersData);
    assert.equal(before, after, "partners data must not be modified");
  });

  it("general partner (no slug) matches all items", () => {
    const items = [makeItem("tool-a"), makeItem("tool-b")];
    const partnersData = {
      partners: [
        { name: "General Pat", type: "amplifier", tags: [] }
        // No slug field -> general match
      ],
      schema: {}
    };
    const { matches } = matchPartnersToOutreach(items, partnersData);
    assert.equal(matches.length, 1);
    assert.deepStrictEqual(matches[0].matchedSlugs, ["tool-a", "tool-b"]);
    assert.ok(matches[0].reason.includes("general"));
  });
});

// ── Cooldown suppression tests ──────────────────────────────

describe("matchPartnersToOutreach - cooldown suppression", () => {
  const makeItem = (slug) => ({
    slug,
    links: { presskit: `https://example.com/presskit/${slug}/` },
    channels: {},
  });

  const NOW = new Date("2026-02-16T12:00:00Z").getTime();

  it("suppresses partner within cooldown period", () => {
    const items = [makeItem("tool-a")];
    const partnersData = {
      partners: [
        { name: "Recent Pat", type: "partner", slug: "tool-a", tags: [], lastContactedAt: "2026-02-10" }
      ],
      schema: {}
    };
    // 6 days ago, cooldown is 14 days
    const governance = { cooldownDaysPerPartner: 14 };
    const { matches, suppressed } = matchPartnersToOutreach(items, partnersData, { governance, now: NOW });
    assert.equal(matches.length, 0);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].partner.name, "Recent Pat");
  });

  it("does not suppress partner beyond cooldown period", () => {
    const items = [makeItem("tool-a")];
    const partnersData = {
      partners: [
        { name: "Old Pat", type: "partner", slug: "tool-a", tags: [], lastContactedAt: "2026-01-15" }
      ],
      schema: {}
    };
    // ~32 days ago, well beyond 14-day cooldown
    const governance = { cooldownDaysPerPartner: 14 };
    const { matches, suppressed } = matchPartnersToOutreach(items, partnersData, { governance, now: NOW });
    assert.equal(matches.length, 1);
    assert.equal(suppressed.length, 0);
    assert.equal(matches[0].partner.name, "Old Pat");
  });

  it("suppressedReasons includes days since contact", () => {
    const items = [makeItem("tool-a")];
    const partnersData = {
      partners: [
        { name: "Pat", type: "partner", slug: "tool-a", tags: [], lastContactedAt: "2026-02-12" }
      ],
      schema: {}
    };
    const governance = { cooldownDaysPerPartner: 14 };
    const { suppressed } = matchPartnersToOutreach(items, partnersData, { governance, now: NOW });
    assert.equal(suppressed.length, 1);
    assert.ok(suppressed[0].suppressedReasons[0].includes("4d ago"), `reason: ${suppressed[0].suppressedReasons[0]}`);
    assert.ok(suppressed[0].suppressedReasons[0].includes("cooldown is 14d"));
  });

  it("respects governance.cooldownDaysPerPartner value", () => {
    const items = [makeItem("tool-a")];
    const partnersData = {
      partners: [
        { name: "Pat", type: "partner", slug: "tool-a", tags: [], lastContactedAt: "2026-02-10" }
      ],
      schema: {}
    };
    // 6 days ago — with 5-day cooldown, should NOT suppress
    const governance = { cooldownDaysPerPartner: 5 };
    const { matches, suppressed } = matchPartnersToOutreach(items, partnersData, { governance, now: NOW });
    assert.equal(matches.length, 1);
    assert.equal(suppressed.length, 0);
  });

  it("defaults to 14-day cooldown when governance absent", () => {
    const items = [makeItem("tool-a")];
    const partnersData = {
      partners: [
        { name: "Pat", type: "partner", slug: "tool-a", tags: [], lastContactedAt: "2026-02-10" }
      ],
      schema: {}
    };
    // 6 days ago, default 14-day cooldown should suppress
    const { matches, suppressed } = matchPartnersToOutreach(items, partnersData, { now: NOW });
    assert.equal(matches.length, 0);
    assert.equal(suppressed.length, 1);
  });

  it("suppressed partners do not appear in matches", () => {
    const items = [makeItem("tool-a")];
    const partnersData = {
      partners: [
        { name: "Recent", type: "partner", slug: "tool-a", tags: [], lastContactedAt: "2026-02-14" },
        { name: "Old", type: "journalist", slug: "tool-a", tags: [], lastContactedAt: "2026-01-01" },
      ],
      schema: {}
    };
    const governance = { cooldownDaysPerPartner: 14 };
    const { matches, suppressed } = matchPartnersToOutreach(items, partnersData, { governance, now: NOW });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].partner.name, "Old");
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].partner.name, "Recent");
  });
});

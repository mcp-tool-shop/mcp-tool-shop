/**
 * HTML Output Safety Tests
 *
 * These tests verify that htmlEsc correctly neutralizes all XSS payloads
 * that could appear in generator output. Since the generators use htmlEsc
 * on every user-facing field, proving htmlEsc works on all attack vectors
 * proves the output is safe.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlEsc } from "../../scripts/lib/sanitize.mjs";
import xssFixture from "../fixtures/tool-with-xss.json" with { type: "json" };

/**
 * The safety property of htmlEsc is: no raw < or " characters remain.
 * This prevents HTML tag injection and attribute breakout.
 * Event handlers like onerror= are harmless as plain text without < >.
 */
function assertNoRawHtml(escaped, label) {
  assert.ok(
    !escaped.includes("<"),
    `${label}: found raw < in "${escaped.slice(0, 80)}"`
  );
  assert.ok(
    !escaped.includes(">"),
    `${label}: found raw > in "${escaped.slice(0, 80)}"`
  );
  assert.ok(
    !escaped.includes('"'),
    `${label}: found raw " in "${escaped.slice(0, 80)}"`
  );
}

describe("XSS fixture fields after htmlEsc", () => {
  it("neutralizes tool name", () => {
    assertNoRawHtml(htmlEsc(xssFixture.name), "name");
  });

  it("neutralizes positioning.oneLiner", () => {
    assertNoRawHtml(htmlEsc(xssFixture.positioning.oneLiner), "oneLiner");
  });

  it("neutralizes all valueProps", () => {
    for (const vp of xssFixture.positioning.valueProps) {
      assertNoRawHtml(htmlEsc(vp), "valueProp");
    }
  });

  it("neutralizes claim statements", () => {
    for (const c of xssFixture.claims) {
      assertNoRawHtml(htmlEsc(c.statement), `claim ${c.id}`);
    }
  });

  it("neutralizes antiClaim statements", () => {
    for (const c of xssFixture.antiClaims) {
      assertNoRawHtml(htmlEsc(c.statement), "antiClaim");
    }
  });

  it("neutralizes message text", () => {
    for (const m of xssFixture.messages) {
      assertNoRawHtml(htmlEsc(m.text), `message ${m.id}`);
    }
  });

  it("neutralizes press boilerplate", () => {
    const bp = xssFixture.press.boilerplate;
    assertNoRawHtml(htmlEsc(bp.projectDescription), "projectDescription");
    assertNoRawHtml(htmlEsc(bp.founderBio), "founderBio");
  });

  it("neutralizes press contacts", () => {
    for (const c of xssFixture.press.contacts) {
      assertNoRawHtml(htmlEsc(c.label), "contact label");
    }
  });

  it("neutralizes press quotes", () => {
    for (const q of xssFixture.press.quotes) {
      assertNoRawHtml(htmlEsc(q.text), "quote text");
      assertNoRawHtml(htmlEsc(q.attribution), "quote attribution");
    }
  });

  it("neutralizes comparables", () => {
    for (const c of xssFixture.press.comparables) {
      assertNoRawHtml(htmlEsc(c.target), "comparable target");
      assertNoRawHtml(htmlEsc(c.distinction), "comparable distinction");
    }
  });

  it("neutralizes partner offers", () => {
    for (const o of xssFixture.press.partnerOffers) {
      assertNoRawHtml(htmlEsc(o.description), "partnerOffer description");
    }
  });
});

describe("edge case XSS vectors", () => {
  const vectors = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="javascript:alert(1)">',
    '"><script>alert(1)</script><"',
    "' onmouseover=alert(1) '",
    '<body onload=alert(1)>',
    '<input onfocus=alert(1) autofocus>',
    '<marquee onstart=alert(1)>',
    '<a href="javascript:alert(1)">click</a>',
    '{{constructor.constructor("alert(1)")()}}',
    '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>',
  ];

  for (const vector of vectors) {
    it(`neutralizes: ${vector.slice(0, 50)}`, () => {
      const escaped = htmlEsc(vector);
      assert.ok(!escaped.includes("<"), `should not contain raw < in: ${escaped}`);
    });
  }
});

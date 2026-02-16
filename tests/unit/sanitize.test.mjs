import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlEsc, escapeXml, validateUrl } from "../../scripts/lib/sanitize.mjs";

describe("htmlEsc", () => {
  it("escapes ampersand", () => {
    assert.equal(htmlEsc("a&b"), "a&amp;b");
  });

  it("escapes less-than", () => {
    assert.equal(htmlEsc("<div>"), "&lt;div&gt;");
  });

  it("escapes double quotes", () => {
    assert.equal(htmlEsc('a"b'), "a&quot;b");
  });

  it("escapes single quotes", () => {
    assert.equal(htmlEsc("a'b"), "a&#39;b");
  });

  it("escapes a full script tag", () => {
    assert.equal(
      htmlEsc("<script>alert(1)</script>"),
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("escapes all 5 characters together", () => {
    assert.equal(htmlEsc(`a&b<c>d"e'f`), "a&amp;b&lt;c&gt;d&quot;e&#39;f");
  });

  it("handles empty string", () => {
    assert.equal(htmlEsc(""), "");
  });

  it("coerces non-string input via String()", () => {
    assert.equal(htmlEsc(null), "null");
    assert.equal(htmlEsc(undefined), "undefined");
    assert.equal(htmlEsc(42), "42");
  });

  it("passes through safe strings unchanged", () => {
    assert.equal(htmlEsc("hello world 123"), "hello world 123");
  });

  it("handles img onerror XSS payload", () => {
    const payload = '<img onerror=alert(1) src=x>';
    assert.ok(!htmlEsc(payload).includes("<img"));
  });

  it("handles svg onload XSS payload", () => {
    const payload = "<svg onload=alert(1)>";
    assert.ok(!htmlEsc(payload).includes("<svg"));
  });
});

describe("escapeXml", () => {
  it("is an alias for htmlEsc", () => {
    const input = `a&b<c>d"e'f`;
    assert.equal(escapeXml(input), htmlEsc(input));
  });
});

describe("validateUrl", () => {
  it("accepts https URLs", () => {
    const result = validateUrl("https://github.com/foo/bar");
    assert.equal(result, "https://github.com/foo/bar");
  });

  it("accepts http URLs", () => {
    const result = validateUrl("http://example.com");
    assert.equal(result, "http://example.com/");
  });

  it("rejects javascript: protocol", () => {
    assert.throws(() => validateUrl("javascript:alert(1)"), {
      message: /disallowed protocol/,
    });
  });

  it("rejects data: protocol", () => {
    assert.throws(() => validateUrl("data:text/html,<h1>hi</h1>"), {
      message: /disallowed protocol/,
    });
  });

  it("rejects vbscript: protocol", () => {
    assert.throws(() => validateUrl("vbscript:msgbox(1)"), {
      message: /disallowed protocol/,
    });
  });

  it("rejects file: protocol", () => {
    assert.throws(() => validateUrl("file:///etc/passwd"), {
      message: /disallowed protocol/,
    });
  });

  it("throws on garbage input", () => {
    assert.throws(() => validateUrl("not a url"));
  });

  it("throws on empty string", () => {
    assert.throws(() => validateUrl(""));
  });

  it("includes custom label in error message", () => {
    assert.throws(() => validateUrl("javascript:x", { label: "go-link" }), {
      message: /go-link/,
    });
  });

  it("returns canonical URL string", () => {
    const result = validateUrl("https://example.com/path?a=1#frag");
    assert.equal(result, "https://example.com/path?a=1#frag");
  });
});

/**
 * Shared sanitization utilities for HTML/XML escaping and URL validation.
 *
 * Every generator that writes HTML or SVG MUST use these functions
 * instead of inline ad-hoc escaping.
 */

/**
 * Escape a string for safe insertion into HTML content or attributes.
 * Covers the OWASP-recommended five characters: & < > " '
 */
export function htmlEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Alias for htmlEsc — XML requires the same escaping. */
export function escapeXml(s) {
  return htmlEsc(s);
}

const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);

/**
 * Validate a URL string and enforce protocol allowlist.
 * Returns the canonical URL string on success, throws on failure.
 *
 * @param {string} raw — URL to validate
 * @param {{ label?: string }} opts — optional label for error messages
 * @returns {string} canonical URL
 */
export function validateUrl(raw, { label = "URL" } = {}) {
  const url = new URL(raw); // throws TypeError on malformed input
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`${label}: disallowed protocol "${url.protocol}"`);
  }
  return url.toString();
}

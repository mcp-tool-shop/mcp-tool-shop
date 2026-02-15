#!/usr/bin/env node

/**
 * Smoke test for mcptoolshop.com
 *
 * Checks that key pages and legacy redirects respond correctly.
 * Run manually or from CI after deploy.
 *
 * Usage:
 *   node scripts/smoke-test.mjs                    # test live site
 *   node scripts/smoke-test.mjs http://localhost:4321  # test local dev
 */

const BASE = process.argv[2] || "https://mcptoolshop.com";

const CHECKS = [
  // Key pages — expect 200
  { url: "/", expect: 200, label: "homepage" },
  { url: "/tools/", expect: 200, label: "tools index" },
  { url: "/tools/zip-meta-map/", expect: 200, label: "zip-meta-map tool page" },
  { url: "/releases/", expect: 200, label: "releases page" },
  { url: "/about/", expect: 200, label: "about page" },
  { url: "/support/", expect: 200, label: "support page" },

  // Legacy redirects — expect 200 after following the redirect
  // (fetch follows redirects by default)
  { url: "/brain-dev.html", expect: 200, label: "legacy: brain-dev.html" },
  { url: "/registry.html", expect: 200, label: "legacy: registry.html" },
  { url: "/voice-soundboard.html", expect: 200, label: "legacy: voice-soundboard.html" },

  // Static assets
  { url: "/favicon.svg", expect: 200, label: "favicon" },
  { url: "/screenshots/zip-meta-map.png", expect: 200, label: "zip-meta-map screenshot" },
];

let passed = 0;
let failed = 0;

for (const check of CHECKS) {
  const url = `${BASE}${check.url}`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (res.status === check.expect) {
      console.log(`  ✓ ${check.label} (${res.status})`);
      passed++;
    } else {
      console.error(`  ✗ ${check.label}: expected ${check.expect}, got ${res.status}`);
      failed++;
    }
  } catch (err) {
    console.error(`  ✗ ${check.label}: ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${CHECKS.length} checks`);
if (failed > 0) process.exit(1);

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

  // Lab (internal preview, noindex)
  { url: "/lab/marketir/", expect: 200, label: "lab: marketir preview" },
  { url: "/lab/signals/", expect: 200, label: "lab: signals dashboard" },

  // Marketing outputs (generated from MarketIR)
  { url: "/presskit/zip-meta-map/", expect: 200, label: "presskit: zip-meta-map" },
  { url: "/presskit/zip-meta-map/presskit.json", expect: 200, label: "presskit: machine-readable" },
  { url: "/snippets/zip-meta-map.md", expect: 200, label: "snippets: zip-meta-map" },
  { url: "/campaigns/zip-meta-map-launch/bundle.json", expect: 200, label: "campaign: bundle.json" },
  { url: "/campaigns/zip-meta-map-launch/README.md", expect: 200, label: "campaign: README.md" },

  // Link registry + go-links
  { url: "/links.json", expect: 200, label: "link registry" },
  { url: "/go/zmm-hn/", expect: 200, label: "go-link: zmm-hn" },
  { url: "/go/zmm-github/", expect: 200, label: "go-link: zmm-github" },

  // Static assets
  { url: "/favicon.svg", expect: 200, label: "favicon" },
  { url: "/screenshots/zip-meta-map.png", expect: 200, label: "zip-meta-map screenshot" },
  { url: "/marketir/evidence/zip-meta-map-dashboard.png", expect: 200, label: "marketir evidence screenshot" },
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

// ── Public Proof content check ────────────────────────────
try {
  const proofRes = await fetch(`${BASE}/tools/zip-meta-map/`);
  if (proofRes.ok) {
    const html = await proofRes.text();
    if (html.includes("data-proof-section")) {
      console.log(`  ✓ zip-meta-map Public Proof section present`);
      passed++;
    } else {
      console.error(`  ✗ zip-meta-map Public Proof section missing`);
      failed++;
    }
  } else {
    console.error(`  ✗ zip-meta-map page returned ${proofRes.status}`);
    failed++;
  }
} catch (err) {
  console.error(`  ✗ Public Proof check failed: ${err.message}`);
  failed++;
}

// ── Press kit GitHub Facts content check ──────────────────
try {
  const pkRes = await fetch(`${BASE}/presskit/zip-meta-map/presskit.json`);
  if (pkRes.ok) {
    const pk = await pkRes.json();
    if (pk.githubFacts && pk.githubFacts.observedAt) {
      console.log(`  ✓ presskit.json contains githubFacts`);
      passed++;
    } else {
      console.error(`  ✗ presskit.json missing githubFacts`);
      failed++;
    }
  } else {
    console.error(`  ✗ presskit.json returned ${pkRes.status}`);
    failed++;
  }
} catch (err) {
  console.error(`  ✗ presskit githubFacts check failed: ${err.message}`);
  failed++;
}

// ── Link registry content check ───────────────────────────
try {
  const linksRes = await fetch(`${BASE}/links.json`);
  if (linksRes.ok) {
    const data = await linksRes.json();
    if (data.links && data.links.length > 0) {
      console.log(`  ✓ links.json: ${data.links.length} links`);
      passed++;
    } else {
      console.error(`  ✗ links.json is empty`);
      failed++;
    }
  } else {
    console.error(`  ✗ links.json returned ${linksRes.status}`);
    failed++;
  }
} catch (err) {
  console.error(`  ✗ links.json check failed: ${err.message}`);
  failed++;
}

// ── Snippet source markers check ──────────────────────────
try {
  const snippetRes = await fetch(`${BASE}/snippets/zip-meta-map.md`);
  if (snippetRes.ok) {
    const text = await snippetRes.text();
    if (text.includes("mcptoolshop.com/go/")) {
      console.log(`  ✓ snippet contains go-link source markers`);
      passed++;
    } else {
      console.error(`  ✗ snippet missing go-link source markers`);
      failed++;
    }
  } else {
    console.error(`  ✗ snippet returned ${snippetRes.status}`);
    failed++;
  }
} catch (err) {
  console.error(`  ✗ snippet source marker check failed: ${err.message}`);
  failed++;
}

// ── Build metadata check ───────────────────────────────────
try {
  const buildRes = await fetch(`${BASE}/_build.json`);
  if (buildRes.ok) {
    const build = await buildRes.json();
    console.log(`\n  Build metadata:`);
    console.log(`    commit:  ${build.commit}`);
    console.log(`    built:   ${build.builtAt}`);
    console.log(`    synced:  ${build.syncedAt || "n/a"}`);
    console.log(`    projects: ${build.projects}`);

    // Warn if build is older than 24 hours
    const age = Date.now() - new Date(build.builtAt).getTime();
    const hours = Math.round(age / 3600000);
    if (hours > 24) {
      console.warn(`    ⚠ Build is ${hours}h old`);
    } else {
      console.log(`    age: ${hours}h`);
      passed++;
    }
  } else {
    console.warn(`\n  ⚠ _build.json not found (${buildRes.status}) — skipping freshness check`);
  }
} catch (err) {
  console.warn(`\n  ⚠ _build.json check failed: ${err.message}`);
}

console.log(`\n${passed} passed, ${failed} failed out of ${CHECKS.length + 5} checks`);
if (failed > 0) process.exit(1);

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
  { url: "/lab/targets/", expect: 200, label: "lab: targets viewer" },
  { url: "/lab/clearance/", expect: 200, label: "lab: clearance index" },

  // Marketing outputs (generated from MarketIR)
  { url: "/presskit/zip-meta-map/", expect: 200, label: "presskit: zip-meta-map" },
  { url: "/presskit/zip-meta-map/presskit.json", expect: 200, label: "presskit: machine-readable" },
  { url: "/snippets/zip-meta-map.md", expect: 200, label: "snippets: zip-meta-map" },
  { url: "/campaigns/zip-meta-map-launch/bundle.json", expect: 200, label: "campaign: bundle.json" },
  { url: "/campaigns/zip-meta-map-launch/README.md", expect: 200, label: "campaign: README.md" },

  // Press pages (Astro-rendered)
  { url: "/press/", expect: 200, label: "press index" },
  { url: "/press/zip-meta-map/", expect: 200, label: "press: zip-meta-map" },

  // Outreach packs (generated)
  { url: "/outreach/zip-meta-map/email-partner.md", expect: 200, label: "outreach: email-partner" },
  { url: "/outreach/zip-meta-map/github-readme-snippet.md", expect: 200, label: "outreach: readme-snippet" },

  // Partner packs (generated)
  { url: "/partners/zip-meta-map/partner-pack.zip", expect: 200, label: "partner: zip bundle" },
  { url: "/partners/zip-meta-map/manifest.json", expect: 200, label: "partner: manifest" },

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

// ── Press page verified claims check ──────────────────────
try {
  const pressRes = await fetch(`${BASE}/press/zip-meta-map/`);
  if (pressRes.ok) {
    const html = await pressRes.text();
    if (html.includes("data-verified-claims")) {
      console.log(`  ✓ press page contains data-verified-claims`);
      passed++;
    } else {
      console.error(`  ✗ press page missing data-verified-claims`);
      failed++;
    }
  } else {
    console.error(`  ✗ press page returned ${pressRes.status}`);
    failed++;
  }
} catch (err) {
  console.error(`  ✗ press page check failed: ${err.message}`);
  failed++;
}

// ── Outreach email proof links check ──────────────────────
try {
  const outreachRes = await fetch(`${BASE}/outreach/zip-meta-map/email-partner.md`);
  if (outreachRes.ok) {
    const text = await outreachRes.text();
    if (text.includes("proof:") || text.includes("mcptoolshop.com/press/")) {
      console.log(`  ✓ outreach email contains proof links`);
      passed++;
    } else {
      console.error(`  ✗ outreach email missing proof links`);
      failed++;
    }
  } else {
    console.error(`  ✗ outreach email returned ${outreachRes.status}`);
    failed++;
  }
} catch (err) {
  console.error(`  ✗ outreach proof link check failed: ${err.message}`);
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

// ── Clearance runs.json check (warning-only) ────────────────
try {
  const clearanceRes = await fetch(`${BASE}/lab/clearance/runs.json`);
  if (clearanceRes.ok) {
    const data = await clearanceRes.json();
    if (Array.isArray(data)) {
      console.log(`  ✓ clearance runs.json: ${data.length} entries`);
      if (data.length > 0) passed++;
    } else {
      console.warn(`  ⚠ clearance runs.json is not an array`);
    }
  } else if (clearanceRes.status === 404) {
    console.warn(`  ⚠ clearance runs.json not populated yet (404)`);
  } else {
    console.warn(`  ⚠ clearance runs.json returned ${clearanceRes.status}`);
  }
} catch (err) {
  console.warn(`  ⚠ clearance check skipped: ${err.message}`);
}

// ── Target list checks (warning-only, never fail build) ─────
try {
  const targetsRes = await fetch(`${BASE}/targets/zip-meta-map/targets.json`);
  if (targetsRes.ok) {
    const data = await targetsRes.json();
    if (data.candidates && data.candidates.length > 0) {
      console.log(`  ✓ targets.json: ${data.candidates.length} candidates (scoring v${data.scoringVersion})`);
    } else {
      console.warn(`  ⚠ targets.json exists but has no candidates`);
    }
  } else if (targetsRes.status === 404) {
    console.warn(`  ⚠ targets.json not generated yet (404) — run gen-targets.mjs`);
  } else {
    console.warn(`  ⚠ targets.json returned ${targetsRes.status}`);
  }
} catch (err) {
  console.warn(`  ⚠ targets check skipped: ${err.message}`);
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

// ── Security scan (warning-only, checks live pages for dangerous URLs) ──
try {
  const securityPages = ["/", "/tools/", "/press/zip-meta-map/"];
  const DANGEROUS = /(?:href|src|action)\s*=\s*["']?\s*(?:javascript|data|vbscript):/gi;
  let secIssues = 0;
  for (const page of securityPages) {
    try {
      const res = await fetch(`${BASE}${page}`);
      if (res.ok) {
        const html = await res.text();
        DANGEROUS.lastIndex = 0;
        const matches = html.match(DANGEROUS);
        if (matches) {
          console.warn(`  ⚠ ${page}: ${matches.length} dangerous URL(s) found`);
          secIssues += matches.length;
        }
      }
    } catch { /* skip individual page errors */ }
  }
  if (secIssues === 0) {
    console.log(`  ✓ security scan: no dangerous protocols in ${securityPages.length} sampled pages`);
  }
} catch (err) {
  console.warn(`  ⚠ security scan skipped: ${err.message}`);
}

console.log(`\n${passed} passed, ${failed} failed out of ${CHECKS.length + 7} checks (+ target/security warnings above)`);
if (failed > 0) process.exit(1);

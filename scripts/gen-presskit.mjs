#!/usr/bin/env node

/**
 * Press Kit Generator
 *
 * Generates deterministic press kit pages from MarketIR snapshot data.
 * One press kit per tool that has publicProof: true in overrides.json.
 *
 * Output: site/public/presskit/<slug>/
 *   - index.html   (one-page press kit)
 *   - README.md     (copy/paste version)
 *   - presskit.json  (machine-readable)
 *
 * Usage:
 *   node scripts/gen-presskit.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { htmlEsc } from "./lib/sanitize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const DATA_DIR = path.join(SITE, "src", "data", "marketir");
const OVERRIDES_PATH = path.join(SITE, "src", "data", "overrides.json");
const FACTS_DIR = path.join(SITE, "src", "data", "github-facts");
const LINKS_PATH = path.join(SITE, "src", "data", "links.json");
const OUTPUT_BASE = path.join(SITE, "public", "presskit");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// ─── Load data ────────────────────────────────────────────────────────────────

const overrides = readJson(OVERRIDES_PATH);
if (!overrides) {
  console.error("Failed to load overrides.json");
  process.exit(1);
}

const snapshot = readJson(path.join(DATA_DIR, "marketir.snapshot.json"));
const evidenceManifest = readJson(path.join(DATA_DIR, "manifests", "evidence.manifest.json"));
const evidenceMap = new Map();
if (evidenceManifest?.entries) {
  for (const entry of evidenceManifest.entries) {
    evidenceMap.set(entry.id, entry);
  }
}

// Load link registry for tracked links (fail-soft)
const linksData = readJson(LINKS_PATH);
const linksBySlug = new Map();
if (linksData?.links) {
  for (const link of linksData.links) {
    if (!linksBySlug.has(link.slug)) linksBySlug.set(link.slug, []);
    linksBySlug.get(link.slug).push(link);
  }
}

// ─── Find tools with publicProof ──────────────────────────────────────────────

const enabledSlugs = Object.entries(overrides)
  .filter(([, v]) => v.publicProof === true)
  .map(([k]) => k);

if (enabledSlugs.length === 0) {
  console.log("No tools with publicProof enabled. Nothing to generate.");
  process.exit(0);
}

console.log(`Generating press kits for: ${enabledSlugs.join(", ")}\n`);

// ─── Generate ─────────────────────────────────────────────────────────────────

for (const slug of enabledSlugs) {
  const tool = readJson(path.join(DATA_DIR, "data", "tools", `${slug}.json`));
  if (!tool) {
    console.warn(`  ⚠ No MarketIR data for ${slug}, skipping.`);
    continue;
  }

  const override = overrides[slug];
  const facts = readJson(path.join(FACTS_DIR, `${slug}.json`));
  const outDir = path.join(OUTPUT_BASE, slug);
  fs.mkdirSync(outDir, { recursive: true });

  const proven = (tool.claims || []).filter((c) => c.status === "proven");
  const aspirational = (tool.claims || []).filter((c) => c.status === "aspirational");
  const antiClaims = tool.antiClaims || [];

  // Resolve evidence for proven claims
  const resolvedClaims = proven.map((claim) => ({
    ...claim,
    evidence: (claim.evidenceRefs || [])
      .map((ref) => evidenceMap.get(ref))
      .filter(Boolean),
  }));

  const generatedAt = new Date().toISOString();
  const lockShort = snapshot?.lockSha256?.slice(0, 12) || "unknown";

  // ── presskit.json ─────────────────────────────────────────────────────────

  const presskitJson = {
    slug,
    name: tool.name,
    tagline: tool.positioning?.oneLiner || override?.tagline || "",
    install: override?.install || null,
    stability: override?.stability || null,
    kind: override?.kind || null,
    repo: `https://github.com/mcp-tool-shop-org/${slug}`,
    site: `https://mcptoolshop.com/tools/${slug}/`,
    valueProps: tool.positioning?.valueProps || [],
    provenClaims: resolvedClaims.map((c) => ({
      id: c.id,
      statement: c.statement,
      evidence: c.evidence.map((e) => ({
        id: e.id,
        type: e.type,
        url: e.url || null,
        path: e.path ? `/marketir/evidence/${e.path.split("/").pop()}` : null,
      })),
    })),
    aspirationalClaims: aspirational.map((c) => ({
      id: c.id,
      statement: c.statement,
      notes: c.notes || null,
    })),
    antiClaims: antiClaims.map((c) => c.statement),
    githubFacts: facts
      ? {
          stars: facts.stars,
          forks: facts.forks,
          watchers: facts.watchers,
          openIssues: facts.openIssues,
          openPRs: facts.openPRs,
          license: facts.license,
          latestRelease: facts.latestRelease || null,
          communityHealth: facts.communityHealth || null,
          releasesLast90d: facts.releasesLast90d,
          observedAt: facts.fetchedAt,
        }
      : null,
    trackedLinks: (linksBySlug.get(slug) || []).map((l) => ({
      id: l.id,
      url: `https://mcptoolshop.com/go/${l.id}/`,
      channel: l.channel,
    })),
    press: tool.press
      ? {
          boilerplate: tool.press.boilerplate || null,
          quotes: tool.press.quotes || [],
          comparables: tool.press.comparables || [],
          partnerOffers: tool.press.partnerOffers || [],
          contacts: tool.press.contacts || [],
        }
      : null,
    generatedAt,
    sourcelock: lockShort,
  };

  const presskitJsonText = JSON.stringify(presskitJson, null, 2) + "\n";
  fs.writeFileSync(path.join(outDir, "presskit.json"), presskitJsonText, "utf8");
  console.log(`  wrote ${slug}/presskit.json`);

  // ── README.md ─────────────────────────────────────────────────────────────

  const readmeLines = [];
  readmeLines.push(`# ${tool.name} — Press Kit`);
  readmeLines.push("");
  readmeLines.push(`> ${presskitJson.tagline}`);
  readmeLines.push("");

  if (presskitJson.install) {
    readmeLines.push("## Install");
    readmeLines.push("");
    readmeLines.push("```bash");
    readmeLines.push(presskitJson.install);
    readmeLines.push("```");
    readmeLines.push("");
  }

  if (facts) {
    readmeLines.push("## GitHub Facts");
    readmeLines.push("");
    if (facts.latestRelease) {
      readmeLines.push(`- **Latest release:** ${facts.latestRelease.tag} (${facts.latestRelease.publishedAt?.split("T")[0] || "n/a"})`);
    }
    readmeLines.push(`- **Stars:** ${facts.stars} | **Forks:** ${facts.forks} | **Watchers:** ${facts.watchers}`);
    readmeLines.push(`- **Open issues:** ${facts.openIssues} | **Open PRs:** ${facts.openPRs}`);
    readmeLines.push(`- **License:** ${facts.license || "unknown"}`);
    readmeLines.push(`- **Releases (last 90d):** ${facts.releasesLast90d}`);
    if (facts.communityHealth) {
      const files = facts.communityHealth.files;
      const present = Object.entries(files).filter(([, v]) => v).map(([k]) => k);
      const missing = Object.entries(files).filter(([, v]) => !v).map(([k]) => k);
      readmeLines.push(`- **Community health:** ${facts.communityHealth.score}/100`);
      if (present.length) readmeLines.push(`  - Present: ${present.join(", ")}`);
      if (missing.length) readmeLines.push(`  - Missing: ${missing.join(", ")}`);
    }
    readmeLines.push(`- _Observed at: ${facts.fetchedAt}_`);
    readmeLines.push("");
  }

  readmeLines.push("## Key capabilities");
  readmeLines.push("");
  for (const vp of presskitJson.valueProps) {
    readmeLines.push(`- ${vp}`);
  }
  readmeLines.push("");

  readmeLines.push("## Verified claims");
  readmeLines.push("");
  for (const claim of resolvedClaims) {
    readmeLines.push(`- **${claim.statement}**`);
    for (const ev of claim.evidence) {
      if (ev.url) {
        readmeLines.push(`  - Evidence: [${ev.id}](${ev.url})`);
      } else if (ev.path) {
        readmeLines.push(`  - Evidence: ${ev.id} (local artifact)`);
      }
    }
  }
  readmeLines.push("");

  if (aspirational.length > 0) {
    readmeLines.push("## Aspirational (not yet proven)");
    readmeLines.push("");
    for (const claim of aspirational) {
      readmeLines.push(`- ${claim.statement}`);
      if (claim.notes) readmeLines.push(`  - _${claim.notes}_`);
    }
    readmeLines.push("");
  }

  if (antiClaims.length > 0) {
    readmeLines.push("## Not for");
    readmeLines.push("");
    for (const ac of antiClaims) {
      readmeLines.push(`- ${ac.statement}`);
    }
    readmeLines.push("");
  }

  // Press data sections
  if (tool.press) {
    if (tool.press.quotes?.length > 0) {
      readmeLines.push("## Approved Quotes");
      readmeLines.push("");
      for (const q of tool.press.quotes) {
        readmeLines.push(`> "${q.text}"`);
        if (q.attribution) {
          readmeLines.push(`> — ${q.attribution}${q.role ? `, ${q.role}` : ""}`);
        }
        readmeLines.push("");
      }
    }

    if (tool.press.comparables?.length > 0) {
      readmeLines.push("## Comparables");
      readmeLines.push("");
      for (const c of tool.press.comparables) {
        readmeLines.push(`- **Similar to ${c.target}:** ${c.distinction}`);
      }
      readmeLines.push("");
    }

    if (tool.press.partnerOffers?.length > 0) {
      readmeLines.push("## Partner Offers");
      readmeLines.push("");
      for (const o of tool.press.partnerOffers) {
        readmeLines.push(`- **${o.type}:** ${o.description}`);
      }
      readmeLines.push("");
    }

    if (tool.press.contacts?.length > 0) {
      readmeLines.push("## Contact");
      readmeLines.push("");
      for (const c of tool.press.contacts) {
        if (c.value.startsWith("http")) {
          readmeLines.push(`- ${c.method}: [${c.label || c.value}](${c.value})`);
        } else {
          readmeLines.push(`- ${c.method}: ${c.label || c.value}`);
        }
      }
      readmeLines.push("");
    }
  }

  readmeLines.push("## Links");
  readmeLines.push("");
  readmeLines.push(`- [GitHub](${presskitJson.repo})`);
  readmeLines.push(`- [Tool page](${presskitJson.site})`);
  if (tool.press) {
    readmeLines.push(`- [Press page](https://mcptoolshop.com/press/${slug}/)`);
  }
  readmeLines.push("");

  const toolLinks = linksBySlug.get(slug) || [];
  if (toolLinks.length > 0) {
    readmeLines.push("## Tracked links");
    readmeLines.push("");
    for (const l of toolLinks) {
      readmeLines.push(`- [${l.id}](https://mcptoolshop.com/go/${l.id}/) (${l.channel})`);
    }
    readmeLines.push("");
  }
  readmeLines.push("---");
  readmeLines.push("");
  readmeLines.push(`_Generated from MarketIR${facts ? " + GitHub facts" : ""} (lock: ${lockShort}) at ${generatedAt}_`);
  if (facts) {
    readmeLines.push("");
    readmeLines.push("_GitHub data is non-authoritative and time-stamped. Verify at source._");
  }
  readmeLines.push("");

  const readmeText = readmeLines.join("\n");
  fs.writeFileSync(path.join(outDir, "README.md"), readmeText, "utf8");
  console.log(`  wrote ${slug}/README.md`);

  // ── index.html ────────────────────────────────────────────────────────────

  const claimsHtml = resolvedClaims
    .map((c) => {
      const evLinks = c.evidence
        .map((e) => {
          if (e.url) return `<a href="${htmlEsc(e.url)}" target="_blank" rel="noopener">${htmlEsc(e.id)}</a>`;
          if (e.path) {
            const local = `/marketir/evidence/${e.path.split("/").pop()}`;
            return `<a href="${htmlEsc(local)}" target="_blank">${htmlEsc(e.id)}</a>`;
          }
          return `<span>${htmlEsc(e.id)}</span>`;
        })
        .join(" &middot; ");
      return `<li><strong>${htmlEsc(c.statement)}</strong>${evLinks ? `<br><small>${evLinks}</small>` : ""}</li>`;
    })
    .join("\n          ");

  const aspirationalHtml = aspirational
    .map((c) => `<li>${htmlEsc(c.statement)}${c.notes ? `<br><em>${htmlEsc(c.notes)}</em>` : ""}</li>`)
    .join("\n          ");

  const antiClaimsHtml = antiClaims
    .map((c) => `<li>${htmlEsc(c.statement)}</li>`)
    .join("\n          ");

  const vpHtml = presskitJson.valueProps
    .map((v) => `<li>${htmlEsc(v)}</li>`)
    .join("\n          ");

  function buildFactsHtml(f, esc) {
    const rel = f.latestRelease;
    const ch = f.communityHealth;
    let out = `<h2>GitHub Facts</h2>\n    <div class="facts-grid">`;
    if (rel) {
      out += `\n      <div class="fact"><div class="fact-label">Latest release</div><div class="fact-value">${esc(rel.tag)}</div></div>`;
    }
    out += `\n      <div class="fact"><div class="fact-label">Stars</div><div class="fact-value">${f.stars}</div></div>`;
    out += `\n      <div class="fact"><div class="fact-label">Forks</div><div class="fact-value">${f.forks}</div></div>`;
    out += `\n      <div class="fact"><div class="fact-label">Open issues</div><div class="fact-value">${f.openIssues}</div></div>`;
    out += `\n      <div class="fact"><div class="fact-label">Open PRs</div><div class="fact-value">${f.openPRs}</div></div>`;
    out += `\n      <div class="fact"><div class="fact-label">License</div><div class="fact-value">${esc(f.license || "n/a")}</div></div>`;
    out += `\n      <div class="fact"><div class="fact-label">Releases (90d)</div><div class="fact-value">${f.releasesLast90d}</div></div>`;
    out += `\n    </div>`;
    if (ch) {
      const files = ch.files;
      const items = Object.entries(files)
        .map(([k, v]) => `<li class="${v ? "present" : "missing"}">${esc(k)}</li>`)
        .join("");
      out += `\n    <div style="margin-bottom:0.5rem"><small style="color:var(--muted)">Community health: ${ch.score}/100</small></div>`;
      out += `\n    <ul class="health-list">${items}</ul>`;
    }
    out += `\n    <p class="observed">Observed at: ${esc(f.fetchedAt)}</p>`;
    return out;
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEsc(tool.name)} — Press Kit</title>
    <style>
      :root {
        --bg: #0d1117;
        --surface: #161b22;
        --border: #30363d;
        --text: #e6edf3;
        --muted: #8b949e;
        --accent: #58a6ff;
        --success: #3fb950;
        --mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
        --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: var(--sans); background: var(--bg); color: var(--text); line-height: 1.6; padding: 2rem; max-width: 720px; margin: 0 auto; }
      h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
      h2 { font-size: 1.125rem; margin: 2rem 0 0.75rem; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 0.375rem; }
      .tagline { color: var(--muted); font-size: 1rem; margin-bottom: 1.5rem; }
      .install { font-family: var(--mono); background: var(--surface); border: 1px solid var(--border); padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.875rem; display: inline-block; margin-bottom: 1rem; }
      .badges span { font-family: var(--mono); font-size: 0.625rem; padding: 0.125em 0.5em; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.03em; margin-right: 0.375rem; }
      .badge-stable { color: var(--success); background: rgba(63, 185, 80, 0.1); }
      .badge-kind { color: var(--muted); background: rgba(139, 148, 158, 0.1); }
      ul { padding-left: 1.25rem; }
      li { margin-bottom: 0.5rem; font-size: 0.875rem; }
      li small { color: var(--muted); }
      li small a { color: var(--accent); text-decoration: none; }
      li small a:hover { text-decoration: underline; }
      li em { color: var(--muted); font-size: 0.8125rem; }
      .links { margin-top: 2rem; display: flex; gap: 0.75rem; }
      .links a { font-family: var(--mono); font-size: 0.8125rem; color: var(--accent); text-decoration: none; padding: 0.375rem 0.75rem; border: 1px solid var(--border); border-radius: 6px; }
      .links a:hover { border-color: var(--accent); }
      .facts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; margin-bottom: 0.75rem; }
      .fact { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.75rem; }
      .fact-label { font-size: 0.625rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
      .fact-value { font-family: var(--mono); font-size: 0.875rem; margin-top: 0.125rem; }
      .health-list { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.375rem; }
      .health-list li { font-family: var(--mono); font-size: 0.6875rem; padding: 0.125rem 0.5rem; border-radius: 3px; background: var(--surface); border: 1px solid var(--border); }
      .health-list .present { color: var(--success); }
      .health-list .missing { color: var(--muted); text-decoration: line-through; }
      .observed { font-family: var(--mono); font-size: 0.625rem; color: var(--muted); margin-top: 0.5rem; }
      .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); font-family: var(--mono); font-size: 0.625rem; color: var(--muted); }
      .footer a { color: var(--accent); text-decoration: none; }
    </style>
  </head>
  <body>
    <h1>${htmlEsc(tool.name)}</h1>
    <p class="tagline">${htmlEsc(presskitJson.tagline)}</p>
    ${presskitJson.install ? `<div class="install">${htmlEsc(presskitJson.install)}</div>` : ""}
    <div class="badges">
      ${presskitJson.stability ? `<span class="badge-stable">${htmlEsc(presskitJson.stability)}</span>` : ""}
      ${presskitJson.kind ? `<span class="badge-kind">${htmlEsc(presskitJson.kind)}</span>` : ""}
    </div>

    ${facts ? buildFactsHtml(facts, htmlEsc) : ""}

    <h2>Key capabilities</h2>
    <ul>
      ${vpHtml}
    </ul>

    <h2>Verified claims</h2>
    <ul>
      ${claimsHtml}
    </ul>

    ${aspirational.length > 0 ? `<h2>Aspirational (not yet proven)</h2>\n    <ul>\n      ${aspirationalHtml}\n    </ul>` : ""}

    ${antiClaims.length > 0 ? `<h2>Not for</h2>\n    <ul>\n      ${antiClaimsHtml}\n    </ul>` : ""}

    ${tool.press?.quotes?.length > 0 ? `<h2>Approved Quotes</h2>
    ${tool.press.quotes.map((q) => `<blockquote style="border-left:3px solid var(--accent);padding:0.75rem 1rem;margin:0.5rem 0;background:var(--surface);border-radius:6px"><p style="font-style:italic;margin:0 0 0.25rem">"${htmlEsc(q.text)}"</p>${q.attribution ? `<small style="color:var(--muted)">— ${htmlEsc(q.attribution)}${q.role ? `, ${htmlEsc(q.role)}` : ""}</small>` : ""}</blockquote>`).join("\n    ")}` : ""}

    ${tool.press?.comparables?.length > 0 ? `<h2>Comparables</h2>
    <ul>
      ${tool.press.comparables.map((c) => `<li><strong>Similar to ${htmlEsc(c.target)}:</strong> ${htmlEsc(c.distinction)}</li>`).join("\n      ")}
    </ul>` : ""}

    ${tool.press?.partnerOffers?.length > 0 ? `<h2>Partner Offers</h2>
    <ul>
      ${tool.press.partnerOffers.map((o) => `<li><strong>${htmlEsc(o.type)}:</strong> ${htmlEsc(o.description)}</li>`).join("\n      ")}
    </ul>` : ""}

    ${tool.press?.contacts?.length > 0 ? `<h2>Contact</h2>
    <ul>
      ${tool.press.contacts.map((c) => `<li>${htmlEsc(c.method)}: ${c.value.startsWith("http") ? `<a href="${htmlEsc(c.value)}">${htmlEsc(c.label || c.value)}</a>` : htmlEsc(c.label || c.value)}</li>`).join("\n      ")}
    </ul>` : ""}

    <div class="links">
      <a href="${htmlEsc(presskitJson.repo)}">GitHub</a>
      <a href="${htmlEsc(presskitJson.site)}">Tool page</a>${tool.press ? `
      <a href="/press/${htmlEsc(slug)}/">Press page</a>` : ""}
      <a href="presskit.json">Machine-readable</a>
      <a href="README.md">Copy/paste version</a>
    </div>
    ${(linksBySlug.get(slug) || []).length > 0 ? `<div class="links" style="margin-top:0.5rem">\n      ${(linksBySlug.get(slug) || []).map((l) => `<a href="/go/${htmlEsc(l.id)}/" title="${htmlEsc(l.channel)}">${htmlEsc(l.id)}</a>`).join("\n      ")}\n    </div>` : ""}

    <div class="footer">
      Generated from <a href="https://github.com/mcp-tool-shop/mcpt-marketing">MarketIR</a>${facts ? " + GitHub facts snapshot" : ""}
      &middot; lock: ${htmlEsc(lockShort)}
      &middot; ${htmlEsc(generatedAt)}
      ${facts ? "<br>GitHub data is non-authoritative and time-stamped. Verify at source." : ""}
    </div>
  </body>
</html>
`;

  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
  console.log(`  wrote ${slug}/index.html`);

  // ── release-announcement.md (if latest release exists) ──────────────────
  if (facts?.latestRelease) {
    const rel = facts.latestRelease;
    const raLines = [];
    raLines.push(`# ${tool.name} ${rel.tag} — Release Announcement`);
    raLines.push("");
    raLines.push(`> ${presskitJson.tagline}`);
    raLines.push("");
    raLines.push(`**${tool.name} ${rel.tag}** is now available.`);
    raLines.push("");
    if (presskitJson.install) {
      raLines.push("```bash");
      raLines.push(presskitJson.install);
      raLines.push("```");
      raLines.push("");
    }
    raLines.push("## Verified capabilities");
    raLines.push("");
    for (const claim of resolvedClaims) {
      raLines.push(`- ${claim.statement}`);
    }
    raLines.push("");
    raLines.push("## Links");
    raLines.push("");
    raLines.push(`- [Release notes](${rel.url})`);
    raLines.push(`- [GitHub](${presskitJson.repo})`);
    raLines.push(`- [Tool page](${presskitJson.site})`);
    if (tool.press) {
      raLines.push(`- [Press page](https://mcptoolshop.com/press/${slug}/)`);
    }
    raLines.push("");
    raLines.push("---");
    raLines.push("");
    raLines.push(`_Generated from MarketIR (lock: ${lockShort}) at ${generatedAt}_`);
    raLines.push("");
    fs.writeFileSync(path.join(outDir, "release-announcement.md"), raLines.join("\n"), "utf8");
    console.log(`  wrote ${slug}/release-announcement.md`);
  }
}

console.log(`\nDone. ${enabledSlugs.length} press kit(s) generated.`);

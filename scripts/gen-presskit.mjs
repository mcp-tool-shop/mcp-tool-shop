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
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const DATA_DIR = path.join(SITE, "src", "data", "marketir");
const OVERRIDES_PATH = path.join(SITE, "src", "data", "overrides.json");
const OUTPUT_BASE = path.join(SITE, "public", "presskit");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
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

  readmeLines.push("## Links");
  readmeLines.push("");
  readmeLines.push(`- [GitHub](${presskitJson.repo})`);
  readmeLines.push(`- [Tool page](${presskitJson.site})`);
  readmeLines.push("");
  readmeLines.push("---");
  readmeLines.push("");
  readmeLines.push(`_Generated from MarketIR (lock: ${lockShort}) at ${generatedAt}_`);
  readmeLines.push("");

  const readmeText = readmeLines.join("\n");
  fs.writeFileSync(path.join(outDir, "README.md"), readmeText, "utf8");
  console.log(`  wrote ${slug}/README.md`);

  // ── index.html ────────────────────────────────────────────────────────────

  const htmlEsc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

    <div class="links">
      <a href="${htmlEsc(presskitJson.repo)}">GitHub</a>
      <a href="${htmlEsc(presskitJson.site)}">Tool page</a>
      <a href="presskit.json">Machine-readable</a>
      <a href="README.md">Copy/paste version</a>
    </div>

    <div class="footer">
      Generated from <a href="https://github.com/mcp-tool-shop/mcpt-marketing">MarketIR</a>
      &middot; lock: ${htmlEsc(lockShort)}
      &middot; ${htmlEsc(generatedAt)}
    </div>
  </body>
</html>
`;

  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
  console.log(`  wrote ${slug}/index.html`);
}

console.log(`\nDone. ${enabledSlugs.length} press kit(s) generated.`);

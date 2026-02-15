#!/usr/bin/env node

/**
 * Go-Link Redirect Page Generator
 *
 * Generates /go/<id>/index.html redirect pages for each link in links.json.
 * Same meta-refresh + JS pattern as gen-legacy-redirects.mjs.
 *
 * Output: site/public/go/<id>/index.html
 *
 * Usage:
 *   node scripts/gen-go-links.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LINKS_PATH = path.join(ROOT, "site", "src", "data", "links.json");
const OUTPUT_BASE = path.join(ROOT, "site", "public", "go");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function buildTargetUrl(link) {
  const url = new URL(link.target);
  url.searchParams.set("utm_source", link.utm.source);
  url.searchParams.set("utm_medium", link.utm.medium);
  url.searchParams.set("utm_campaign", link.utm.campaign);
  url.searchParams.set("utm_content", link.utm.content);
  return url.toString();
}

function htmlEsc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Load links ───────────────────────────────────────────────────────────────

const registry = readJson(LINKS_PATH);
if (!registry?.links?.length) {
  console.log("No links.json found or empty. Nothing to generate.");
  process.exit(0);
}

console.log(`Generating go-link redirect pages for ${registry.links.length} links\n`);

// ─── Generate ─────────────────────────────────────────────────────────────────

for (const link of registry.links) {
  const targetUrl = buildTargetUrl(link);
  const outDir = path.join(OUTPUT_BASE, link.id);
  fs.mkdirSync(outDir, { recursive: true });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${htmlEsc(targetUrl)}">
<title>${htmlEsc(link.slug)} - ${htmlEsc(link.channel)}</title>
<script>location.replace(${JSON.stringify(targetUrl)})</script>
</head>
<body>
<p>Redirecting to <a href="${htmlEsc(targetUrl)}">${htmlEsc(link.target)}</a>.</p>
</body>
</html>
`;

  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
  console.log(`  /go/${link.id}/ -> ${link.target}`);
}

console.log(`\nDone. ${registry.links.length} go-link page(s) generated.`);

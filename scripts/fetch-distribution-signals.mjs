#!/usr/bin/env node

/**
 * Distribution Signal Collector
 *
 * Searches GitHub for go-link references in public repos/issues
 * to infer reuse of marketing snippets. Best-effort: API errors
 * produce errors[] entries, never crash the script.
 *
 * NOT part of the deploy pipeline — run manually or on a schedule.
 *
 * Output: site/src/data/signals/<YYYY-MM-DD>.json
 *
 * Usage:
 *   node scripts/fetch-distribution-signals.mjs
 *
 * Environment:
 *   GITHUB_TOKEN — required (code search API needs authentication)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const LINKS_PATH = path.join(SITE, "src", "data", "links.json");
const FACTS_DIR = path.join(SITE, "src", "data", "github-facts");
const OUTPUT_DIR = path.join(SITE, "src", "data", "signals");
const TOKEN = process.env.GITHUB_TOKEN || "";

const THROTTLE_MS = 2000; // GitHub code search rate limit: 10 req/min
const SELF_ORG = "mcp-tool-shop-org";
const SELF_SITE_REPO = "mcp-tool-shop/mcp-tool-shop";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghApi(endpoint) {
  const url = `https://api.github.com/${endpoint}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) headers["Authorization"] = `token ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ─── Load links ───────────────────────────────────────────────────────────────

const linksData = readJson(LINKS_PATH);
if (!linksData?.links?.length) {
  console.error("No links found. Run gen-links.mjs first.");
  process.exit(1);
}

if (!TOKEN) {
  console.error("GITHUB_TOKEN required — code search API needs authentication.");
  process.exit(1);
}

const links = linksData.links;
console.log(`Collecting distribution signals for ${links.length} go-links\n`);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Collect code search signals ──────────────────────────────────────────────

const signals = [];
const errors = [];

for (const link of links) {
  const query = encodeURIComponent(`mcptoolshop.com/go/${link.id}`);
  const endpoint = `search/code?q=${query}`;

  try {
    const data = await ghApi(endpoint);

    // Filter out our own repos
    const externalResults = (data.items || []).filter(
      (item) =>
        !item.repository.full_name.startsWith(`${SELF_ORG}/`) &&
        item.repository.full_name !== SELF_SITE_REPO
    );

    signals.push({
      linkId: link.id,
      channel: link.channel,
      slug: link.slug,
      codeSearchHits: data.total_count,
      externalHits: externalResults.length,
      results: externalResults.slice(0, 10).map((item) => ({
        repo: item.repository.full_name,
        file: item.path,
        url: item.html_url,
      })),
    });

    const ext = externalResults.length;
    console.log(`  ${link.id}: ${data.total_count} total, ${ext} external`);
  } catch (err) {
    errors.push({ linkId: link.id, error: err.message });
    console.warn(`  ${link.id}: error — ${err.message}`);
  }

  await sleep(THROTTLE_MS);
}

// ─── Load GitHub facts summary ────────────────────────────────────────────────

const factsSummary = [];
const slugs = [...new Set(links.map((l) => l.slug))];

for (const slug of slugs) {
  const facts = readJson(path.join(FACTS_DIR, `${slug}.json`));
  if (facts) {
    factsSummary.push({
      slug,
      stars: facts.stars ?? null,
      forks: facts.forks ?? null,
      openIssues: facts.openIssues ?? null,
      latestRelease: facts.latestRelease?.tag ?? null,
      releasesLast90d: facts.releasesLast90d ?? null,
      traffic: facts.traffic ?? null,
      fetchedAt: facts.fetchedAt,
    });
  }
}

// ─── Write output ─────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
const output = {
  collectedAt: new Date().toISOString(),
  date: today,
  linkCount: links.length,
  signals,
  githubFacts: factsSummary,
  errors,
};

const outPath = path.join(OUTPUT_DIR, `${today}.json`);
const json = JSON.stringify(output, null, 2) + "\n";
fs.writeFileSync(outPath, json, "utf8");

console.log(`\nWrote signals/${today}.json (${json.length} bytes)`);
if (errors.length > 0) {
  console.warn(`${errors.length} error(s) — see errors[] in output`);
}
console.log("Done.");

#!/usr/bin/env node

/**
 * Seed releases.json using the gh CLI (which has its own auth).
 * Used locally when the GitHub API rate limit blocks the main sync script.
 * In CI, the main sync script handles this via GITHUB_TOKEN.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";

const ORG = "mcp-tool-shop-org";
const OUT = "site/src/data/releases.json";
const MAX = 50;

function formatName(slug) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function extractBullets(body) {
  if (!body) return [];
  const lines = body.split("\n");
  const bullets = [];
  for (const line of lines) {
    const trimmed = line.replace(/^[\s*\-•]+/, "").trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.toLowerCase().includes("full changelog")) continue;
    if (/^\[.*\]\(.*\)$/.test(trimmed)) continue;
    bullets.push(trimmed);
    if (bullets.length >= 6) break;
  }
  return bullets;
}

// Get all repo names
const repoNames = execSync(
  `gh api "orgs/${ORG}/repos?per_page=100&type=public&sort=updated" --paginate --jq ".[].name"`,
  { encoding: "utf8" }
).trim().split("\n");

console.log(`Found ${repoNames.length} repos, fetching releases...`);

const releases = [];
let fetched = 0;

for (const name of repoNames) {
  try {
    const out = execSync(
      `gh api "repos/${ORG}/${name}/releases?per_page=3"`,
      { encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
    );
    const rels = JSON.parse(out);
    for (const rel of rels) {
      releases.push({
        repo: name,
        toolName: formatName(name),
        tag: rel.tag_name || "",
        name: rel.name || rel.tag_name || "",
        body: extractBullets(rel.body || ""),
        publishedAt: rel.published_at || "",
        url: rel.html_url || "",
        prerelease: rel.prerelease || false,
      });
    }
    if (rels.length > 0) fetched++;
  } catch {
    // no releases or API error — skip
  }
}

releases.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
const capped = releases.slice(0, MAX);

fs.writeFileSync(OUT, JSON.stringify(capped, null, 2) + "\n");
console.log(`Wrote ${capped.length} releases from ${fetched} repos to ${OUT}`);

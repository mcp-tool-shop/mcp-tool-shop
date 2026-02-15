#!/usr/bin/env node

/**
 * Collection Suggestion Script
 *
 * Analyzes projects to suggest new collections or additions to existing ones.
 * Groups tools by category/tags and identifies clusters worth curating.
 *
 * Inputs:
 *   site/src/data/projects.json
 *   site/src/data/collections.json
 *   site/src/data/overrides.json
 *
 * Usage:
 *   node scripts/suggest-collections.mjs
 *   node scripts/suggest-collections.mjs --json   # machine-readable output
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE_DATA = path.join(ROOT, "site", "src", "data");
const JSON_MODE = process.argv.includes("--json");

// ─── Data Loading ────────────────────────────────────────────────────────────

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(SITE_DATA, filename), "utf8"));
}

// ─── Analysis ────────────────────────────────────────────────────────────────

function analyzeCollections(projects, collections, overrides) {
  // Build lookup: which repos are already in a collection?
  const inCollection = new Set();
  for (const col of collections) {
    for (const repo of col.repos) {
      inCollection.add(repo);
    }
  }

  // Build category → repos map
  const byCategory = new Map();
  for (const p of projects) {
    const cat = p.category || overrides[p.repo]?.category;
    if (!cat) continue;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(p);
  }

  // Build tag → repos map (only tags appearing on 2+ repos)
  const byTag = new Map();
  for (const p of projects) {
    const tags = p.tags || [];
    for (const tag of tags) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(p);
    }
  }

  const suggestions = [];

  // 1. Repos not in any collection — suggest additions to existing
  const orphansByCategory = new Map();
  for (const [cat, repos] of byCategory) {
    const orphans = repos.filter((p) => !inCollection.has(p.repo));
    if (orphans.length > 0) {
      orphansByCategory.set(cat, orphans);
    }
  }

  // Match orphans to existing collections by category
  for (const col of collections) {
    // Find the dominant category for this collection
    const colRepos = col.repos.map((r) => projects.find((p) => p.repo === r)).filter(Boolean);
    const catCounts = new Map();
    for (const p of colRepos) {
      const cat = p.category || overrides[p.repo]?.category;
      if (cat) catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
    }
    const dominantCat = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    if (dominantCat && orphansByCategory.has(dominantCat)) {
      const orphans = orphansByCategory.get(dominantCat);
      suggestions.push({
        type: "add-to-existing",
        collection: col.id,
        title: col.title,
        category: dominantCat,
        repos: orphans.map((p) => ({
          repo: p.repo,
          name: p.name,
          tagline: p.tagline || p.description || "",
          stability: p.stability,
        })),
      });
    }
  }

  // 2. Categories with 2+ repos not covered by any collection
  const coveredCategories = new Set();
  for (const col of collections) {
    const colRepos = col.repos.map((r) => projects.find((p) => p.repo === r)).filter(Boolean);
    for (const p of colRepos) {
      const cat = p.category || overrides[p.repo]?.category;
      if (cat) coveredCategories.add(cat);
    }
  }

  for (const [cat, repos] of byCategory) {
    if (coveredCategories.has(cat)) continue;
    if (repos.length < 2) continue;

    suggestions.push({
      type: "new-collection",
      category: cat,
      suggestedId: cat,
      suggestedTitle: formatCollectionTitle(cat),
      repos: repos.map((p) => ({
        repo: p.repo,
        name: p.name,
        tagline: p.tagline || p.description || "",
        stability: p.stability,
      })),
    });
  }

  // 3. Tag clusters (tags with 3+ repos, not already in a collection together)
  // Skip overly broad tags that don't suggest a coherent collection
  const BROAD_TAGS = new Set([
    "python", "typescript", "javascript", "csharp", "dotnet", "rust", "go",
    "cli", "windows", "linux", "macos", "desktop-app", "developer-tools",
  ]);

  for (const [tag, repos] of byTag) {
    if (repos.length < 3) continue;
    if (BROAD_TAGS.has(tag)) continue;

    const notInSameCollection = repos.filter((p) => {
      // Check if this repo is in a collection that contains the other tagged repos
      const theirCollections = collections.filter((c) => c.repos.includes(p.repo));
      return theirCollections.length === 0;
    });

    if (notInSameCollection.length >= 2) {
      // Check it's not redundant with a category-based suggestion
      const categories = new Set(notInSameCollection.map((p) => p.category));
      const isRedundant = suggestions.some(
        (s) => s.type === "new-collection" && categories.has(s.category)
      );
      if (isRedundant) continue;

      suggestions.push({
        type: "tag-cluster",
        tag,
        repos: notInSameCollection.map((p) => ({
          repo: p.repo,
          name: p.name,
          tagline: p.tagline || p.description || "",
          stability: p.stability,
        })),
      });
    }
  }

  // 4. Quality signals for existing collections
  const collectionHealth = [];
  for (const col of collections) {
    const colProjects = col.repos.map((r) => projects.find((p) => p.repo === r)).filter(Boolean);
    const missing = col.repos.filter((r) => !projects.find((p) => p.repo === r));
    const noInstall = colProjects.filter((p) => !p.install);
    const noTagline = colProjects.filter((p) => !p.tagline);
    const experimental = colProjects.filter((p) => p.stability === "experimental");

    if (missing.length > 0 || noInstall.length > 0 || noTagline.length > 0) {
      collectionHealth.push({
        collection: col.id,
        title: col.title,
        repoCount: col.repos.length,
        missing: missing,
        noInstall: noInstall.map((p) => p.repo),
        noTagline: noTagline.map((p) => p.repo),
        experimental: experimental.map((p) => p.repo),
      });
    }
  }

  return { suggestions, collectionHealth };
}

function formatCollectionTitle(category) {
  const titles = {
    "mcp-core": "MCP Core Tools",
    voice: "Voice Stack",
    security: "Security & Testing",
    ml: "ML & Training",
    infrastructure: "Infrastructure",
    desktop: "Desktop Applications",
    devtools: "Developer Tools",
    web: "Web Tools",
    games: "Games & Experiments",
  };
  return titles[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

// ─── Output ──────────────────────────────────────────────────────────────────

function printMarkdown({ suggestions, collectionHealth }) {
  console.log("# Collection Suggestions\n");

  if (suggestions.length === 0 && collectionHealth.length === 0) {
    console.log("No suggestions at this time. All collections look good.\n");
    return;
  }

  // Group by type
  const additions = suggestions.filter((s) => s.type === "add-to-existing");
  const newCollections = suggestions.filter((s) => s.type === "new-collection");
  const tagClusters = suggestions.filter((s) => s.type === "tag-cluster");

  if (additions.length > 0) {
    console.log("## Add to Existing Collections\n");
    for (const s of additions) {
      console.log(`### ${s.title} (${s.collection})\n`);
      console.log(`Category: \`${s.category}\`\n`);
      console.log("| Repo | Name | Tagline | Stability |");
      console.log("|------|------|---------|-----------|");
      for (const r of s.repos) {
        console.log(`| \`${r.repo}\` | ${r.name} | ${r.tagline} | ${r.stability || "?"} |`);
      }
      console.log();
    }
  }

  if (newCollections.length > 0) {
    console.log("## New Collection Suggestions\n");
    for (const s of newCollections) {
      console.log(`### ${s.suggestedTitle} (\`${s.suggestedId}\`)\n`);
      console.log("| Repo | Name | Tagline | Stability |");
      console.log("|------|------|---------|-----------|");
      for (const r of s.repos) {
        console.log(`| \`${r.repo}\` | ${r.name} | ${r.tagline} | ${r.stability || "?"} |`);
      }
      console.log();
    }
  }

  if (tagClusters.length > 0) {
    console.log("## Tag-Based Clusters\n");
    console.log("Tools sharing tags that might form a collection:\n");
    for (const s of tagClusters) {
      console.log(`### Tag: \`${s.tag}\` (${s.repos.length} tools)\n`);
      for (const r of s.repos) {
        console.log(`- **${r.name}** (\`${r.repo}\`) — ${r.tagline}`);
      }
      console.log();
    }
  }

  if (collectionHealth.length > 0) {
    console.log("## Collection Health\n");
    for (const h of collectionHealth) {
      console.log(`### ${h.title} (${h.collection}) — ${h.repoCount} repos\n`);
      if (h.missing.length > 0) {
        console.log(`- **Missing from projects.json**: ${h.missing.join(", ")}`);
      }
      if (h.noInstall.length > 0) {
        console.log(`- **No install command**: ${h.noInstall.join(", ")}`);
      }
      if (h.noTagline.length > 0) {
        console.log(`- **No tagline**: ${h.noTagline.join(", ")}`);
      }
      if (h.experimental.length > 0) {
        console.log(`- **Experimental stability**: ${h.experimental.join(", ")}`);
      }
      console.log();
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const projects = loadJson("projects.json");
  const collections = loadJson("collections.json");
  const overrides = loadJson("overrides.json");

  const results = analyzeCollections(projects, collections, overrides);

  if (JSON_MODE) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printMarkdown(results);
  }
}

main();

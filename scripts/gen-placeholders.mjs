#!/usr/bin/env node

/**
 * Placeholder Screenshot Generator
 *
 * Generates dark-themed placeholder PNGs for flagship tools that
 * don't yet have real screenshots. Updates overrides.json with
 * screenshot + screenshotType fields.
 *
 * Inputs:
 *   site/src/data/projects.json
 *   site/src/data/collections.json
 *   site/src/data/overrides.json
 *
 * Outputs:
 *   site/public/screenshots/<slug>.png
 *   site/src/data/overrides.json (updated with screenshot paths)
 *
 * Usage:
 *   node scripts/gen-placeholders.mjs            # generate all missing
 *   node scripts/gen-placeholders.mjs --dry-run  # preview without writing
 *   node scripts/gen-placeholders.mjs --force    # regenerate even if exists
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Config ──────────────────────────────────────────────────────────────────

const SITE_DATA = path.join(ROOT, "site", "src", "data");
const SCREENSHOTS_DIR = path.join(ROOT, "site", "public", "screenshots");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

// Image dimensions
const WIDTH = 1280;
const HEIGHT = 640;

// Dark theme colors (match global.css)
const BG = "#0d1117";
const BG_SURFACE = "#161b22";
const BORDER = "#30363d";
const TEXT = "#e6edf3";
const TEXT_MUTED = "#8b949e";
const ACCENT = "#58a6ff";
const SUCCESS = "#3fb950";
const WARN = "#d29922";
const DANGER = "#f85149";

// ─── Data Loading ────────────────────────────────────────────────────────────

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(SITE_DATA, filename), "utf8"));
}

// ─── Flagship Selection ──────────────────────────────────────────────────────

function selectFlagships(projects, collections, ignoreList) {
  const ignored = new Set(ignoreList);

  // Flagship = in a collection OR featured OR top by stars
  const collectionRepos = new Set();
  for (const col of collections) {
    for (const repo of col.repos) {
      if (!ignored.has(repo)) collectionRepos.add(repo);
    }
  }

  const flagships = new Set();

  // All collection repos are flagship
  for (const repo of collectionRepos) flagships.add(repo);

  // All featured projects are flagship
  for (const p of projects) {
    if (p.featured && !ignored.has(p.repo)) flagships.add(p.repo);
  }

  // Top 10 by stars (if not already included), excluding ignored
  const byStars = [...projects]
    .filter((p) => !ignored.has(p.repo))
    .sort((a, b) => (b.stars || 0) - (a.stars || 0));
  for (const p of byStars.slice(0, 10)) {
    flagships.add(p.repo);
  }

  return flagships;
}

// ─── SVG Generation ──────────────────────────────────────────────────────────

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stabilityColor(stability) {
  if (stability === "stable") return SUCCESS;
  if (stability === "beta") return WARN;
  if (stability === "experimental") return DANGER;
  return TEXT_MUTED;
}

function truncate(str, max) {
  if (!str || str.length <= max) return str || "";
  return str.slice(0, max - 1) + "\u2026";
}

function generateSvg(project) {
  const name = escapeXml(project.name || project.repo);
  const tagline = escapeXml(truncate(project.tagline || project.description || "", 80));
  const install = project.install ? escapeXml(project.install) : null;
  const stability = project.stability || "experimental";
  const stabColor = stabilityColor(stability);
  const kind = project.kind ? escapeXml(project.kind) : null;
  const url = escapeXml(`mcp-tool-shop.github.io/tools/${project.repo}/`);

  // Build elements
  let y = 180; // starting y after top padding

  // Name
  const nameEl = `<text x="640" y="${y}" text-anchor="middle" font-family="'Segoe UI', system-ui, -apple-system, sans-serif" font-size="48" font-weight="700" fill="${TEXT}">${name}</text>`;
  y += 60;

  // Tagline
  const taglineEl = tagline
    ? `<text x="640" y="${y}" text-anchor="middle" font-family="'Segoe UI', system-ui, -apple-system, sans-serif" font-size="22" fill="${TEXT_MUTED}">${tagline}</text>`
    : "";
  if (tagline) y += 50;

  // Badges row
  const badges = [];
  const badgeY = y + 5;

  // Stability badge
  const stabText = escapeXml(stability.toUpperCase());
  const stabWidth = stability.length * 10 + 20;
  badges.push({ text: stabText, color: stabColor, bg: stabColor + "1a", width: stabWidth });

  // Kind badge
  if (kind) {
    const kindText = escapeXml(kind.toUpperCase());
    const kindWidth = kind.length * 10 + 20;
    badges.push({ text: kindText, color: TEXT_MUTED, bg: TEXT_MUTED + "1a", width: kindWidth });
  }

  const totalBadgeWidth = badges.reduce((sum, b) => sum + b.width + 12, -12);
  let bx = 640 - totalBadgeWidth / 2;
  const badgeEls = badges.map((b) => {
    const el = `<rect x="${bx}" y="${badgeY - 16}" width="${b.width}" height="26" rx="4" fill="${b.bg}"/>` +
      `<text x="${bx + b.width / 2}" y="${badgeY + 3}" text-anchor="middle" font-family="'Courier New', monospace" font-size="13" font-weight="600" letter-spacing="0.5" fill="${b.color}">${b.text}</text>`;
    bx += b.width + 12;
    return el;
  }).join("\n    ");
  y += 45;

  // Install command block
  let installEl = "";
  if (install) {
    const installW = Math.max(install.length * 10 + 60, 300);
    const ix = 640 - installW / 2;
    installEl = `
    <rect x="${ix}" y="${y}" width="${installW}" height="44" rx="6" fill="${BG}" stroke="${BORDER}" stroke-width="1"/>
    <text x="${ix + 14}" y="${y + 17}" font-family="'Courier New', monospace" font-size="11" fill="${TEXT_MUTED}" text-transform="uppercase" letter-spacing="1">INSTALL</text>
    <text x="${ix + 14}" y="${y + 34}" font-family="'Courier New', monospace" font-size="15" fill="${TEXT}">${install}</text>`;
    y += 64;
  }

  // URL at bottom
  const urlEl = `<text x="640" y="${HEIGHT - 50}" text-anchor="middle" font-family="'Courier New', monospace" font-size="14" fill="${TEXT_MUTED}">${url}</text>`;

  // Subtle grid pattern
  const gridPattern = `
    <defs>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${BORDER}" stroke-width="0.5" opacity="0.3"/>
      </pattern>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>`;

  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG_SURFACE}"/>
  ${gridPattern}
  <rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="8" fill="none" stroke="${BORDER}" stroke-width="1"/>
  ${nameEl}
  ${taglineEl}
  ${badgeEls}
  ${installEl}
  ${urlEl}
</svg>`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const projects = loadJson("projects.json");
  const collections = loadJson("collections.json");
  const overrides = loadJson("overrides.json");
  const ignoreList = loadJson("automation.ignore.json");

  const flagships = selectFlagships(projects, collections, ignoreList);
  const projectMap = new Map(projects.map((p) => [p.repo, p]));

  console.log(`Flagships: ${flagships.size} tools`);

  // Filter to those needing placeholders
  const toGenerate = [];
  for (const repo of flagships) {
    const project = projectMap.get(repo);
    if (!project) {
      console.log(`  skip ${repo} — not in projects.json`);
      continue;
    }

    const screenshotPath = path.join(SCREENSHOTS_DIR, `${repo}.png`);
    const hasFile = fs.existsSync(screenshotPath);
    const override = overrides[repo];
    const hasReal = override?.screenshotType === "real";

    if (hasReal && !FORCE) {
      console.log(`  skip ${repo} — has real screenshot`);
      continue;
    }

    if (hasFile && !FORCE) {
      console.log(`  skip ${repo} — placeholder exists`);
      continue;
    }

    toGenerate.push({ repo, project });
  }

  if (toGenerate.length === 0) {
    console.log("Nothing to generate.");
    return;
  }

  console.log(`\nGenerating ${toGenerate.length} placeholder(s)...`);

  // Ensure screenshots directory exists
  if (!DRY_RUN) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  // Dynamically import sharp (transitive dep from Astro)
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    try {
      // Try resolving from site/node_modules
      const { createRequire } = await import("node:module");
      const require = createRequire(path.join(ROOT, "site", "package.json"));
      sharp = require("sharp");
    } catch {
      console.error("ERROR: sharp not available. Install it:");
      console.error("  cd site && npm install --save-dev sharp");
      process.exit(1);
    }
  }

  let generated = 0;
  let overridesChanged = false;

  for (const { repo, project } of toGenerate) {
    const svg = generateSvg(project);
    const outPath = path.join(SCREENSHOTS_DIR, `${repo}.png`);

    if (DRY_RUN) {
      console.log(`  [dry-run] would generate ${repo}.png`);
    } else {
      await sharp(Buffer.from(svg))
        .png({ quality: 90 })
        .toFile(outPath);
      console.log(`  generated ${repo}.png`);
    }

    // Update overrides
    if (!overrides[repo]) overrides[repo] = {};
    if (overrides[repo].screenshotType !== "real") {
      overrides[repo].screenshot = `/screenshots/${repo}.png`;
      overrides[repo].screenshotType = "placeholder";
      overridesChanged = true;
    }

    generated++;
  }

  // Write updated overrides (only overrides.json — sync-org-metadata.mjs
  // is the sole writer of projects.json and merges screenshot fields)
  if (overridesChanged && !DRY_RUN) {
    const ordered = stableOverrides(overrides);
    fs.writeFileSync(
      path.join(SITE_DATA, "overrides.json"),
      JSON.stringify(ordered, null, 2) + "\n"
    );
    console.log(`\nUpdated overrides.json with ${generated} screenshot entries.`);
    console.log("Run sync-org-metadata.mjs to merge into projects.json.");
  } else if (DRY_RUN) {
    console.log(`\n[dry-run] Would update overrides.json with ${generated} screenshot entries.`);
  }

  console.log("Done.");
}

// ─── Override Ordering (mirrors draft-overrides.mjs) ─────────────────────────

const FIELD_ORDER = [
  "featured",
  "tags",
  "category",
  "stability",
  "kind",
  "install",
  "tagline",
  "goodFor",
  "notFor",
  "screenshot",
  "screenshotType",
  "needsHumanReview",
];

function orderFields(obj) {
  const ordered = {};
  for (const key of FIELD_ORDER) {
    if (obj[key] !== undefined) ordered[key] = obj[key];
  }
  for (const key of Object.keys(obj)) {
    if (!FIELD_ORDER.includes(key)) ordered[key] = obj[key];
  }
  return ordered;
}

function stableOverrides(overrides) {
  const sorted = {};
  for (const key of Object.keys(overrides).sort()) {
    sorted[key] = orderFields(overrides[key]);
  }
  return sorted;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

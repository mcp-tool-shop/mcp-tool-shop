#!/usr/bin/env node

/**
 * Link Registry Generator
 *
 * Generates a canonical link registry from MarketIR campaigns and tools.
 * Each link gets a stable short ID, target URL, and UTM parameters.
 *
 * Output:
 *   - site/src/data/links.json     (consumed by downstream generators)
 *   - site/public/links.json       (publicly accessible)
 *
 * Usage:
 *   node scripts/gen-links.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const DATA_DIR = path.join(SITE, "src", "data", "marketir");
const OVERRIDES_PATH = path.join(SITE, "src", "data", "overrides.json");
const OUT_DATA = path.join(SITE, "src", "data", "links.json");
const OUT_PUBLIC = path.join(SITE, "public", "links.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** zip-meta-map → zmm, brain-dev → bd */
function abbreviate(slug) {
  return slug.split("-").map((w) => w[0]).join("");
}

/** Channel → default target URL pattern */
function targetForChannel(channel, slug) {
  const toolPage = `https://mcptoolshop.com/tools/${slug}/`;
  const repo = `https://github.com/mcp-tool-shop-org/${slug}`;
  switch (channel) {
    case "readme":
      return repo;
    case "presskit":
      return `https://mcptoolshop.com/presskit/${slug}/`;
    default:
      return toolPage;
  }
}

/** Campaign ID → short campaign slug for UTM */
function campaignSlug(campaignId) {
  // "camp.zip-meta-map.launch" → "zmm-launch"
  const parts = campaignId.replace(/^camp\./, "").split(".");
  const tool = parts.slice(0, -1).join("-");
  const suffix = parts[parts.length - 1];
  return `${abbreviate(tool)}-${suffix}`;
}

// ─── Load data ────────────────────────────────────────────────────────────────

const overrides = readJson(OVERRIDES_PATH);
if (!overrides) {
  console.error("Failed to load overrides.json");
  process.exit(1);
}

const snapshot = readJson(path.join(DATA_DIR, "marketir.snapshot.json"));
const index = readJson(path.join(DATA_DIR, "data", "marketing.index.json"));

const enabledSlugs = Object.entries(overrides)
  .filter(([, v]) => v.publicProof === true)
  .map(([k]) => k);

if (enabledSlugs.length === 0) {
  console.log("No tools with publicProof enabled. Nothing to generate.");
  process.exit(0);
}

// Build campaign → messageRef lookup
const campaignMap = new Map(); // messageRef → { campaignId, campaignSlug }
if (index?.campaigns) {
  for (const { ref } of index.campaigns) {
    const camp = readJson(path.join(DATA_DIR, "data", ref));
    if (!camp) continue;
    const cSlug = campaignSlug(camp.id);
    for (const phase of camp.phases || []) {
      for (const mRef of phase.messageRefs || []) {
        campaignMap.set(mRef, { campaignId: camp.id, campaignSlug: cSlug });
      }
    }
  }
}

// ─── Detect abbreviation collisions ──────────────────────────────────────────

const abbrevMap = new Map(); // abbrev → [slugs]
for (const slug of enabledSlugs) {
  const abbrev = abbreviate(slug);
  if (!abbrevMap.has(abbrev)) abbrevMap.set(abbrev, []);
  abbrevMap.get(abbrev).push(slug);
}

function prefix(slug) {
  const abbrev = abbreviate(slug);
  // If collision, use full slug instead of abbreviation
  return abbrevMap.get(abbrev).length > 1 ? slug : abbrev;
}

// ─── Generate links ──────────────────────────────────────────────────────────

const links = [];
const generatedAt = snapshot?.fetchedAt || new Date().toISOString();

console.log(`Generating link registry for: ${enabledSlugs.join(", ")}\n`);

for (const slug of enabledSlugs) {
  const tool = readJson(path.join(DATA_DIR, "data", "tools", `${slug}.json`));
  if (!tool) {
    console.warn(`  ⚠ No MarketIR data for ${slug}, skipping.`);
    continue;
  }

  const override = overrides[slug];
  const pfx = prefix(slug);

  // Per-message links
  for (const msg of tool.messages || []) {
    const campInfo = campaignMap.get(msg.id);
    links.push({
      id: `${pfx}-${msg.channel}`,
      slug,
      target: targetForChannel(msg.channel, slug),
      utm: {
        source: "mcptoolshop",
        medium: msg.channel,
        campaign: campInfo?.campaignSlug || pfx,
        content: msg.id,
      },
      channel: msg.channel,
      toolRef: tool.id,
      campaignRef: campInfo?.campaignId || null,
      messageRef: msg.id,
    });
  }

  // CTA links (always generated)
  links.push({
    id: `${pfx}-github`,
    slug,
    target: `https://github.com/mcp-tool-shop-org/${slug}`,
    utm: { source: "mcptoolshop", medium: "cta", campaign: pfx, content: "github" },
    channel: "cta",
    toolRef: tool.id,
    campaignRef: null,
    messageRef: null,
  });

  links.push({
    id: `${pfx}-toolpage`,
    slug,
    target: `https://mcptoolshop.com/tools/${slug}/`,
    utm: { source: "mcptoolshop", medium: "cta", campaign: pfx, content: "toolpage" },
    channel: "cta",
    toolRef: tool.id,
    campaignRef: null,
    messageRef: null,
  });

  // Package manager CTA (conditional)
  const install = override?.install || "";
  if (install.startsWith("pip ") || install.startsWith("pipx ")) {
    links.push({
      id: `${pfx}-pypi`,
      slug,
      target: `https://pypi.org/project/${slug}/`,
      utm: { source: "mcptoolshop", medium: "cta", campaign: pfx, content: "pypi" },
      channel: "cta",
      toolRef: tool.id,
      campaignRef: null,
      messageRef: null,
    });
  }
  if (install.startsWith("npm ") || install.startsWith("npx ")) {
    const pkg = install.split(/\s+/).pop(); // last word is package name
    links.push({
      id: `${pfx}-npm`,
      slug,
      target: `https://www.npmjs.com/package/${pkg}`,
      utm: { source: "mcptoolshop", medium: "cta", campaign: pfx, content: "npm" },
      channel: "cta",
      toolRef: tool.id,
      campaignRef: null,
      messageRef: null,
    });
  }

  console.log(`  ${slug}: ${links.filter((l) => l.slug === slug).length} links`);
}

// Sort for determinism
links.sort((a, b) => a.id.localeCompare(b.id));

const registry = { generatedAt, links };
const text = JSON.stringify(registry, null, 2) + "\n";

// Write to both locations
fs.mkdirSync(path.dirname(OUT_DATA), { recursive: true });
fs.writeFileSync(OUT_DATA, text, "utf8");
console.log(`\n  wrote site/src/data/links.json`);

fs.mkdirSync(path.dirname(OUT_PUBLIC), { recursive: true });
fs.writeFileSync(OUT_PUBLIC, text, "utf8");
console.log(`  wrote site/public/links.json`);

console.log(`\nDone. ${links.length} link(s) registered.`);

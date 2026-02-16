#!/usr/bin/env node

/**
 * Partner Target Generator
 *
 * Cross-references outreach run items with partners.json to produce
 * per-run partner outreach recommendations. NEVER modifies partners.json.
 *
 * Usage:
 *   node scripts/gen-partner-targets.mjs [--dry-run]
 *
 * Reads:
 *   site/public/outreach-run/<date>/outreach-run.json
 *   site/src/data/partners.json
 *   site/src/data/overrides.json
 *
 * Writes:
 *   site/public/outreach-run/<date>/partner-outreach.md
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// ── Helpers ─────────────────────────────────────────────────

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// ── Core ────────────────────────────────────────────────────

/**
 * Match outreach items to partners by tags, type, slug affinity.
 * Applies cooldown suppression when governance config is provided.
 *
 * @param {Array<{ slug: string, links: object, channels: object }>} items - from outreach-run
 * @param {{ partners: Array, schema: object }} partnersData - from partners.json
 * @param {{ overrides?: object, governance?: object, now?: number }} opts
 * @returns {{ matches: Array<{ partner: object, matchedSlugs: string[], reason: string, templateType: string }>, suppressed: Array<{ partner: object, matchedSlugs: string[], suppressedReasons: string[] }> }}
 */
export function matchPartnersToOutreach(items, partnersData, opts = {}) {
  const overrides = opts.overrides || {};
  const governance = opts.governance || {};
  const cooldownDays = governance.cooldownDaysPerPartner || 14;
  const now = opts.now || Date.now();
  const partners = partnersData?.partners || [];
  const results = [];
  const suppressed = [];

  for (const partner of partners) {
    const matchedSlugs = [];
    let reason = "";

    // Build a set of this partner's tags for intersection checks
    const partnerTags = new Set((partner.tags || []).map((t) => t.toLowerCase()));

    for (const item of items) {
      const slug = item.slug;

      // 1. Slug match: partner.slug equals item slug
      if (partner.slug && partner.slug === slug) {
        matchedSlugs.push(slug);
        if (!reason) reason = "slug match";
        continue;
      }

      // 2. Tag match: partner.tags intersects with tool's tags from overrides
      if (partnerTags.size > 0) {
        const toolTags = (overrides[slug]?.tags || []).map((t) => t.toLowerCase());
        const intersection = toolTags.filter((t) => partnerTags.has(t));
        if (intersection.length > 0) {
          matchedSlugs.push(slug);
          if (!reason || reason === "general partner") {
            reason = `tag match: ${intersection.join(", ")}`;
          }
          continue;
        }
      }

      // 3. General match: partner.slug is null/empty -> match with all items
      if (!partner.slug) {
        matchedSlugs.push(slug);
        if (!reason) reason = "general partner";
      }
    }

    if (matchedSlugs.length === 0) continue;

    // Cooldown check: suppress partner if contacted too recently
    if (partner.lastContactedAt) {
      const daysSince = Math.floor(
        (now - new Date(partner.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSince < cooldownDays) {
        suppressed.push({
          partner,
          matchedSlugs: [...new Set(matchedSlugs)],
          suppressedReasons: [
            `contacted ${daysSince}d ago, cooldown is ${cooldownDays}d`,
          ],
        });
        continue; // skip adding to matches
      }
    }

    // Derive templateType from partner.type
    let templateType;
    switch (partner.type) {
      case "journalist":
        templateType = "email-journalist";
        break;
      case "partner":
        templateType = "email-partner";
        break;
      case "integrator":
        templateType = "email-integrator";
        break;
      case "amplifier":
        templateType = "email-partner";
        break;
      default:
        templateType = "email-partner";
    }

    results.push({
      partner,
      matchedSlugs: [...new Set(matchedSlugs)],
      reason,
      templateType,
    });
  }

  return { matches: results, suppressed };
}

/**
 * Full pipeline: load outreach-run + partners, match, write partner-outreach.md.
 *
 * @param {{ date?: string, dataDir?: string, outDir?: string, dryRun?: boolean }} opts
 * @returns {{ matchCount: number, outputPath: string|null }}
 */
export function generatePartnerTargets(opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const dataDir = opts.dataDir || join(ROOT, "site", "src", "data");
  const outDir = opts.outDir || join(ROOT, "site", "public", "outreach-run");
  const dryRun = opts.dryRun || false;

  // 1. Load outreach-run.json
  const runPath = join(outDir, date, "outreach-run.json");
  const outreachRun = safeParseJson(runPath, null);
  if (!outreachRun) {
    console.log(`  No outreach-run.json found at ${runPath}`);
    return { matchCount: 0, outputPath: null };
  }

  // 2. Load partners.json
  const partnersPath = join(dataDir, "partners.json");
  const partnersData = safeParseJson(partnersPath, { partners: [], schema: {} });

  // 3. Load overrides.json for tag matching
  const overrides = safeParseJson(join(dataDir, "overrides.json"), {});

  // 4. Load governance.json for cooldown rules
  const governance = safeParseJson(join(dataDir, "governance.json"), {});

  // 5. Match (with cooldown suppression)
  const { matches, suppressed } = matchPartnersToOutreach(
    outreachRun.items || [], partnersData, { overrides, governance }
  );

  // 6. Generate markdown
  const md = renderPartnerMarkdown(date, matches, outreachRun.items || [], suppressed);

  // 7. Write output
  const outputPath = join(outDir, date, "partner-outreach.md");
  if (dryRun) {
    console.log(`  [dry-run] Would write: ${outputPath}`);
    console.log(`  [dry-run] Matched partners: ${matches.length}`);
    console.log(`  [dry-run] Suppressed: ${suppressed.length}`);
    return { matchCount: matches.length, outputPath: null };
  }

  mkdirSync(join(outDir, date), { recursive: true });
  writeFileSync(outputPath, md, "utf8");
  console.log(`  Wrote ${outputPath}`);

  return { matchCount: matches.length, outputPath };
}

/**
 * Render partner outreach matches as Markdown.
 *
 * @param {string} date
 * @param {Array<{ partner: object, matchedSlugs: string[], reason: string, templateType: string }>} matches
 * @param {Array<{ slug: string, links: object }>} items
 * @param {Array<{ partner: object, matchedSlugs: string[], suppressedReasons: string[] }>} suppressed
 * @returns {string}
 */
function renderPartnerMarkdown(date, matches, items, suppressed = []) {
  const lines = [];

  lines.push(`# Partner Outreach -- ${date}`);
  lines.push("");
  lines.push(`**Matched partners:** ${matches.length}`);
  lines.push("");

  // Matches section
  lines.push("## Matches");
  lines.push("");

  if (matches.length > 0) {
    lines.push("| Partner | Type | Matched Slugs | Template | Reason |");
    lines.push("|---------|------|---------------|----------|--------|");
    for (const m of matches) {
      const name = m.partner.name || "unknown";
      const type = m.partner.type || "unknown";
      const slugs = m.matchedSlugs.join(", ");
      lines.push(`| ${name} | ${type} | ${slugs} | ${m.templateType} | ${m.reason} |`);
    }
  } else {
    lines.push("> No partner matches found. Add partners to `site/src/data/partners.json` to enable targeting.");
  }

  lines.push("");

  // Suppressed Partners section
  if (suppressed.length > 0) {
    lines.push("## Suppressed Partners (Cooldown)");
    lines.push("");
    lines.push("| Partner | Matched Slugs | Reason |");
    lines.push("|---------|---------------|--------|");
    for (const s of suppressed) {
      const name = s.partner.name || "unknown";
      const slugs = s.matchedSlugs.join(", ");
      const reasons = s.suppressedReasons.join("; ");
      lines.push(`| ${name} | ${slugs} | ${reasons} |`);
    }
    lines.push("");
  }

  // Outreach Items section
  lines.push("## Outreach Items");
  lines.push("");
  lines.push("| # | Slug | Presskit | Snippets | Partner Pack |");
  lines.push("|---|------|----------|----------|-------------|");

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const l = item.links || {};
    const presskit = l.presskit ? `[link](${l.presskit})` : "--";
    const snippets = l.snippets ? `[link](${l.snippets})` : "--";
    const partnerPack = l.partnerPack ? `[link](${l.partnerPack})` : "--";
    lines.push(`| ${i + 1} | ${item.slug} | ${presskit} | ${snippets} | ${partnerPack} |`);
  }

  lines.push("");
  lines.push("---");
  lines.push(`*Generated: ${new Date().toISOString()}*`);
  lines.push("");

  return lines.join("\n");
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-partner-targets.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating partner targets...");
  if (dryRun) console.log("  Mode: DRY RUN");
  const result = generatePartnerTargets({ dryRun });
  console.log(`  Matches: ${result.matchCount}`);
}

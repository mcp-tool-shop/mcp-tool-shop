#!/usr/bin/env node

/**
 * Promotion Coordinator
 *
 * Reads promo-queue.json and orchestrates focused content generation
 * for queued slugs. Calls existing generators with --slugs filter
 * and updates overrides.json featured flags.
 *
 * Usage:
 *   node scripts/gen-promo.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/promo.json       (enabled flag)
 *   site/src/data/promo-queue.json  (slug queue)
 *
 * Writes:
 *   site/src/data/overrides.json   (featured flag updates)
 *   /tmp/promo-report.md           (results summary)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");

// ── Helpers ─────────────────────────────────────────────────

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// ── Exports ─────────────────────────────────────────────────

/**
 * Check if promotion is enabled.
 * @param {string} [promoPath]
 * @returns {boolean}
 */
export function isPromotionEnabled(promoPath) {
  const p = promoPath || join(DATA_DIR, "promo.json");
  const promo = safeParseJson(p, {});
  return promo.enabled === true;
}

/**
 * Load the promotion queue.
 * @param {string} [queuePath]
 * @returns {{ week: string, slugs: Array, promotionType: string, notes: string }}
 */
export function loadPromoQueue(queuePath) {
  const p = queuePath || join(DATA_DIR, "promo-queue.json");
  const queue = safeParseJson(p, { week: "", slugs: [], promotionType: "own", notes: "" });
  return queue;
}

/**
 * Generate a promotion report from queue and results.
 * @param {{ slugs: Array, promotionType: string, week: string }} queue
 * @param {Array<{ slug: string, channel: string, ok: boolean, error?: string }>} results
 * @returns {string} Markdown report
 */
export function generatePromoReport(queue, results) {
  const lines = [];
  lines.push(`# Promotion Report — ${queue.week}`);
  lines.push("");
  lines.push(`**Type:** ${queue.promotionType}`);
  lines.push(`**Slugs:** ${queue.slugs.length > 0 ? queue.slugs.map((s) => s.slug || s).join(", ") : "(none)"}`);
  lines.push("");

  if (results.length === 0) {
    lines.push("> No promotion actions taken.");
    lines.push("");
    return lines.join("\n");
  }

  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;

  lines.push(`| Slug | Channel | Status |`);
  lines.push(`|------|---------|--------|`);
  for (const r of results) {
    const status = r.ok ? "OK" : `FAIL: ${r.error || "unknown"}`;
    lines.push(`| ${r.slug} | ${r.channel} | ${status} |`);
  }
  lines.push("");
  lines.push(`**Summary:** ${ok} succeeded, ${fail} failed`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Generate campaign bundle artifacts (JSON + Markdown summary).
 *
 * @param {{ slugs: Array, promotionType: string, week: string, campaign?: { id: string, goal: string, period: { start: string, end: string } } }} queue
 * @param {Array<{ slug: string, channel: string, ok: boolean }>} results
 * @param {{ outDir?: string, siteBase?: string, dryRun?: boolean }} opts
 * @returns {{ generated: boolean, bundleDir?: string }}
 */
export function generateCampaignBundle(queue, results, opts = {}) {
  const campaign = queue.campaign;
  if (!campaign || !campaign.id) {
    return { generated: false };
  }

  const siteBase = opts.siteBase || "https://mcptoolshop.com";
  const outDir = opts.outDir || join(ROOT, "site", "public", "promo-bundles", campaign.id);
  const dryRun = opts.dryRun || false;

  // Build per-slug links
  const slugLinks = {};
  for (const entry of queue.slugs) {
    const slug = typeof entry === "string" ? entry : entry.slug;
    slugLinks[slug] = {
      pressPage: `${siteBase}/press/${slug}/`,
      partnerEmail: `${siteBase}/outreach/${slug}/email-partner.md`,
      partnerPack: `${siteBase}/partners/${slug}/partner-pack.zip`,
      campaignBundle: `${siteBase}/promo-bundles/${campaign.id}/promo-bundle.json`,
      snippets: `${siteBase}/snippets/${slug}.md`,
      presskit: `${siteBase}/presskit/${slug}/`,
    };
  }

  const bundleJson = {
    campaignId: campaign.id,
    goal: campaign.goal || "",
    period: campaign.period || {},
    slugs: queue.slugs.map((s) => (typeof s === "string" ? s : s.slug)),
    links: slugLinks,
    generatedAt: new Date().toISOString(),
  };

  // Build markdown summary
  const mdLines = [];
  mdLines.push(`# Campaign: ${campaign.id}`);
  mdLines.push(`**Goal:** ${campaign.goal || "N/A"}`);
  if (campaign.period?.start && campaign.period?.end) {
    mdLines.push(`**Period:** ${campaign.period.start} \u2013 ${campaign.period.end}`);
  }
  mdLines.push("");
  mdLines.push("## Ready-to-Send Links");
  mdLines.push("| Slug | Press Page | Partner Email | Partner Pack | Campaign |");
  mdLines.push("|------|-----------|---------------|-------------|----------|");
  for (const [slug, links] of Object.entries(slugLinks)) {
    mdLines.push(`| ${slug} | [Press](${links.pressPage}) | [Email](${links.partnerEmail}) | [ZIP](${links.partnerPack}) | [Bundle](${links.campaignBundle}) |`);
  }
  mdLines.push("");

  if (dryRun) {
    console.log(`  [dry-run] Would write campaign bundle to ${outDir}/`);
    return { generated: true, bundleDir: outDir };
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "promo-bundle.json"), JSON.stringify(bundleJson, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "promo-bundle.md"), mdLines.join("\n"), "utf8");
  console.log(`  Campaign bundle written to ${outDir}/`);

  return { generated: true, bundleDir: outDir };
}

// ── Runner ──────────────────────────────────────────────────

function runGenerator(script, slugs, dryRun) {
  const cmd = `node ${script} --slugs ${slugs}`;
  if (dryRun) {
    console.log(`  [dry-run] Would run: ${cmd}`);
    return true;
  }
  try {
    console.log(`  $ ${cmd}`);
    execSync(cmd, { stdio: "inherit", timeout: 60000 });
    return true;
  } catch (err) {
    console.error(`  Failed: ${err.message}`);
    return false;
  }
}

function runPromotion(opts = {}) {
  const dryRun = opts.dryRun || false;
  const promoPath = opts.promoPath || join(DATA_DIR, "promo.json");
  const queuePath = opts.queuePath || join(DATA_DIR, "promo-queue.json");
  const overridesPath = opts.overridesPath || join(DATA_DIR, "overrides.json");

  // 1. Check enabled
  if (!isPromotionEnabled(promoPath)) {
    console.log("Promotion disabled (promo.json enabled=false). Exiting.");
    return [];
  }

  // 2. Load queue
  const queue = loadPromoQueue(queuePath);
  if (!queue.slugs || queue.slugs.length === 0) {
    console.log("Promotion queue is empty. Nothing to do.");
    return [];
  }

  console.log(`Promotion cycle: ${queue.slugs.length} slug(s), type=${queue.promotionType}`);

  // 2b. Ecosystem gate: validate slugs against worthy.json
  const worthyPath = opts.worthyPath || join(DATA_DIR, "worthy.json");
  const worthy = safeParseJson(worthyPath, { repos: {} });

  const results = [];
  const scriptsDir = resolve(import.meta.dirname);

  for (const entry of queue.slugs) {
    const slug = typeof entry === "string" ? entry : entry.slug;
    const channels = typeof entry === "string" ? ["presskit", "snippets", "campaigns"] : (entry.channels || ["presskit", "snippets", "campaigns"]);

    // Ecosystem gate: skip non-worthy slugs when promotionType is "ecosystem"
    if (queue.promotionType === "ecosystem") {
      const repo = worthy.repos?.[slug];
      if (!repo || !repo.worthy) {
        console.log(`\n  Skipping ${slug}: not worthy (ecosystem gate)`);
        results.push({ slug, channel: "all", ok: false, error: "not worthy (ecosystem gate)" });
        continue;
      }
    }

    console.log(`\n  Processing: ${slug} (channels: ${channels.join(", ")})`);

    for (const channel of channels) {
      let script;
      switch (channel) {
        case "presskit":
          script = join(scriptsDir, "gen-presskit.mjs");
          break;
        case "snippets":
          script = join(scriptsDir, "gen-snippets.mjs");
          break;
        case "campaigns":
          script = join(scriptsDir, "gen-campaign-bundles.mjs");
          break;
        default:
          console.warn(`  Unknown channel: ${channel}, skipping.`);
          results.push({ slug, channel, ok: false, error: "unknown channel" });
          continue;
      }

      const ok = runGenerator(script, slug, dryRun);
      results.push({ slug, channel, ok });
    }
  }

  // 3. Update featured flags in overrides.json (additive)
  if (!dryRun && existsSync(overridesPath)) {
    const overrides = safeParseJson(overridesPath, {});
    let changed = false;
    for (const entry of queue.slugs) {
      const slug = typeof entry === "string" ? entry : entry.slug;
      if (overrides[slug] && !overrides[slug].featured) {
        overrides[slug].featured = true;
        changed = true;
        console.log(`  Featured: ${slug}`);
      }
    }
    if (changed) {
      writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + "\n", "utf8");
    }
  }

  // 4. Generate campaign bundle (if campaign defined)
  if (queue.campaign && queue.campaign.id) {
    generateCampaignBundle(queue, results, { dryRun });
  }

  // 5. Write report
  const report = generatePromoReport(queue, results);
  const reportPath = dryRun ? null : "/tmp/promo-report.md";
  if (reportPath) {
    writeFileSync(reportPath, report, "utf8");
    console.log(`\nReport written to ${reportPath}`);
  }

  return results;
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-promo.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  const results = runPromotion({ dryRun });
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    console.error(`\n${failed} promotion action(s) failed.`);
    process.exit(1);
  }
}

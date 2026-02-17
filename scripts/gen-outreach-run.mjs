#!/usr/bin/env node

/**
 * Outreach Run Generator
 *
 * Generates time-stamped outreach run manifests with links to all per-tool
 * materials and channel-specific "ready-to-send" blocks.
 *
 * Usage:
 *   node scripts/gen-outreach-run.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/promo.json
 *   site/src/data/promo-queue.json
 *   site/src/data/overrides.json
 *   site/src/data/worthy.json
 *   site/src/data/marketir/data/tools/<slug>.json
 *
 * Writes:
 *   site/public/outreach-run/<date>/outreach-run.json
 *   site/public/outreach-run/<date>/outreach-run.md
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildPromoWeekReceipt } from "./gen-promo-week-receipt.mjs";

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

// ── Core ────────────────────────────────────────────────────

/**
 * Build an outreach run from a promotion queue and promo config.
 *
 * @param {{ week: string, slugs: Array, promotionType: string, notes: string }} queue
 * @param {{ enabled: boolean, caps: object, lastModified: string, modifiedBy: string }} promo
 * @param {{ siteBase?: string, maxItems?: number, overrides?: object, worthy?: object, marketirDir?: string }} opts
 * @returns {object|null} Outreach run manifest, or null if disabled
 */
export function buildOutreachRun(queue, promo, opts = {}) {
  const siteBase = opts.siteBase || "https://mcptoolshop.com";
  const maxItems = opts.maxItems || 3;
  const marketirDir = opts.marketirDir || join(ROOT, "site", "src", "data", "marketir");
  const overrides = opts.overrides || safeParseJson(join(DATA_DIR, "overrides.json"), {});
  const worthy = opts.worthy || safeParseJson(join(DATA_DIR, "worthy.json"), {});
  const warnings = [];

  // 1. Check promo.enabled
  if (promo.enabled !== true) {
    return null;
  }

  // 2. Normalize slugs: string -> { slug, channels }
  const normalized = (queue.slugs || []).map((entry) => {
    if (typeof entry === "string") {
      return { slug: entry, channels: null };
    }
    return { slug: entry.slug, channels: entry.channels || null };
  });

  // 3. Filter by publicProof
  const withProof = [];
  for (const entry of normalized) {
    const override = overrides[entry.slug];
    if (!override || override.publicProof !== true) {
      warnings.push(`Skipped ${entry.slug}: missing publicProof in overrides`);
      continue;
    }
    withProof.push(entry);
  }

  // 4. Ecosystem gate: skip non-worthy slugs
  const gated = [];
  for (const entry of withProof) {
    if (queue.promotionType === "ecosystem") {
      const repo = worthy?.repos?.[entry.slug];
      if (!repo || !repo.worthy) {
        warnings.push(`Skipped ${entry.slug}: not worthy (ecosystem gate)`);
        continue;
      }
    }
    gated.push(entry);
  }

  // 5. Hard cap
  if (gated.length > maxItems) {
    const excess = gated.length - maxItems;
    warnings.push(`Items truncated: ${excess} slug(s) exceeded maxItems cap (${maxItems})`);
  }
  const capped = gated.slice(0, maxItems);

  // 6. Build items
  const items = [];
  for (const entry of capped) {
    const slug = entry.slug;

    // Build links
    const links = {
      presskit: `${siteBase}/presskit/${slug}/`,
      snippets: `${siteBase}/snippets/${slug}.md`,
      outreachPack: `${siteBase}/outreach/${slug}/`,
      partnerPack: `${siteBase}/partners/${slug}/partner-pack.zip`,
      proofPage: `${siteBase}/proof/${slug}/`,
    };

    // Load MarketIR tool data
    const tool = safeParseJson(join(marketirDir, "data", "tools", `${slug}.json`), null);
    const messages = tool?.messages || [];

    // Find channel text by channel field
    function findMessage(channel, fallbackChannel) {
      const msg = messages.find((m) => m.channel === channel);
      if (msg) return msg.text;
      if (fallbackChannel) {
        const fb = messages.find((m) => m.channel === fallbackChannel);
        if (fb) return fb.text;
      }
      return "";
    }

    const toolName = tool?.name || slug;
    const oneLiner = tool?.positioning?.oneLiner || "";

    // Build channels object
    const hnText = findMessage("hn", "web");
    const dmText = findMessage("x", "web");

    const channels = {
      email: {
        journalist: {
          subject: oneLiner ? `${toolName}: ${oneLiner}` : toolName,
          templateUrl: `${siteBase}/outreach/${slug}/email-journalist.md`,
        },
        partner: {
          subject: `Partnership opportunity: ${toolName}`,
          templateUrl: `${siteBase}/outreach/${slug}/email-partner.md`,
        },
        integrator: {
          subject: `Integration: ${toolName}`,
          templateUrl: `${siteBase}/outreach/${slug}/email-integrator.md`,
        },
      },
      social: {
        hn: {
          text: hnText,
          charCount: hnText.length,
        },
        dm: {
          text: dmText,
          charCount: dmText.length,
        },
      },
      readme: {
        snippetUrl: `${siteBase}/snippets/${slug}.md`,
      },
    };

    items.push({ slug, links, channels });
  }

  // 7. Experiment variants
  const experiments = opts.experiments || [];
  const activeExps = experiments.filter((e) => e.status === "active");
  const activeExperiments = activeExps.map((e) => e.id);
  const variantItems = [];

  for (const item of items) {
    const matchingExp = activeExps.find((e) => e.slugs && e.slugs.includes(item.slug));
    if (!matchingExp) {
      // No experiment — item goes through as-is (no experimentId field)
      variantItems.push(item);
      continue;
    }

    // Control item
    const controlItem = { ...item, experimentId: matchingExp.id, variantKey: "control" };

    // Variant item — deep clone channels and modify per dimension
    const variantChannels = JSON.parse(JSON.stringify(item.channels));

    if (matchingExp.dimension === "tagline") {
      // Modify email subject lines
      if (variantChannels.email?.journalist) {
        variantChannels.email.journalist.subject = matchingExp.variant.value;
      }
      if (variantChannels.email?.partner) {
        variantChannels.email.partner.subject = matchingExp.variant.value;
      }
      if (variantChannels.email?.integrator) {
        variantChannels.email.integrator.subject = matchingExp.variant.value;
      }
    } else if (matchingExp.dimension === "snippet") {
      // Modify social text
      if (variantChannels.social?.hn) {
        variantChannels.social.hn.text = matchingExp.variant.value;
        variantChannels.social.hn.charCount = matchingExp.variant.value.length;
      }
      if (variantChannels.social?.dm) {
        variantChannels.social.dm.text = matchingExp.variant.value;
        variantChannels.social.dm.charCount = matchingExp.variant.value.length;
      }
    } else if (matchingExp.dimension === "cta") {
      // Append variant param to template URLs
      for (const role of ["journalist", "partner", "integrator"]) {
        if (variantChannels.email?.[role]?.templateUrl) {
          variantChannels.email[role].templateUrl += `?variant=${matchingExp.variant.key}`;
        }
      }
    }

    const variantItem = {
      ...item,
      channels: variantChannels,
      experimentId: matchingExp.id,
      variantKey: matchingExp.variant.key,
    };

    variantItems.push(controlItem);
    variantItems.push(variantItem);
  }

  // 8. LearningMode channel suggestions
  const learningMode = opts.learningMode || "off";
  const feedbackSummary = opts.feedbackSummary || null;
  let channelSuggestions = undefined;

  if ((learningMode === "suggest" || learningMode === "apply") && feedbackSummary) {
    const channelScores = [];
    for (const [ch, counts] of Object.entries(feedbackSummary.perChannel || {})) {
      const total = counts.sent + counts.opened + counts.replied + counts.ignored + counts.bounced;
      if (total === 0) continue;
      const replyRate = counts.replied / total;
      const ignoreRate = counts.ignored / total;
      channelScores.push({ channel: ch, score: Math.round((replyRate - ignoreRate) * 100) / 100, ignoreRate });
    }
    channelScores.sort((a, b) => b.score - a.score);
    channelSuggestions = channelScores.map((c) => `${c.channel} (score: ${c.score})`);

    // In apply mode, exclude channels with >70% ignore rate
    if (learningMode === "apply") {
      const dropChannels = new Set(channelScores.filter((c) => c.ignoreRate > 0.7).map((c) => c.channel));
      if (dropChannels.size > 0) {
        for (const dropped of dropChannels) {
          warnings.push(`learningMode=apply: dropped channel "${dropped}" (>70% ignore rate)`);
        }
      }
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    week: queue.week,
    promotionType: queue.promotionType,
    itemCount: variantItems.length,
    maxItems,
    items: variantItems,
    warnings,
  };

  if (activeExperiments.length > 0) {
    result.activeExperiments = activeExperiments;
  }

  if (channelSuggestions !== undefined) {
    result.channelSuggestions = channelSuggestions;
  }

  return result;
}

/**
 * Render an outreach run object as a Markdown summary.
 *
 * @param {object} run - Output from buildOutreachRun
 * @returns {string} Markdown text
 */
function renderMarkdown(run) {
  const lines = [];

  lines.push(`# Spotlight Run -- ${run.week}`);
  lines.push("");
  lines.push(`**Type:** ${run.promotionType}  `);
  lines.push(`**Items:** ${run.itemCount} / ${run.maxItems} max`);
  lines.push("");

  // Send List table
  lines.push("## Send List");
  lines.push("");
  lines.push("| # | Slug | Press Kit | Snippets | Partner Pack | Proof Page |");
  lines.push("|---|------|-----------|----------|-------------|------------|");
  for (let i = 0; i < run.items.length; i++) {
    const item = run.items[i];
    const l = item.links;
    lines.push(
      `| ${i + 1} | ${item.slug} | [presskit](${l.presskit}) | [snippets](${l.snippets}) | [partner](${l.partnerPack}) | [proof](${l.proofPage}) |`
    );
  }
  lines.push("");

  // Email Subjects
  lines.push("## Email Subjects");
  lines.push("");
  for (const item of run.items) {
    const e = item.channels.email;
    lines.push(`### ${item.slug}`);
    lines.push(`- **Journalist:** ${e.journalist.subject}`);
    lines.push(`- **Partner:** ${e.partner.subject}`);
    lines.push(`- **Integrator:** ${e.integrator.subject}`);
    lines.push("");
  }

  // Social Copy
  lines.push("## Social Copy");
  lines.push("");
  for (const item of run.items) {
    const s = item.channels.social;
    lines.push(`### ${item.slug}`);
    lines.push(`**HN:** ${s.hn.text} (${s.hn.charCount} chars)`);
    lines.push(`**DM:** ${s.dm.text} (${s.dm.charCount} chars)`);
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Generated: ${run.generatedAt}*`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Write a weekly Spotlight Kit bundle to docs/spotlight/<date>/.
 *
 * @param {object} run - Output from buildOutreachRun
 * @param {string} dateStr - YYYY-MM-DD date string
 * @param {{ root?: string, overrides?: object, siteBase?: string }} opts
 */
export function writeSpotlightKit(run, dateStr, opts = {}) {
  const root = opts.root || ROOT;
  const siteBase = opts.siteBase || "https://mcptoolshop.com";
  const overrides = opts.overrides || {};
  const kitDir = join(root, "docs", "spotlight", dateStr);

  mkdirSync(kitDir, { recursive: true });

  // ── post-x.md ──────────────────────────────────────────
  const xLines = [`# X Post — Spotlight Week ${dateStr}`, ""];
  for (const item of run.items) {
    const ov = overrides[item.slug] || {};
    const oneLiner = item.channels?.social?.dm?.text || ov.tagline || item.slug;
    const install = ov.install || "";
    xLines.push(oneLiner);
    if (install) xLines.push("", `\`${install}\``);
    xLines.push("", `${siteBase}/proof/${item.slug}/`);
    xLines.push("", "#MCP #AITools #WeeklySpotlight", "");
  }
  writeFileSync(join(kitDir, "post-x.md"), xLines.join("\n"), "utf8");

  // ── post-linkedin.md ───────────────────────────────────
  const liLines = [`# LinkedIn Post — Spotlight Week ${dateStr}`, ""];
  for (const item of run.items) {
    const ov = overrides[item.slug] || {};
    const toolName = ov.tagline ? item.slug : item.slug;
    liLines.push(`## This Week's Spotlight: ${item.slug}`, "");
    if (ov.tagline) liLines.push(ov.tagline, "");
    if (ov.goodFor && ov.goodFor.length > 0) {
      liLines.push("**Best for:**");
      for (const g of ov.goodFor.slice(0, 2)) liLines.push(`- ${g}`);
      liLines.push("");
    }
    if (ov.notFor && ov.notFor.length > 0) {
      liLines.push("**Not for:**");
      for (const n of ov.notFor.slice(0, 1)) liLines.push(`- ${n}`);
      liLines.push("");
    }
    if (ov.install) liLines.push(`Install: \`${ov.install}\``, "");
    liLines.push(`Verified: ${siteBase}/proof/${item.slug}/`, "");
  }
  liLines.push("---", "MCP Tool Shop | Weekly Spotlight", "");
  writeFileSync(join(kitDir, "post-linkedin.md"), liLines.join("\n"), "utf8");

  // ── post-hn.md ─────────────────────────────────────────
  const hnLines = [`# HN Post — Spotlight Week ${dateStr}`, ""];
  for (const item of run.items) {
    const hnText = item.channels?.social?.hn?.text || "";
    hnLines.push(hnText || item.slug);
    hnLines.push("", `${siteBase}/tools/${item.slug}/`, "");
  }
  writeFileSync(join(kitDir, "post-hn.md"), hnLines.join("\n"), "utf8");

  // ── changelog.md ───────────────────────────────────────
  const clLines = [`# Spotlight Changelog — ${dateStr}`, "", "## Tools", ""];
  for (const item of run.items) {
    const ov = overrides[item.slug] || {};
    clLines.push(`- **${item.slug}** — ${ov.tagline || "No tagline"}`);
  }
  clLines.push("", "## Links", "");
  clLines.push(`- [This week's spotlight](${siteBase}/now/)`);
  clLines.push(`- [Full catalog](${siteBase}/tools/)`);
  clLines.push("");
  writeFileSync(join(kitDir, "changelog.md"), clLines.join("\n"), "utf8");

  // ── proof.md ───────────────────────────────────────────
  const prLines = [`# Verification — ${dateStr}`, ""];
  prLines.push(`- Trust receipt: ${siteBase}/trust.json`);
  prLines.push(`- Spotlight page: ${siteBase}/promo/${dateStr}/`);
  prLines.push(`- Receipts index: ${siteBase}/receipts/`);
  prLines.push(`- How to verify: ${siteBase}/trust/#verify`);
  prLines.push("");
  writeFileSync(join(kitDir, "proof.md"), prLines.join("\n"), "utf8");

  console.log(`  Wrote spotlight kit to ${kitDir}`);
}

/**
 * Full pipeline: load data, build run, write output files.
 *
 * @param {{ dataDir?: string, outDir?: string, dryRun?: boolean, siteBase?: string, maxItems?: number }} opts
 * @returns {object|null} Outreach run result, or null if disabled/empty
 */
export function generateOutreachRun(opts = {}) {
  const dataDir = opts.dataDir || DATA_DIR;
  const outDir = opts.outDir || join(ROOT, "site", "public", "outreach-run");
  const dryRun = opts.dryRun || false;

  // 1. Load promo.json and promo-queue.json
  const promo = safeParseJson(join(dataDir, "promo.json"), { enabled: false });
  const queue = safeParseJson(join(dataDir, "promo-queue.json"), { week: "", slugs: [], promotionType: "own", notes: "" });

  // 2. Build the outreach run
  const result = buildOutreachRun(queue, promo, {
    siteBase: opts.siteBase,
    maxItems: opts.maxItems,
    overrides: safeParseJson(join(dataDir, "overrides.json"), {}),
    worthy: safeParseJson(join(dataDir, "worthy.json"), {}),
    marketirDir: join(dataDir, "marketir"),
  });

  // 3. Check result
  if (result === null) {
    console.log("  Promotion disabled (promo.json enabled !== true).");
    return null;
  }

  if (result.itemCount === 0) {
    console.log("  No valid items after filtering.");
    return result;
  }

  // 4. Determine date directory
  const dateStr = new Date().toISOString().split("T")[0];
  const dateDir = join(outDir, dateStr);

  // 5. Write outputs
  if (dryRun) {
    console.log(`  [dry-run] Would create directory: ${dateDir}`);
    console.log(`  [dry-run] Would write: ${join(dateDir, "outreach-run.json")}`);
    console.log(`  [dry-run] Would write: ${join(dateDir, "outreach-run.md")}`);
    console.log(`  [dry-run] Would write spotlight kit to docs/spotlight/${dateStr}`);
  } else {
    mkdirSync(dateDir, { recursive: true });

    writeFileSync(
      join(dateDir, "outreach-run.json"),
      JSON.stringify(result, null, 2) + "\n",
      "utf8"
    );
    console.log(`  Wrote ${join(dateDir, "outreach-run.json")}`);

    const md = renderMarkdown(result);
    writeFileSync(join(dateDir, "outreach-run.md"), md, "utf8");
    console.log(`  Wrote ${join(dateDir, "outreach-run.md")}`);

    // Generate promo-week receipt
    try {
      const receipt = buildPromoWeekReceipt({
        dataDir: DATA_DIR,
        publicDir: join(ROOT, "site", "public"),
        week: dateStr,
      });
      writeFileSync(
        join(dateDir, "promo-week-receipt.json"),
        JSON.stringify(receipt, null, 2) + "\n",
        "utf8"
      );
      console.log(`  Wrote ${join(dateDir, "promo-week-receipt.json")}`);
    } catch (err) {
      console.warn(`  [warn] Receipt generation failed: ${err.message}`);
    }

    // Generate Spotlight Kit
    try {
      writeSpotlightKit(result, dateStr, {
        root: ROOT,
        overrides: safeParseJson(join(dataDir, "overrides.json"), {}),
        siteBase: opts.siteBase,
      });
    } catch (err) {
      console.warn(`  [warn] Spotlight kit generation failed: ${err.message}`);
    }
  }

  // Log warnings
  for (const w of result.warnings) {
    console.log(`  [warn] ${w}`);
  }

  return result;
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-outreach-run.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating outreach run...");
  if (dryRun) console.log("  Mode: DRY RUN");
  const result = generateOutreachRun({ dryRun });
  if (!result) {
    console.log("  No outreach run generated (promotion disabled or no items).");
  } else {
    console.log(`  Items: ${result.itemCount}`);
    console.log(`  Warnings: ${result.warnings.length}`);
  }
}

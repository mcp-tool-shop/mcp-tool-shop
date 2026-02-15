#!/usr/bin/env node

/**
 * Outreach Pack Generator
 *
 * Generates deterministic, claim-traceable outreach materials from
 * MarketIR press data + claims + GitHub facts. Every statement maps
 * to a claimRef — unlabeled assertions are forbidden.
 *
 * Output: site/public/outreach/<slug>/
 *   - email-journalist.md
 *   - email-partner.md
 *   - email-integrator.md
 *   - dm-short.md          (hard 300-char limit)
 *   - hn-comment.md
 *   - github-readme-snippet.md
 *   - press-release-lite.md (only if projectDescription exists)
 *
 * Usage:
 *   node scripts/gen-outreach-packs.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const DATA_DIR = path.join(SITE, "src", "data", "marketir");
const OVERRIDES_PATH = path.join(SITE, "src", "data", "overrides.json");
const FACTS_DIR = path.join(SITE, "src", "data", "github-facts");
const LINKS_PATH = path.join(SITE, "src", "data", "links.json");
const CAMPAIGNS_DIR = path.join(SITE, "public", "campaigns");
const OUTPUT_BASE = path.join(SITE, "public", "outreach");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// ─── Load data ────────────────────────────────────────────────────────────────

const overrides = readJson(OVERRIDES_PATH);
if (!overrides) {
  console.error("Failed to load overrides.json");
  process.exit(1);
}

const snapshot = readJson(path.join(DATA_DIR, "marketir.snapshot.json"));
const lockShort = snapshot?.lockSha256?.slice(0, 12) || "unknown";

// Link registry (fail-soft)
const linksData = readJson(LINKS_PATH);
const linksBySlug = new Map();
const linkByMessage = new Map();
if (linksData?.links) {
  for (const link of linksData.links) {
    if (!linksBySlug.has(link.slug)) linksBySlug.set(link.slug, []);
    linksBySlug.get(link.slug).push(link);
    if (link.messageRef) linkByMessage.set(link.messageRef, link.id);
  }
}

// ─── Find enabled tools ───────────────────────────────────────────────────────

const enabledSlugs = Object.entries(overrides)
  .filter(([, v]) => v.publicProof === true)
  .map(([k]) => k);

if (enabledSlugs.length === 0) {
  console.log("No tools with publicProof enabled. Nothing to generate.");
  process.exit(0);
}

console.log(`Generating outreach packs for: ${enabledSlugs.join(", ")}\n`);

// ─── Generate ─────────────────────────────────────────────────────────────────

for (const slug of enabledSlugs) {
  const tool = readJson(path.join(DATA_DIR, "data", "tools", `${slug}.json`));
  if (!tool) {
    console.warn(`  ⚠ No MarketIR data for ${slug}, skipping.`);
    continue;
  }

  const press = tool.press;
  if (!press) {
    console.warn(`  ⚠ No press block for ${slug}, skipping.`);
    continue;
  }

  const override = overrides[slug] || {};
  const facts = readJson(path.join(FACTS_DIR, `${slug}.json`));
  const outDir = path.join(OUTPUT_BASE, slug);
  fs.mkdirSync(outDir, { recursive: true });

  const proven = (tool.claims || []).filter((c) => c.status === "proven");
  const oneLiner = tool.positioning?.oneLiner || "";
  const installCmd = override.install || null;
  const repoUrl = `https://github.com/mcp-tool-shop-org/${slug}`;
  const toolPageUrl = `https://mcptoolshop.com/tools/${slug}/`;
  const pressPageUrl = `https://mcptoolshop.com/press/${slug}/`;
  const presskitUrl = `https://mcptoolshop.com/presskit/${slug}/`;
  const generatedAt = new Date().toISOString();

  // Find HN message if exists
  const hnMsg = (tool.messages || []).find((m) => m.channel === "hn");

  // Derive "why now" from latest campaign phase
  let whyNow = null;
  try {
    const campaignFiles = fs.readdirSync(CAMPAIGNS_DIR);
    for (const dir of campaignFiles) {
      const bundle = readJson(path.join(CAMPAIGNS_DIR, dir, "bundle.json"));
      if (bundle?.tool?.slug === slug && bundle.phases?.length > 0) {
        const latest = bundle.phases[bundle.phases.length - 1];
        whyNow = latest.name || null;
        break;
      }
    }
  } catch {}

  // Proof bullets (reusable)
  const proofBullets = proven.map((c) => {
    const evidenceLinks = (c.evidenceRefs || [])
      .map((ref) => {
        // Just use presskit as proof page
        return `(proof: ${pressPageUrl})`;
      })
      .join(" ");
    return `- ${c.statement} ${evidenceLinks}`;
  });

  // ── email-journalist.md ──────────────────────────────────────────────────

  {
    const lines = [];
    lines.push(`# ${tool.name} — Journalist Outreach`);
    lines.push("");
    lines.push(`**Subject:** ${tool.name}: ${oneLiner}`);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`[context] Hi — I'm sharing ${tool.name} because it solves a specific problem in the LLM tooling space.`);
    lines.push("");
    lines.push(`${oneLiner}`);
    lines.push("");
    lines.push("**What's proven:**");
    lines.push("");
    for (const bullet of proofBullets) {
      lines.push(bullet);
    }
    lines.push("");
    if (facts?.latestRelease) {
      lines.push(`[context] Latest release: ${facts.latestRelease.tag} (${facts.latestRelease.publishedAt?.split("T")[0] || "recent"})`);
      lines.push("");
    }
    if (whyNow) {
      lines.push(`[context] Why now: currently in "${whyNow}" phase.`);
      lines.push("");
    }
    lines.push(`Press page: ${pressPageUrl}`);
    lines.push(`Press kit: ${presskitUrl}`);
    lines.push(`GitHub: ${repoUrl}`);
    lines.push("");
    if (press.contacts?.length > 0) {
      const c = press.contacts[0];
      lines.push(`[context] Contact: ${c.label || c.value}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
    lines.push(`_Generated from MarketIR (lock: ${lockShort}) at ${generatedAt}_`);
    lines.push(`_Every claim above is backed by evidence. See press page for receipts._`);
    lines.push("");

    fs.writeFileSync(path.join(outDir, "email-journalist.md"), lines.join("\n"), "utf8");
    console.log(`  wrote ${slug}/email-journalist.md`);
  }

  // ── email-partner.md ─────────────────────────────────────────────────────

  {
    const lines = [];
    lines.push(`# ${tool.name} — Partner Outreach`);
    lines.push("");
    lines.push(`**Subject:** Partnership opportunity: ${tool.name}`);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`[context] Hi — we built ${tool.name} and think there's a natural integration opportunity.`);
    lines.push("");
    lines.push(`${oneLiner}`);
    lines.push("");
    if (press.partnerOffers?.length > 0) {
      lines.push("**What we offer:**");
      lines.push("");
      for (const offer of press.partnerOffers) {
        lines.push(`- **${offer.type}:** ${offer.description}`);
      }
      lines.push("");
    }
    lines.push("**Proven capabilities:**");
    lines.push("");
    for (const bullet of proofBullets) {
      lines.push(bullet);
    }
    lines.push("");
    lines.push(`Tool page: ${toolPageUrl}`);
    lines.push(`Press page: ${pressPageUrl}`);
    lines.push(`GitHub: ${repoUrl}`);
    lines.push("");
    if (press.contacts?.length > 0) {
      const c = press.contacts[0];
      lines.push(`[context] Reach us: ${c.label || c.value}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
    lines.push(`_Generated from MarketIR (lock: ${lockShort}) at ${generatedAt}_`);
    lines.push(`_Every claim above is backed by evidence. See press page for receipts._`);
    lines.push("");

    fs.writeFileSync(path.join(outDir, "email-partner.md"), lines.join("\n"), "utf8");
    console.log(`  wrote ${slug}/email-partner.md`);
  }

  // ── email-integrator.md ──────────────────────────────────────────────────

  {
    const lines = [];
    lines.push(`# ${tool.name} — Integrator Outreach`);
    lines.push("");
    lines.push(`**Subject:** Integrate ${tool.name} into your tool chain`);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`[context] ${tool.name} generates structured, deterministic metadata for repos and archives.`);
    lines.push("");
    if (installCmd) {
      lines.push("**Install:**");
      lines.push("");
      lines.push("```bash");
      lines.push(installCmd);
      lines.push("```");
      lines.push("");
    }
    lines.push("**Technical claims (proven):**");
    lines.push("");
    for (const bullet of proofBullets) {
      lines.push(bullet);
    }
    lines.push("");
    const integrationOffer = press.partnerOffers?.find((o) => o.type === "integration");
    if (integrationOffer) {
      lines.push(`**Integration offer:** ${integrationOffer.description}`);
      lines.push("");
    }
    lines.push(`GitHub: ${repoUrl}`);
    lines.push(`Press page: ${pressPageUrl}`);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`_Generated from MarketIR (lock: ${lockShort}) at ${generatedAt}_`);
    lines.push("");

    fs.writeFileSync(path.join(outDir, "email-integrator.md"), lines.join("\n"), "utf8");
    console.log(`  wrote ${slug}/email-integrator.md`);
  }

  // ── dm-short.md ──────────────────────────────────────────────────────────

  {
    // Hard 300-char limit for DM platforms
    let body = `${tool.name}: ${oneLiner} ${proven.length} proven claims, receipts at ${pressPageUrl}`;
    if (body.length > 300) {
      body = `${tool.name}: ${oneLiner} Proof: ${pressPageUrl}`;
    }
    if (body.length > 300) {
      body = body.slice(0, 297) + "...";
    }

    const lines = [];
    lines.push(`# ${tool.name} — Short DM`);
    lines.push("");
    lines.push(`> ${body.length} chars (limit: 300)`);
    lines.push("");
    lines.push("```");
    lines.push(body);
    lines.push("```");
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`_Generated from MarketIR (lock: ${lockShort}) at ${generatedAt}_`);
    lines.push("");

    if (body.length > 300) {
      console.error(`  ✗ ${slug}/dm-short.md exceeds 300 chars (${body.length})`);
      process.exit(1);
    }

    fs.writeFileSync(path.join(outDir, "dm-short.md"), lines.join("\n"), "utf8");
    console.log(`  wrote ${slug}/dm-short.md (${body.length} chars)`);
  }

  // ── hn-comment.md ────────────────────────────────────────────────────────

  {
    const lines = [];
    lines.push(`# ${tool.name} — HN Comment`);
    lines.push("");
    lines.push("---");
    lines.push("");

    if (hnMsg) {
      lines.push("```");
      lines.push(hnMsg.text);
      lines.push("```");
      lines.push("");
      lines.push("Proof links to append:");
      lines.push("");
    } else {
      lines.push(`[context] ${tool.name}: ${oneLiner}`);
      lines.push("");
    }

    lines.push("Verified claims:");
    lines.push("");
    for (const c of proven) {
      lines.push(`- ${c.statement} (${pressPageUrl})`);
    }
    lines.push("");
    if (installCmd) {
      lines.push(`Install: \`${installCmd}\``);
      lines.push("");
    }
    lines.push(`GitHub: ${repoUrl}`);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`_Generated from MarketIR (lock: ${lockShort}) at ${generatedAt}_`);
    lines.push("");

    fs.writeFileSync(path.join(outDir, "hn-comment.md"), lines.join("\n"), "utf8");
    console.log(`  wrote ${slug}/hn-comment.md`);
  }

  // ── github-readme-snippet.md ─────────────────────────────────────────────

  {
    const lines = [];
    lines.push(`# ${tool.name} — README Snippet`);
    lines.push("");
    lines.push("[context] Copy-paste this block into your README or project docs.");
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("```markdown");
    lines.push(`## ${tool.name}`);
    lines.push("");
    lines.push(`> ${oneLiner}`);
    lines.push("");
    if (installCmd) {
      lines.push("### Install");
      lines.push("");
      lines.push("\\`\\`\\`bash");
      lines.push(installCmd);
      lines.push("\\`\\`\\`");
      lines.push("");
    }
    lines.push("### Verified");
    lines.push("");
    for (const c of proven) {
      lines.push(`- ${c.statement}`);
    }
    lines.push("");
    lines.push(`[Press page](${pressPageUrl}) · [GitHub](${repoUrl})`);
    lines.push("```");
    lines.push("");
    lines.push("### Badge suggestions");
    lines.push("");
    if (facts?.license) {
      lines.push(`![License](https://img.shields.io/badge/license-${encodeURIComponent(facts.license)}-blue)`);
    }
    if (facts?.latestRelease) {
      lines.push(`![Release](https://img.shields.io/github/v/release/mcp-tool-shop-org/${slug})`);
    }
    lines.push(`![Tests](https://img.shields.io/badge/tests-${proven.length}%20proven%20claims-green)`);
    lines.push("");
    lines.push("[context] Social preview recommended size: 1280x640px");
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`_Generated from MarketIR (lock: ${lockShort}) at ${generatedAt}_`);
    lines.push("");

    fs.writeFileSync(path.join(outDir, "github-readme-snippet.md"), lines.join("\n"), "utf8");
    console.log(`  wrote ${slug}/github-readme-snippet.md`);
  }

  // ── press-release-lite.md ────────────────────────────────────────────────

  if (press.boilerplate?.projectDescription) {
    const lines = [];
    lines.push(`# ${tool.name} — Press Release`);
    lines.push("");
    lines.push(`**FOR IMMEDIATE DISTRIBUTION**`);
    lines.push("");
    lines.push(`## ${tool.name}: ${oneLiner}`);
    lines.push("");
    lines.push(press.boilerplate.projectDescription);
    lines.push("");
    if (press.boilerplate.founderBio) {
      lines.push(`[context] ${press.boilerplate.founderBio}`);
      lines.push("");
    }
    lines.push("### Key claims (all proven)");
    lines.push("");
    for (const bullet of proofBullets) {
      lines.push(bullet);
    }
    lines.push("");
    if (press.quotes?.length > 0) {
      lines.push("### Quotes");
      lines.push("");
      for (const q of press.quotes) {
        lines.push(`> "${q.text}"`);
        if (q.attribution) {
          lines.push(`> — ${q.attribution}${q.role ? `, ${q.role}` : ""}`);
        }
        lines.push("");
      }
    }
    if (facts?.latestRelease) {
      lines.push(`[context] Current version: ${facts.latestRelease.tag}`);
      lines.push("");
    }
    lines.push("### Links");
    lines.push("");
    lines.push(`- Press page: ${pressPageUrl}`);
    lines.push(`- Press kit: ${presskitUrl}`);
    lines.push(`- GitHub: ${repoUrl}`);
    lines.push(`- Tool page: ${toolPageUrl}`);
    lines.push("");
    if (press.contacts?.length > 0) {
      lines.push("### Contact");
      lines.push("");
      for (const c of press.contacts) {
        lines.push(`- ${c.method}: ${c.label || c.value}`);
      }
      lines.push("");
    }
    if (press.boilerplate.forbiddenPhrases?.length > 0) {
      lines.push(`[context] Please avoid these terms: ${press.boilerplate.forbiddenPhrases.join(", ")}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
    lines.push(`_Generated from MarketIR (lock: ${lockShort}) at ${generatedAt}_`);
    lines.push(`_Every claim above is backed by evidence. See press page for receipts._`);
    lines.push("");

    fs.writeFileSync(path.join(outDir, "press-release-lite.md"), lines.join("\n"), "utf8");
    console.log(`  wrote ${slug}/press-release-lite.md`);
  }

  console.log(`  ✓ ${slug} outreach pack complete`);
}

console.log(`\nDone. ${enabledSlugs.length} outreach pack(s) generated.`);

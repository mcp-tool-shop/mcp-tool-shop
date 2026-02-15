#!/usr/bin/env node

/**
 * Snippet Compiler
 *
 * Generates channel-ready copy from MarketIR messages + claims.
 * One markdown file per tool that has publicProof: true in overrides.json.
 *
 * Output: site/public/snippets/<slug>.md
 *
 * Every line traces back to claimRefs — no freeform assertions.
 *
 * Usage:
 *   node scripts/gen-snippets.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const DATA_DIR = path.join(SITE, "src", "data", "marketir");
const OVERRIDES_PATH = path.join(SITE, "src", "data", "overrides.json");
const LINKS_PATH = path.join(SITE, "src", "data", "links.json");
const OUTPUT_DIR = path.join(SITE, "public", "snippets");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

const CHANNEL_LABELS = {
  web: "Web blurb",
  readme: "README insert",
  hn: "Hacker News post",
  x: "X (Twitter) post",
  linkedin: "LinkedIn post",
  newsletter: "Newsletter",
  presskit: "Press kit",
};

// ─── Load data ────────────────────────────────────────────────────────────────

const overrides = readJson(OVERRIDES_PATH);
if (!overrides) {
  console.error("Failed to load overrides.json");
  process.exit(1);
}

const snapshot = readJson(path.join(DATA_DIR, "marketir.snapshot.json"));
const lockShort = snapshot?.lockSha256?.slice(0, 12) || "unknown";

// Load link registry for source markers (fail-soft)
const linksData = readJson(LINKS_PATH);
const linkByMessage = new Map();
if (linksData?.links) {
  for (const link of linksData.links) {
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

console.log(`Generating snippets for: ${enabledSlugs.join(", ")}\n`);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Generate ─────────────────────────────────────────────────────────────────

for (const slug of enabledSlugs) {
  const tool = readJson(path.join(DATA_DIR, "data", "tools", `${slug}.json`));
  if (!tool) {
    console.warn(`  ⚠ No MarketIR data for ${slug}, skipping.`);
    continue;
  }

  const proven = (tool.claims || []).filter((c) => c.status === "proven");
  const messages = tool.messages || [];

  const lines = [];
  lines.push(`# ${tool.name} — Channel Snippets`);
  lines.push("");
  lines.push(`> ${tool.positioning?.oneLiner || ""}`);
  lines.push("");

  // Channel-grouped messages
  const byChannel = new Map();
  for (const msg of messages) {
    if (!byChannel.has(msg.channel)) byChannel.set(msg.channel, []);
    byChannel.get(msg.channel).push(msg);
  }

  for (const [channel, msgs] of byChannel) {
    const label = CHANNEL_LABELS[channel] || channel;
    lines.push(`## ${label}`);
    lines.push("");

    for (const msg of msgs) {
      const goId = linkByMessage.get(msg.id);
      lines.push("```");
      lines.push(msg.text);
      if (goId) {
        lines.push("");
        lines.push(`Source: mcptoolshop.com/go/${goId}`);
      }
      lines.push("```");
      lines.push("");

      // Constraints
      if (msg.constraints) {
        const parts = [];
        if (msg.constraints.maxChars) parts.push(`max ${msg.constraints.maxChars} chars (${msg.text.length} used)`);
        if (msg.constraints.notes) parts.push(msg.constraints.notes);
        if (parts.length > 0) {
          lines.push(`_${parts.join(" | ")}_`);
          lines.push("");
        }
      }

      // Claim traceability
      if (msg.claimRefs?.length > 0) {
        lines.push("Claims referenced:");
        for (const ref of msg.claimRefs) {
          const claim = (tool.claims || []).find((c) => c.id === ref);
          if (claim) {
            const status = claim.status === "proven" ? "proven" : claim.status;
            lines.push(`- \`${ref}\` (${status}): ${claim.statement}`);
          } else {
            lines.push(`- \`${ref}\` (unresolved)`);
          }
        }
        lines.push("");
      }
    }
  }

  // Proof bullets section
  if (proven.length > 0) {
    lines.push("## Proof bullets (proven claims only)");
    lines.push("");
    lines.push("Copy-paste these wherever you need verifiable one-liners:");
    lines.push("");
    for (const claim of proven) {
      lines.push(`- ${claim.statement}`);
    }
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(`_Generated from [MarketIR](https://github.com/mcp-tool-shop/mcpt-marketing) (lock: ${lockShort}) at ${new Date().toISOString()}_`);
  lines.push("");

  const text = lines.join("\n");
  const outPath = path.join(OUTPUT_DIR, `${slug}.md`);
  fs.writeFileSync(outPath, text, "utf8");
  console.log(`  wrote snippets/${slug}.md (${text.length} bytes)`);
}

console.log(`\nDone. ${enabledSlugs.length} snippet file(s) generated.`);

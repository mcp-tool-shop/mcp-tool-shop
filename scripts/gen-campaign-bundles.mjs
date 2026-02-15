#!/usr/bin/env node

/**
 * Campaign Bundle Generator
 *
 * Produces self-contained campaign bundles from MarketIR campaign data.
 * Each bundle resolves messages, claims, audiences, and GitHub facts
 * into a single deployable package.
 *
 * Output: site/public/campaigns/<campaign-id>/
 *   - bundle.json   (machine-readable, fully resolved)
 *   - README.md     (human-readable execution guide)
 *
 * Usage:
 *   node scripts/gen-campaign-bundles.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const DATA_DIR = path.join(SITE, "src", "data", "marketir");
const FACTS_DIR = path.join(SITE, "src", "data", "github-facts");
const OUTPUT_BASE = path.join(SITE, "public", "campaigns");

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

const index = readJson(path.join(DATA_DIR, "data", "marketing.index.json"));
if (!index) {
  console.log("No marketing.index.json found. Nothing to generate.");
  process.exit(0);
}

const snapshot = readJson(path.join(DATA_DIR, "marketir.snapshot.json"));
const lockShort = snapshot?.lockSha256?.slice(0, 12) || "unknown";

const campaigns = (index.campaigns || [])
  .map((c) => readJson(path.join(DATA_DIR, "data", c.ref)))
  .filter(Boolean);

if (campaigns.length === 0) {
  console.log("No campaigns found. Nothing to generate.");
  process.exit(0);
}

console.log(`Generating campaign bundles for: ${campaigns.map((c) => c.id).join(", ")}\n`);

// ─── Resolve helpers ─────────────────────────────────────────────────────────

function loadTool(toolRef) {
  // toolRef is like "tool.zip-meta-map" — extract slug
  const slug = toolRef.replace(/^tool\./, "");
  return { slug, data: readJson(path.join(DATA_DIR, "data", "tools", `${slug}.json`)) };
}

function loadAudience(audRef) {
  // audRef is like "aud.ci-maintainers" — extract filename
  const name = audRef.replace(/^aud\./, "");
  return readJson(path.join(DATA_DIR, "data", "audiences", `${name}.json`));
}

// ─── Generate ─────────────────────────────────────────────────────────────────

for (const campaign of campaigns) {
  const { slug, data: tool } = loadTool(campaign.toolRef);
  if (!tool) {
    console.warn(`  ⚠ No tool data for ${campaign.toolRef}, skipping campaign ${campaign.id}.`);
    continue;
  }

  const facts = readJson(path.join(FACTS_DIR, `${slug}.json`));

  // Build claim lookup
  const claimMap = new Map();
  for (const claim of tool.claims || []) {
    claimMap.set(claim.id, claim);
  }

  // Build message lookup
  const msgMap = new Map();
  for (const msg of tool.messages || []) {
    msgMap.set(msg.id, msg);
  }

  // Resolve audiences
  const audiences = (campaign.audienceRefs || [])
    .map((ref) => loadAudience(ref))
    .filter(Boolean);

  // Resolve phases with messages and claims
  const resolvedPhases = (campaign.phases || []).map((phase) => {
    const messages = (phase.messageRefs || []).map((ref) => {
      const msg = msgMap.get(ref);
      if (!msg) return { id: ref, resolved: false };

      const claims = (msg.claimRefs || []).map((cRef) => {
        const claim = claimMap.get(cRef);
        return claim
          ? { id: claim.id, status: claim.status, statement: claim.statement }
          : { id: cRef, status: "unresolved", statement: null };
      });

      return {
        id: msg.id,
        resolved: true,
        channel: msg.channel,
        tone: msg.tone,
        text: msg.text,
        constraints: msg.constraints || null,
        claims,
      };
    });

    return {
      name: phase.name,
      channels: phase.channels,
      notes: phase.notes || null,
      messages,
    };
  });

  const generatedAt = new Date().toISOString();

  // ── Campaign output directory ────────────────────────────────────────────

  // Use campaign slug (e.g. "zmm-launch" from "camp.zip-meta-map.launch" → file was zmm-launch.json)
  const campaignSlug = campaign.id.replace(/^camp\./, "").replace(/\./g, "-");
  const outDir = path.join(OUTPUT_BASE, campaignSlug);
  fs.mkdirSync(outDir, { recursive: true });

  // ── bundle.json ──────────────────────────────────────────────────────────

  const bundle = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    tool: {
      slug,
      name: tool.name,
      tagline: tool.positioning?.oneLiner || "",
    },
    audiences: audiences.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      painPoints: a.painPoints || [],
    })),
    phases: resolvedPhases,
    githubFacts: facts
      ? {
          stars: facts.stars,
          forks: facts.forks,
          latestRelease: facts.latestRelease || null,
          license: facts.license,
          releasesLast90d: facts.releasesLast90d,
          communityHealth: facts.communityHealth || null,
          observedAt: facts.fetchedAt,
        }
      : null,
    generatedAt,
    sourcelock: lockShort,
  };

  const bundleText = JSON.stringify(bundle, null, 2) + "\n";
  fs.writeFileSync(path.join(outDir, "bundle.json"), bundleText, "utf8");
  console.log(`  wrote ${campaignSlug}/bundle.json`);

  // ── README.md ────────────────────────────────────────────────────────────

  const lines = [];
  lines.push(`# Campaign: ${campaign.name}`);
  lines.push("");
  lines.push(`**Tool:** ${tool.name} — ${tool.positioning?.oneLiner || ""}`);
  lines.push("");

  // Audiences
  if (audiences.length > 0) {
    lines.push("## Target audiences");
    lines.push("");
    for (const aud of audiences) {
      lines.push(`### ${aud.name}`);
      lines.push("");
      lines.push(aud.description);
      lines.push("");
      if (aud.painPoints?.length > 0) {
        lines.push("Pain points:");
        for (const pp of aud.painPoints) {
          lines.push(`- ${pp}`);
        }
        lines.push("");
      }
    }
  }

  // GitHub facts summary
  if (facts) {
    lines.push("## GitHub snapshot");
    lines.push("");
    if (facts.latestRelease) {
      lines.push(`- **Latest release:** ${facts.latestRelease.tag} (${facts.latestRelease.publishedAt?.split("T")[0] || "n/a"})`);
    }
    lines.push(`- **Stars:** ${facts.stars} | **Forks:** ${facts.forks} | **License:** ${facts.license || "unknown"}`);
    lines.push(`- **Releases (last 90d):** ${facts.releasesLast90d}`);
    lines.push(`- _Observed at: ${facts.fetchedAt}_`);
    lines.push("");
  }

  // Phases
  lines.push("## Execution phases");
  lines.push("");

  for (let i = 0; i < resolvedPhases.length; i++) {
    const phase = resolvedPhases[i];
    lines.push(`### Phase ${i + 1}: ${phase.name}`);
    lines.push("");
    lines.push(`**Channels:** ${phase.channels.join(", ")}`);
    if (phase.notes) lines.push(`**Notes:** ${phase.notes}`);
    lines.push("");

    for (const msg of phase.messages) {
      if (!msg.resolved) {
        lines.push(`- _Unresolved message: \`${msg.id}\`_`);
        lines.push("");
        continue;
      }

      const label = CHANNEL_LABELS[msg.channel] || msg.channel;
      lines.push(`#### ${label}`);
      lines.push("");
      lines.push("```");
      lines.push(msg.text);
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

      // Claims backing this message
      if (msg.claims?.length > 0) {
        lines.push("Claims backing this message:");
        for (const c of msg.claims) {
          if (c.statement) {
            lines.push(`- \`${c.id}\` (${c.status}): ${c.statement}`);
          } else {
            lines.push(`- \`${c.id}\` (unresolved)`);
          }
        }
        lines.push("");
      }
    }
  }

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(`_Generated from MarketIR${facts ? " + GitHub facts" : ""} (lock: ${lockShort}) at ${generatedAt}_`);
  if (facts) {
    lines.push("");
    lines.push("_GitHub data is non-authoritative and time-stamped. Verify at source._");
  }
  lines.push("");

  const readmeText = lines.join("\n");
  fs.writeFileSync(path.join(outDir, "README.md"), readmeText, "utf8");
  console.log(`  wrote ${campaignSlug}/README.md`);
}

console.log(`\nDone. ${campaigns.length} campaign bundle(s) generated.`);

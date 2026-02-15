#!/usr/bin/env node

/**
 * Draft Overrides Generator
 *
 * Selects repos that are missing or incomplete in overrides.json,
 * infers metadata heuristically, and writes draft entries with
 * needsHumanReview: true.
 *
 * Inputs:
 *   site/src/data/projects.json
 *   site/src/data/releases.json
 *   site/src/data/overrides.json
 *   site/src/data/automation.ignore.json
 *
 * Usage:
 *   node scripts/draft-overrides.mjs            # default batch of 5
 *   node scripts/draft-overrides.mjs --dry-run  # preview without writing
 *   ENRICHMENT_BATCH_SIZE=3 node scripts/draft-overrides.mjs
 */

import fs from "node:fs";
import path from "node:path";

// ─── Config ──────────────────────────────────────────────────────────────────

const BATCH_SIZE = Math.min(
  parseInt(process.env.ENRICHMENT_BATCH_SIZE || "5", 10),
  10 // hard cap per automation contract
);

const DRY_RUN = process.argv.includes("--dry-run");

const REPO_ROOT = process.cwd();
const DATA_DIR = path.join(REPO_ROOT, "site", "src", "data");

const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");
const RELEASES_PATH = path.join(DATA_DIR, "releases.json");
const OVERRIDES_PATH = path.join(DATA_DIR, "overrides.json");
const IGNORE_PATH = path.join(DATA_DIR, "automation.ignore.json");

// Key fields that make an override "complete"
const REQUIRED_FIELDS = ["stability", "kind", "tagline"];

// ─── Schema enums from docs/automation.md ────────────────────────────────────

const VALID_KINDS = new Set([
  "mcp-server",
  "cli",
  "library",
  "plugin",
  "desktop-app",
  "vscode-extension",
  "homebrew-tap",
  "template",
  "meta",
]);

const VALID_STABILITY = new Set(["stable", "beta", "experimental"]);

const VALID_CATEGORIES = new Set([
  "mcp-core",
  "voice",
  "security",
  "ml",
  "infrastructure",
  "desktop",
  "devtools",
  "web",
  "games",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/**
 * Parse a semver-ish tag into { major, minor, patch } or null.
 * Handles v1.0.0, 1.0.0, v0.2.0-rc.1, etc.
 */
function parseSemver(tag) {
  if (!tag) return null;
  const m = tag.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
  };
}

// ─── Kind inference ──────────────────────────────────────────────────────────

function inferKind(project) {
  const name = (project.repo || "").toLowerCase();
  const desc = (project.description || "").toLowerCase();
  const lang = (project.language || "").toLowerCase();
  const tags = (project.tags || []).map((t) => t.toLowerCase());
  const all = [name, desc, ...tags].join(" ");

  // VS Code extensions
  if (name.includes("vscode") || name.includes("vs-code") || all.includes("vs code extension"))
    return "vscode-extension";

  // Desktop apps (MAUI, WinUI, Electron, Desktop)
  if (
    name.includes("desktop") ||
    all.includes("maui") ||
    all.includes("winui") ||
    all.includes("electron")
  )
    return "desktop-app";

  // MCP servers
  if (
    (all.includes("mcp") && all.includes("server")) ||
    name.startsWith("mcp-") && !name.includes("cli") && !name.includes("stress") && !name.includes("examples")
  )
    return "mcp-server";

  // Homebrew taps
  if (name.includes("homebrew")) return "homebrew-tap";

  // Plugins
  if (all.includes("plugin")) return "plugin";

  // CLIs — explicit markers
  if (
    all.includes("cli") ||
    all.includes("command-line") ||
    all.includes("command line")
  )
    return "cli";

  // Templates / examples / demos
  if (
    name.includes("demo") ||
    name.includes("example") ||
    name.includes("template") ||
    all.includes("reference integration")
  )
    return "template";

  // Meta / infrastructure
  if (name === ".github" || all.includes("registry") || all.includes("profile"))
    return "meta";

  // Scanner / testing tools are usually CLIs
  if (all.includes("scan") || all.includes("stress") || all.includes("audit"))
    return "cli";

  // Default: library for importable packages, cli for everything else
  if (lang === "python" || lang === "typescript" || lang === "javascript")
    return "library";

  // C# — check if it looks like a library/suite vs desktop app
  if (lang === "c#") {
    if (name.includes("suite") || name.includes("engine") || name.includes("ledger"))
      return "library";
    return "desktop-app";
  }

  return "library"; // safe default
}

// ─── Category inference ──────────────────────────────────────────────────────

function inferCategory(project, kind) {
  const name = (project.repo || "").toLowerCase();
  const desc = (project.description || "").toLowerCase();
  const tags = (project.tags || []).map((t) => t.toLowerCase());
  const all = [name, desc, ...tags].join(" ");

  // Voice / TTS / audio
  if (all.includes("voice") || all.includes("tts") || all.includes("audio") || all.includes("soundboard"))
    return "voice";

  // Infrastructure / governance / ledgers (check before security/ML to avoid false positives)
  if (
    all.includes("governance") ||
    all.includes("ledger") ||
    all.includes("provenance") ||
    all.includes("consensus") ||
    all.includes("attestia") ||
    all.includes("registr")
  )
    return "infrastructure";

  // Security / testing / scanning
  if (all.includes("security") || all.includes("scan") || all.includes("stress") || all.includes("audit"))
    return "security";

  // ML / training / fine-tuning (use word boundary for "ml" to avoid false positives like "claimledger")
  if (
    all.includes("training") ||
    all.includes("fine-tun") ||
    /\bml\b/.test(all) ||
    all.includes("model") ||
    all.includes("tensor") ||
    all.includes("scalar") ||
    all.includes("vector")
  )
    return "ml";

  // Web / browser (check before MCP so websketch-mcp gets "web" not "mcp-core")
  if (all.includes("websketch") || all.includes("browser") || all.includes("chrome"))
    return "web";

  // MCP core
  if (all.includes("mcp")) return "mcp-core";

  // Games / training sims
  if (
    all.includes("game") ||
    all.includes("mouse") ||
    all.includes("trainer") ||
    all.includes("typer") ||
    all.includes("typing") ||
    all.includes("cursor") && all.includes("control")
  )
    return "games";

  // Desktop apps
  if (kind === "desktop-app") return "desktop";

  // VS Code extensions
  if (kind === "vscode-extension") return "devtools";

  // Devtools fallback
  if (
    all.includes("build") ||
    all.includes("coverage") ||
    all.includes("batch") ||
    all.includes("code")
  )
    return "devtools";

  return "devtools"; // safe default
}

// ─── Stability inference ─────────────────────────────────────────────────────

function inferStability(project, releases) {
  const repoReleases = releases.filter((r) => r.repo === project.repo);

  if (repoReleases.length === 0) return "experimental";

  // Find the latest non-prerelease semver tag
  const latestTag = repoReleases
    .filter((r) => !r.prerelease)
    .map((r) => ({ tag: r.tag, parsed: parseSemver(r.tag) }))
    .filter((r) => r.parsed !== null)
    .sort((a, b) => {
      const ap = a.parsed;
      const bp = b.parsed;
      return bp.major - ap.major || bp.minor - ap.minor || bp.patch - ap.patch;
    })[0];

  if (!latestTag || !latestTag.parsed) return "beta"; // has releases but no semver

  if (latestTag.parsed.major >= 1) return "stable";
  return "beta";
}

// ─── Install command inference ───────────────────────────────────────────────

function inferInstall(project, kind) {
  const name = project.repo;
  const lang = (project.language || "").toLowerCase();

  // Don't infer install for types that aren't pip/npm installable
  if (["desktop-app", "template", "meta", "homebrew-tap", "vscode-extension"].includes(kind))
    return null;

  // Chrome/browser extensions aren't pip/npm installable
  if (name.includes("extension") && !name.includes("vscode"))
    return null;

  if (lang === "python") {
    if (kind === "cli") return `pipx install ${name}`;
    return `pip install ${name}`;
  }

  if (lang === "typescript" || lang === "javascript") {
    const pkg = name.toLowerCase();
    if (kind === "cli") return `npx ${pkg}`;
    if (kind === "mcp-server") return `npx ${pkg}`;
    return `npm install ${pkg}`;
  }

  if (lang === "ruby") {
    return `gem install ${name}`;
  }

  // C# — no pip/npm, usually a desktop app already filtered above
  return null;
}

// ─── Tagline inference ───────────────────────────────────────────────────────

function inferTagline(project) {
  let desc = (project.description || "").trim();
  if (!desc) return null;

  // Remove leading project name if description starts with it
  const namePattern = new RegExp(`^${escapeRegex(project.repo)}\\s*[-—:]\\s*`, "i");
  desc = desc.replace(namePattern, "");

  // Remove leading emoji
  desc = desc.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/u, "");

  // Truncate at sentence boundary if over 90 chars
  if (desc.length > 90) {
    const sentenceEnd = desc.indexOf(". ");
    if (sentenceEnd > 0 && sentenceEnd <= 88) {
      desc = desc.slice(0, sentenceEnd + 1);
    } else {
      // Find last space before 87 chars, add ellipsis
      const lastSpace = desc.lastIndexOf(" ", 87);
      desc = desc.slice(0, lastSpace > 0 ? lastSpace : 87) + "...";
    }
  }

  // Normalize ending: ensure single period, or ellipsis
  if (desc.endsWith("...")) {
    // leave ellipsis alone
  } else {
    desc = desc.replace(/\.+$/, ""); // strip trailing dots
    desc += ".";
  }

  return desc;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Tags inference ──────────────────────────────────────────────────────────

function inferTags(project) {
  // Use GitHub topics, capped at 6
  const topics = project.tags || [];
  if (topics.length > 0) return topics.slice(0, 6);

  // Fallback: derive from name/description
  const tokens = [];
  const name = (project.repo || "").toLowerCase();
  const desc = (project.description || "").toLowerCase();

  if (name.includes("mcp") || desc.includes("mcp")) tokens.push("mcp");
  if (name.includes("voice") || desc.includes("tts")) tokens.push("voice");
  if (name.includes("ml") || desc.includes("training")) tokens.push("ml");
  if (desc.includes("security") || desc.includes("audit")) tokens.push("security");

  return tokens.slice(0, 6);
}

// ─── Candidate selection ─────────────────────────────────────────────────────

function selectCandidates(projects, overrides, releases, ignoreList) {
  const ignoreSet = new Set(ignoreList);
  const releaseRepos = new Set(releases.map((r) => r.repo));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const candidates = projects
    .filter((p) => {
      // Hard exclusions
      if (ignoreSet.has(p.repo)) return false;

      const existing = overrides[p.repo];

      // Skip if complete override exists (has all required fields, no review flag)
      if (existing) {
        const hasAllFields = REQUIRED_FIELDS.every((f) => existing[f]);
        if (hasAllFields && !existing.needsHumanReview) return false;
      }

      // Only repos active in last 90 days
      if (p.updatedAt && new Date(p.updatedAt) < cutoff) return false;

      return true;
    })
    .map((p) => {
      // Score: more criteria met = higher priority
      let score = 0;
      const existing = overrides[p.repo];

      if (!existing) score += 4; // completely missing override
      else score += 1; // incomplete override

      if (releaseRepos.has(p.repo)) score += 2;
      if (p.description) score += 1;
      if (p.language) score += 1;

      return { project: p, score };
    })
    .sort((a, b) => {
      // Higher score first, then most recently updated
      if (b.score !== a.score) return b.score - a.score;
      return (b.project.updatedAt || "").localeCompare(a.project.updatedAt || "");
    })
    .slice(0, BATCH_SIZE);

  return candidates;
}

// ─── Draft generation ────────────────────────────────────────────────────────

function generateDraft(project, releases, existingOverride) {
  const existing = existingOverride || {};
  const draft = {};
  const fieldsAdded = [];

  // kind
  if (!existing.kind) {
    const kind = inferKind(project);
    if (kind) {
      draft.kind = kind;
      fieldsAdded.push("kind");
    }
  }

  // Use the kind we just inferred, or the existing one
  const effectiveKind = draft.kind || existing.kind || "library";

  // stability
  if (!existing.stability) {
    const stability = inferStability(project, releases);
    draft.stability = stability;
    fieldsAdded.push("stability");
  }

  // category
  if (!existing.category) {
    const category = inferCategory(project, effectiveKind);
    if (category) {
      draft.category = category;
      fieldsAdded.push("category");
    }
  }

  // install
  if (!existing.install) {
    const install = inferInstall(project, effectiveKind);
    if (install) {
      draft.install = install;
      fieldsAdded.push("install");
    }
  }

  // tagline
  if (!existing.tagline) {
    const tagline = inferTagline(project);
    if (tagline) {
      draft.tagline = tagline;
      fieldsAdded.push("tagline");
    }
  }

  // tags
  if (!existing.tags || existing.tags.length === 0) {
    const tags = inferTags(project);
    if (tags.length > 0) {
      draft.tags = tags;
      fieldsAdded.push("tags");
    }
  }

  // Only produce output if we actually added something
  if (fieldsAdded.length === 0) return null;

  // Merge: existing fields preserved, draft fields added
  const merged = { ...existing, ...draft, needsHumanReview: true };

  return { merged, fieldsAdded };
}

// ─── Stable key ordering for deterministic diffs ─────────────────────────────

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
  // Include any fields not in the order list
  for (const key of Object.keys(obj)) {
    if (!FIELD_ORDER.includes(key)) ordered[key] = obj[key];
  }
  return ordered;
}

function stableOverrides(overrides) {
  // Sort keys alphabetically for deterministic diffs
  const sorted = {};
  for (const key of Object.keys(overrides).sort()) {
    sorted[key] = orderFields(overrides[key]);
  }
  return sorted;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const projects = readJson(PROJECTS_PATH);
  const releases = readJson(RELEASES_PATH) || [];
  const overrides = readJson(OVERRIDES_PATH) || {};
  const ignoreList = readJson(IGNORE_PATH) || [];

  if (!projects) {
    console.error("ERROR: projects.json not found. Run sync first.");
    process.exit(1);
  }

  console.log(`Loaded ${projects.length} projects, ${Object.keys(overrides).length} overrides, ${releases.length} releases`);
  console.log(`Skip list: ${ignoreList.length} repos`);
  console.log(`Batch size: ${BATCH_SIZE}${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  const candidates = selectCandidates(projects, overrides, releases, ignoreList);

  if (candidates.length === 0) {
    console.log("No candidates found. All repos are either ignored, complete, or inactive.");
    return;
  }

  console.log(`Selected ${candidates.length} candidates:\n`);

  const updatedOverrides = { ...overrides };
  let totalFieldsAdded = 0;

  for (const { project, score } of candidates) {
    const existing = overrides[project.repo];
    const result = generateDraft(project, releases, existing);

    if (!result) {
      console.log(`  ${project.repo} — no fields to add (score: ${score})`);
      continue;
    }

    const { merged, fieldsAdded } = result;
    totalFieldsAdded += fieldsAdded.length;

    const status = existing ? "UPDATED" : "NEW";
    console.log(`  ${status}  ${project.repo}`);
    console.log(`         fields: ${fieldsAdded.join(", ")}`);
    console.log(`         kind=${merged.kind || "?"} stability=${merged.stability || "?"} category=${merged.category || "?"}`);
    if (merged.tagline) console.log(`         tagline: "${merged.tagline}"`);
    if (merged.install) console.log(`         install: ${merged.install}`);
    console.log();

    updatedOverrides[project.repo] = merged;
  }

  if (totalFieldsAdded === 0) {
    console.log("No fields were added. Nothing to write.");
    return;
  }

  const sorted = stableOverrides(updatedOverrides);

  if (DRY_RUN) {
    console.log(`\nDRY RUN: Would write ${Object.keys(sorted).length} overrides (${totalFieldsAdded} new fields across ${candidates.length} repos)`);
    console.log("Run without --dry-run to write changes.");
  } else {
    writeJson(OVERRIDES_PATH, sorted);
    console.log(`\nWrote ${Object.keys(sorted).length} overrides to ${OVERRIDES_PATH}`);
    console.log(`Added ${totalFieldsAdded} fields across ${candidates.length} repos`);
    console.log("All new entries have needsHumanReview: true");
  }
}

main();

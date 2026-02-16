#!/usr/bin/env node

/**
 * Target List Generator
 *
 * Discovers, scores, and ranks potential partners/integrators/amplifiers
 * using public GitHub data + MarketIR targeting specs.
 *
 * No scraping, no creepy tracking — just public GitHub + structured messaging.
 *
 * Output: site/public/targets/<slug>/
 *   - targets.json   — full scored list with metadata
 *   - targets.csv    — Sheets-importable
 *   - README.md      — top 25 table + outreach template links
 *   - drafts/<owner>--<repo>.md — per-target outreach drafts (top N)
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_... node scripts/gen-targets.mjs
 *   GITHUB_TOKEN=ghp_... node scripts/gen-targets.mjs --top 10 --drafts 5
 *   node scripts/gen-targets.mjs --dry-run
 *
 * Environment:
 *   GITHUB_TOKEN — required (search API needs authentication)
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
const SIGNALS_DIR = path.join(SITE, "src", "data", "signals");
const OUTREACH_DIR = path.join(SITE, "public", "outreach");
const CACHE_DIR = path.join(SITE, "src", "data", "target-cache");
const OUTPUT_BASE = path.join(SITE, "public", "targets");

const TOKEN = process.env.GITHUB_TOKEN || "";
const THROTTLE_MS = 2000;
const SELF_ORG = "mcp-tool-shop-org";
const SELF_SITE = "mcp-tool-shop";

const SCORING_VERSION = "1.0.0";
const SCORING_WEIGHTS = {
  topicMatch: { perMatch: 15, max: 60 },
  keywordMatch: { perMatch: 10, max: 40 },
  activityRecency: { max: 20, decayDays: 365 },
  starTier: { max: 15, tiers: [
    { min: 1000, score: 15 },
    { min: 100, score: 13 },
    { min: 10, score: 10 },
    { min: 0, score: 5 },
  ]},
  fitScore: { max: 20 },
  comparableBonus: { value: 10 },
  signalBonus: { value: 10 },
};

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return parseInt(args[idx + 1], 10) || defaultVal;
}
const DRY_RUN = args.includes("--dry-run");
const WORTHY_ONLY = args.includes("--worthy-only");
const MAX_CANDIDATES = getArg("top", 100);
const MAX_DRAFTS = getArg("drafts", 25);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghApi(endpoint) {
  const url = endpoint.startsWith("https://")
    ? endpoint
    : `https://api.github.com/${endpoint}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) headers["Authorization"] = `token ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${url}`);
  }
  return res.json();
}

async function ghApiSafe(endpoint, label) {
  try {
    return { data: await ghApi(endpoint), error: null };
  } catch (err) {
    return { data: null, error: `${label}: ${err.message}` };
  }
}

/** Day-based file cache for GitHub search results */
function getCacheKey(query) {
  // Simple hash: use query as filename-safe string
  return query
    .replace(/[^a-zA-Z0-9-]/g, "_")
    .slice(0, 120);
}

async function ghSearchCached(queryStr, label) {
  const today = new Date().toISOString().slice(0, 10);
  const key = getCacheKey(queryStr);
  const cacheFile = path.join(CACHE_DIR, `${key}-${today}.json`);

  // Check cache
  const cached = readJson(cacheFile);
  if (cached) {
    console.log(`    cache hit: ${label}`);
    return { data: cached, error: null, cached: true };
  }

  // Fetch
  const encoded = encodeURIComponent(queryStr);
  const result = await ghApiSafe(
    `search/repositories?q=${encoded}&sort=stars&order=desc&per_page=50`,
    label
  );

  // Cache on success
  if (result.data) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(result.data, null, 2), "utf8");
  }

  await sleep(THROTTLE_MS);
  return { ...result, cached: false };
}

// ─── Load data ───────────────────────────────────────────────────────────────

const overrides = readJson(OVERRIDES_PATH);
if (!overrides) {
  console.error("Failed to load overrides.json");
  process.exit(1);
}

const snapshot = readJson(path.join(DATA_DIR, "marketir.snapshot.json"));
const lockShort = snapshot?.lockSha256?.slice(0, 12) || "unknown";

// Find enabled tools with targeting
let enabledSlugs = Object.entries(overrides)
  .filter(([, v]) => v.publicProof === true)
  .map(([k]) => k);

// Worthy-only filter: intersect with worthy.json repos where worthy === true
if (WORTHY_ONLY) {
  const WORTHY_PATH = path.join(SITE, "src", "data", "worthy.json");
  const worthy = readJson(WORTHY_PATH);
  if (worthy?.repos) {
    const worthySlugs = new Set(
      Object.entries(worthy.repos)
        .filter(([, v]) => v.worthy === true)
        .map(([k]) => k)
    );
    const before = enabledSlugs.length;
    enabledSlugs = enabledSlugs.filter((s) => worthySlugs.has(s));
    console.log(`  --worthy-only: ${before} → ${enabledSlugs.length} slugs (${before - enabledSlugs.length} filtered out)`);
  } else {
    console.warn("  --worthy-only: worthy.json not found, no filtering applied.");
  }
}

if (enabledSlugs.length === 0) {
  console.log("No tools with publicProof enabled. Nothing to generate.");
  process.exit(0);
}

if (!TOKEN && !DRY_RUN) {
  console.error("GITHUB_TOKEN required — search API needs authentication.");
  console.error("Set GITHUB_TOKEN env var or use --dry-run to preview queries.");
  process.exit(1);
}

console.log(`Target List Generator v${SCORING_VERSION}`);
console.log(`  max candidates: ${MAX_CANDIDATES}`);
console.log(`  max drafts: ${MAX_DRAFTS}`);
console.log(`  worthy-only: ${WORTHY_ONLY}`);
console.log(`  dry-run: ${DRY_RUN}`);
console.log("");

// ─── Load audience pain points (for fit scoring) ────────────────────────────

const audienceDir = path.join(DATA_DIR, "data", "audiences");
const allPainPoints = new Set();
try {
  const audFiles = fs.readdirSync(audienceDir).filter((f) => f.endsWith(".json"));
  for (const af of audFiles) {
    const aud = readJson(path.join(audienceDir, af));
    if (aud?.painPoints) {
      for (const pp of aud.painPoints) {
        // Extract keywords from pain points
        for (const word of pp.toLowerCase().split(/\s+/)) {
          if (word.length > 3) allPainPoints.add(word);
        }
      }
    }
  }
} catch {}

// ─── Load distribution signals (optional) ───────────────────────────────────

let signalOrgs = new Set();
try {
  const sigFiles = fs.readdirSync(SIGNALS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  if (sigFiles.length > 0) {
    const latest = readJson(path.join(SIGNALS_DIR, sigFiles[0]));
    if (latest?.signals) {
      for (const sig of latest.signals) {
        for (const r of sig.results || []) {
          const owner = r.repo.split("/")[0];
          if (owner && owner !== SELF_ORG && owner !== SELF_SITE) {
            signalOrgs.add(owner);
          }
        }
      }
    }
    if (signalOrgs.size > 0) {
      console.log(`  signal orgs loaded: ${signalOrgs.size}`);
    }
  }
} catch {}

// ─── Generate per-tool ──────────────────────────────────────────────────────

for (const slug of enabledSlugs) {
  const tool = readJson(path.join(DATA_DIR, "data", "tools", `${slug}.json`));
  if (!tool) {
    console.warn(`  No MarketIR data for ${slug}, skipping.`);
    continue;
  }

  const targeting = tool.targeting;
  if (!targeting) {
    console.warn(`  No targeting block for ${slug}, skipping.`);
    continue;
  }

  const facts = readJson(path.join(FACTS_DIR, `${slug}.json`));
  const press = tool.press;
  const proven = (tool.claims || []).filter((c) => c.status === "proven");

  console.log(`\nGenerating targets for: ${slug}`);
  console.log(`  keywords: ${targeting.keywords?.length || 0}`);
  console.log(`  topics: ${targeting.topics?.length || 0}`);
  console.log(`  languages: ${targeting.languages?.length || 0}`);
  console.log(`  exclusions: ${targeting.exclusions?.length || 0}`);
  console.log(`  seedRepos: ${targeting.seedRepos?.length || 0}`);

  if (DRY_RUN) {
    console.log("\n  [DRY RUN] Queries that would be executed:");
    for (const topic of targeting.topics || []) {
      console.log(`    topic search: topic:${topic}`);
    }
    for (const kw of targeting.keywords || []) {
      console.log(`    keyword search: ${kw} in:readme,description`);
    }
    if (press?.comparables) {
      for (const c of press.comparables) {
        console.log(`    comparable search: ${c.target}`);
      }
    }
    for (const seed of targeting.seedRepos || []) {
      console.log(`    seed repo: ${seed.owner}/${seed.repo}`);
    }
    console.log("  [DRY RUN] No API calls made.");
    continue;
  }

  // ── Candidate map ──────────────────────────────────────────────────────
  /** @type {Map<string, {owner: string, repo: string, fullName: string, description: string, stars: number, language: string, topics: string[], pushedAt: string, archived: boolean, ownerType: string, whyMatched: string[]}>} */
  const candidates = new Map();
  const errors = [];
  const discoveryStats = {
    topicSearches: 0,
    keywordSearches: 0,
    comparableSearches: 0,
    signalExpansions: 0,
    seedExpansions: 0,
    rawCandidates: 0,
    afterDedup: 0,
    afterExclusion: 0,
    afterScoring: 0,
  };

  function addCandidate(item, reason) {
    const fullName = item.full_name;
    if (candidates.has(fullName)) {
      candidates.get(fullName).whyMatched.push(reason);
    } else {
      candidates.set(fullName, {
        owner: item.owner?.login || fullName.split("/")[0],
        repo: item.name,
        fullName,
        description: (item.description || "").slice(0, 200),
        stars: item.stargazers_count || 0,
        language: item.language || null,
        topics: item.topics || [],
        pushedAt: item.pushed_at || null,
        archived: item.archived || false,
        ownerType: item.owner?.type?.toLowerCase() || "unknown",
        whyMatched: [reason],
        htmlUrl: item.html_url || `https://github.com/${fullName}`,
      });
    }
    discoveryStats.rawCandidates++;
  }

  // ── Strategy 1: Topic search ──────────────────────────────────────────
  for (const topic of targeting.topics || []) {
    const q = `topic:${topic}`;
    console.log(`  topic search: ${q}`);
    const result = await ghSearchCached(q, `topic:${topic}`);
    if (result.data?.items) {
      for (const item of result.data.items) {
        addCandidate(item, `topic:${topic}`);
      }
      discoveryStats.topicSearches++;
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  // ── Strategy 2: Keyword search ────────────────────────────────────────
  for (const kw of targeting.keywords || []) {
    const q = `${kw} in:readme,description`;
    console.log(`  keyword search: ${kw}`);
    const result = await ghSearchCached(q, `keyword:${kw}`);
    if (result.data?.items) {
      for (const item of result.data.items) {
        addCandidate(item, `keyword:${kw}`);
      }
      discoveryStats.keywordSearches++;
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  // ── Strategy 3: Comparable expansion ──────────────────────────────────
  if (press?.comparables) {
    for (const comp of press.comparables) {
      const q = `${comp.target} in:readme,description`;
      console.log(`  comparable search: ${comp.target}`);
      const result = await ghSearchCached(q, `comparable:${comp.target}`);
      if (result.data?.items) {
        for (const item of result.data.items) {
          addCandidate(item, `comparable:${comp.target}`);
        }
        discoveryStats.comparableSearches++;
      } else if (result.error) {
        errors.push(result.error);
      }
    }
  }

  // ── Strategy 4: Signal expansion ──────────────────────────────────────
  if (signalOrgs.size > 0) {
    // Search for repos from orgs that mentioned our go-links
    for (const org of [...signalOrgs].slice(0, 5)) {
      const q = `user:${org}`;
      console.log(`  signal expansion: ${org}`);
      const result = await ghSearchCached(q, `signal:${org}`);
      if (result.data?.items) {
        for (const item of result.data.items) {
          addCandidate(item, `signal:${org}`);
        }
        discoveryStats.signalExpansions++;
      } else if (result.error) {
        errors.push(result.error);
      }
    }
  }

  // ── Strategy 5: Seed repo expansion ───────────────────────────────────
  for (const seed of targeting.seedRepos || []) {
    // Get seed repo topics, then search for similar
    const seedResult = await ghApiSafe(
      `repos/${seed.owner}/${seed.repo}`,
      `seed:${seed.owner}/${seed.repo}`
    );
    if (seedResult.data) {
      const seedTopics = seedResult.data.topics || [];
      const seedLang = seedResult.data.language;

      // Add the seed repo itself as a candidate
      addCandidate(seedResult.data, `seed:${seed.owner}/${seed.repo}`);

      // Search for repos with same primary topic + language
      if (seedTopics.length > 0) {
        const topTopic = seedTopics[0];
        const langFilter = seedLang ? ` language:${seedLang}` : "";
        const q = `topic:${topTopic}${langFilter}`;
        console.log(`  seed expansion: ${topTopic}${langFilter}`);
        const result = await ghSearchCached(q, `seed-expand:${topTopic}`);
        if (result.data?.items) {
          for (const item of result.data.items) {
            addCandidate(item, `seed:${seed.owner}/${seed.repo}`);
          }
          discoveryStats.seedExpansions++;
        } else if (result.error) {
          errors.push(result.error);
        }
      }
    } else if (seedResult.error) {
      errors.push(seedResult.error);
    }
    await sleep(THROTTLE_MS);
  }

  discoveryStats.afterDedup = candidates.size;
  console.log(`  raw candidates: ${discoveryStats.rawCandidates}, deduped: ${candidates.size}`);

  // ── Exclusion filter ──────────────────────────────────────────────────
  const exclusions = new Set(
    (targeting.exclusions || []).map((e) => e.toLowerCase())
  );

  for (const [key, cand] of candidates) {
    const ownerLower = cand.owner.toLowerCase();
    const repoLower = cand.repo.toLowerCase();
    const fullLower = cand.fullName.toLowerCase();

    if (
      exclusions.has(ownerLower) ||
      exclusions.has(fullLower) ||
      cand.archived ||
      ownerLower === SELF_ORG.toLowerCase() ||
      ownerLower === SELF_SITE.toLowerCase()
    ) {
      candidates.delete(key);
    }
  }

  discoveryStats.afterExclusion = candidates.size;
  console.log(`  after exclusions: ${candidates.size}`);

  // ── Scoring ───────────────────────────────────────────────────────────

  const topicSet = new Set((targeting.topics || []).map((t) => t.toLowerCase()));
  const keywordSet = new Set((targeting.keywords || []).map((k) => k.toLowerCase()));

  for (const [, cand] of candidates) {
    const breakdown = {};

    // Topic match
    const candTopics = (cand.topics || []).map((t) => t.toLowerCase());
    const topicMatches = candTopics.filter((t) => topicSet.has(t)).length;
    breakdown.topicMatch = Math.min(
      topicMatches * SCORING_WEIGHTS.topicMatch.perMatch,
      SCORING_WEIGHTS.topicMatch.max
    );

    // Keyword match
    const descLower = (cand.description || "").toLowerCase();
    const repoLower = cand.repo.toLowerCase();
    let kwMatches = 0;
    for (const kw of keywordSet) {
      if (descLower.includes(kw) || repoLower.includes(kw)) {
        kwMatches++;
      }
    }
    breakdown.keywordMatch = Math.min(
      kwMatches * SCORING_WEIGHTS.keywordMatch.perMatch,
      SCORING_WEIGHTS.keywordMatch.max
    );

    // Activity recency
    if (cand.pushedAt) {
      const daysSincePush =
        (Date.now() - new Date(cand.pushedAt).getTime()) / (1000 * 60 * 60 * 24);
      const decay = Math.max(
        0,
        1 - daysSincePush / SCORING_WEIGHTS.activityRecency.decayDays
      );
      breakdown.activityRecency = Math.round(
        decay * SCORING_WEIGHTS.activityRecency.max
      );
    } else {
      breakdown.activityRecency = 0;
    }

    // Star tier
    const stars = cand.stars || 0;
    const tier = SCORING_WEIGHTS.starTier.tiers.find((t) => stars >= t.min);
    breakdown.starTier = tier ? tier.score : 0;

    // Fit score (audience painPoint keyword overlap)
    if (allPainPoints.size > 0) {
      const descWords = new Set(descLower.split(/\s+/).filter((w) => w.length > 3));
      let overlap = 0;
      for (const word of descWords) {
        if (allPainPoints.has(word)) overlap++;
      }
      breakdown.fitScore = Math.min(overlap * 5, SCORING_WEIGHTS.fitScore.max);
    } else {
      breakdown.fitScore = 0;
    }

    // Comparable bonus
    breakdown.comparableBonus = cand.whyMatched.some((w) => w.startsWith("comparable:"))
      ? SCORING_WEIGHTS.comparableBonus.value
      : 0;

    // Signal bonus
    breakdown.signalBonus = cand.whyMatched.some((w) => w.startsWith("signal:"))
      ? SCORING_WEIGHTS.signalBonus.value
      : 0;

    cand.scoreBreakdown = breakdown;
    cand.score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    cand.scoringVersion = SCORING_VERSION;
  }

  // Sort by score descending, then by stars descending
  const sorted = [...candidates.values()]
    .sort((a, b) => b.score - a.score || b.stars - a.stars)
    .slice(0, MAX_CANDIDATES);

  discoveryStats.afterScoring = sorted.length;
  console.log(`  scored and ranked: ${sorted.length} (top ${MAX_CANDIDATES})`);

  // ── Output ────────────────────────────────────────────────────────────

  const outDir = path.join(OUTPUT_BASE, slug);
  fs.mkdirSync(outDir, { recursive: true });

  const generatedAt = new Date().toISOString();

  // targets.json
  const targetsJson = {
    tool: slug,
    generatedAt,
    scoringVersion: SCORING_VERSION,
    scoringWeights: SCORING_WEIGHTS,
    sourcelock: lockShort,
    discoveryStats,
    errors,
    candidateCount: sorted.length,
    candidates: sorted.map((c) => ({
      owner: c.owner,
      repo: c.repo,
      fullName: c.fullName,
      description: c.description,
      stars: c.stars,
      language: c.language,
      topics: c.topics,
      pushedAt: c.pushedAt,
      ownerType: c.ownerType,
      whyMatched: [...new Set(c.whyMatched)],
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      scoringVersion: c.scoringVersion,
      htmlUrl: c.htmlUrl,
    })),
  };

  fs.writeFileSync(
    path.join(outDir, "targets.json"),
    JSON.stringify(targetsJson, null, 2) + "\n",
    "utf8"
  );
  console.log(`  wrote targets/${slug}/targets.json`);

  // targets.csv (hand-generated, no library)
  const csvHeader = "rank,owner,repo,stars,score,language,ownerType,whyMatched,pushedAt,url\n";
  const csvRows = sorted.map((c, i) => {
    const why = [...new Set(c.whyMatched)].join("; ");
    // Escape CSV fields
    const esc = (v) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    return [
      i + 1,
      esc(c.owner),
      esc(c.repo),
      c.stars,
      c.score,
      esc(c.language),
      esc(c.ownerType),
      esc(why),
      c.pushedAt?.slice(0, 10) || "",
      c.htmlUrl,
    ].join(",");
  });

  fs.writeFileSync(
    path.join(outDir, "targets.csv"),
    csvHeader + csvRows.join("\n") + "\n",
    "utf8"
  );
  console.log(`  wrote targets/${slug}/targets.csv`);

  // README.md — top 25 table
  const top25 = sorted.slice(0, 25);
  const readmeLines = [];
  readmeLines.push(`# Target List: ${slug}`);
  readmeLines.push("");
  readmeLines.push(`Generated: ${generatedAt}`);
  readmeLines.push(`Scoring: v${SCORING_VERSION} | Source lock: ${lockShort}`);
  readmeLines.push(`Candidates: ${sorted.length} | Shown: ${top25.length}`);
  readmeLines.push("");
  readmeLines.push("## Top Candidates");
  readmeLines.push("");
  readmeLines.push("| # | Repo | Stars | Score | Language | Why |");
  readmeLines.push("|---|------|-------|-------|----------|-----|");

  for (let i = 0; i < top25.length; i++) {
    const c = top25[i];
    const why = [...new Set(c.whyMatched)].slice(0, 3).join(", ");
    const draftLink = i < MAX_DRAFTS
      ? ` ([draft](drafts/${c.owner}--${c.repo}.md))`
      : "";
    readmeLines.push(
      `| ${i + 1} | [${c.fullName}](${c.htmlUrl}) | ${c.stars} | ${c.score} | ${c.language || "—"} | ${why}${draftLink} |`
    );
  }

  readmeLines.push("");
  readmeLines.push("## Scoring Breakdown");
  readmeLines.push("");
  readmeLines.push("| Factor | Per Match | Max |");
  readmeLines.push("|--------|-----------|-----|");
  readmeLines.push(`| Topic match | ${SCORING_WEIGHTS.topicMatch.perMatch} | ${SCORING_WEIGHTS.topicMatch.max} |`);
  readmeLines.push(`| Keyword match | ${SCORING_WEIGHTS.keywordMatch.perMatch} | ${SCORING_WEIGHTS.keywordMatch.max} |`);
  readmeLines.push(`| Activity recency | linear decay/${SCORING_WEIGHTS.activityRecency.decayDays}d | ${SCORING_WEIGHTS.activityRecency.max} |`);
  readmeLines.push(`| Star tier | tiered | ${SCORING_WEIGHTS.starTier.max} |`);
  readmeLines.push(`| Fit score | 5/overlap | ${SCORING_WEIGHTS.fitScore.max} |`);
  readmeLines.push(`| Comparable bonus | — | ${SCORING_WEIGHTS.comparableBonus.value} |`);
  readmeLines.push(`| Signal bonus | — | ${SCORING_WEIGHTS.signalBonus.value} |`);
  readmeLines.push("");
  readmeLines.push("## Links");
  readmeLines.push("");
  readmeLines.push(`- [Full JSON](targets.json)`);
  readmeLines.push(`- [CSV export](targets.csv)`);
  readmeLines.push(`- [Outreach pack](https://mcptoolshop.com/outreach/${slug}/)`);
  readmeLines.push(`- [Press page](https://mcptoolshop.com/press/${slug}/)`);
  readmeLines.push("");

  fs.writeFileSync(
    path.join(outDir, "README.md"),
    readmeLines.join("\n"),
    "utf8"
  );
  console.log(`  wrote targets/${slug}/README.md`);

  // ── Draft outreach (top N) ────────────────────────────────────────────

  const draftsDir = path.join(outDir, "drafts");
  fs.mkdirSync(draftsDir, { recursive: true });

  const draftCandidates = sorted.slice(0, MAX_DRAFTS);
  const oneLiner = tool.positioning?.oneLiner || "";
  const pressPageUrl = `https://mcptoolshop.com/press/${slug}/`;
  const outreachPackUrl = `https://mcptoolshop.com/outreach/${slug}/`;

  // Proof bullets
  const proofBullets = proven.slice(0, 3).map((c) =>
    `- ${c.statement} (proof: ${pressPageUrl})`
  );

  for (const cand of draftCandidates) {
    // Template selection based on owner type
    let templateType;
    if (cand.ownerType === "organization") {
      templateType = "email-partner";
    } else {
      // Check if it's a tool/library by topics or language
      const isLib = cand.topics.some((t) =>
        ["library", "framework", "sdk", "cli", "tool"].includes(t)
      );
      templateType = isLib ? "email-integrator" : "dm-short";
    }

    const lines = [];
    lines.push(`# Draft Outreach: ${cand.fullName}`);
    lines.push("");
    lines.push(`**Score:** ${cand.score} | **Template:** ${templateType} | **Stars:** ${cand.stars}`);
    lines.push(`**Why matched:** ${[...new Set(cand.whyMatched)].join(", ")}`);
    lines.push("");

    if (templateType === "dm-short") {
      // Short DM format
      lines.push("## Short DM");
      lines.push("");
      lines.push("```");
      const dm = `Hi! We built ${tool.name} (${oneLiner}). Your ${cand.repo} looks like a great fit — ${proofBullets.length} proven claims with receipts at ${pressPageUrl}`;
      lines.push(dm.length > 300 ? dm.slice(0, 297) + "..." : dm);
      lines.push("```");
    } else {
      // Email format
      lines.push(`## Subject`);
      lines.push("");
      if (templateType === "email-partner") {
        lines.push(`Partnership: ${tool.name} + ${cand.repo}`);
      } else {
        lines.push(`Integrate ${tool.name} into ${cand.repo}`);
      }
      lines.push("");
      lines.push("## Body");
      lines.push("");
      lines.push(`[context] Hi — we built ${tool.name} and noticed ${cand.fullName}.`);
      lines.push("");
      lines.push(`${oneLiner}`);
      lines.push("");
      lines.push("**Proven capabilities:**");
      lines.push("");
      for (const bullet of proofBullets) {
        lines.push(bullet);
      }
      lines.push("");

      if (press?.partnerOffers?.length > 0 && templateType === "email-partner") {
        lines.push("**What we offer:**");
        lines.push("");
        for (const offer of press.partnerOffers) {
          lines.push(`- **${offer.type}:** ${offer.description}`);
        }
        lines.push("");
      }

      lines.push("**Links:**");
      lines.push(`- Press page: ${pressPageUrl}`);
      lines.push(`- Outreach pack: ${outreachPackUrl}`);
      lines.push(`- GitHub: https://github.com/${SELF_ORG}/${slug}`);
    }

    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`_Generated for ${cand.fullName} by Target List Generator v${SCORING_VERSION}_`);
    lines.push(`_Source lock: ${lockShort} | ${generatedAt}_`);
    lines.push("");

    const draftFile = `${cand.owner}--${cand.repo}.md`;
    fs.writeFileSync(path.join(draftsDir, draftFile), lines.join("\n"), "utf8");
  }

  console.log(`  wrote ${draftCandidates.length} draft outreach files`);
  console.log(`  done: ${slug}`);
}

console.log("\nDone.");

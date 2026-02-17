/**
 * Generate Today's Picks (recommended repos).
 * Source: projects.json + releases.json
 * Output: site/src/data/todays-picks.json
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "site", "src", "data");
const OUT_PATH = path.join(DATA_DIR, "todays-picks.json");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");

// Ensure directory exists
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

// Load data
const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, "utf8"));
let healthMap = {};
try {
  const healthData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "readme-health.json"), "utf8"));
  if (healthData.results) {
    healthData.results.forEach(r => healthMap[r.repo] = r);
  }
} catch (e) {
  console.warn("Could not load readme-health.json, skipping quality checks.");
}

const EXCLUDED_REPOS = new Set([
  "winget-pkgs",
  "homebrew-tap",
  ".github",
  "mcp-tool-shop",
  "mcp-tool-shop-org" // meta org repo
]);

// Helper: Get quality penalty
function getQualityPenalty(repo) {
    const health = healthMap[repo];
    if (!health) return -50; // Unknown/Unchecked -> penalize slightly to prefer known good

    // 1. Hard fail for missing criticals (Install/Usage)
    if (health.capReason) return -1000; 

    // 2. Hard fail for missing readme
    if (health.checkStatus === "missing_readme") return -1000;

    // 3. Fail open for unreachable if history was good
    if (health.checkStatus === "unreachable") {
        if (health.score >= 70) return -10; // Slight dip
        return -50; // Treat as unknown/risky
    }

    // 4. Score-based penalty
    if (health.score < 50) return -50;
    
    return 0; // Good!
}

// Score projects (simple heuristic)
// In a real implementation, we'd use release recency, stars, screenshot presence etc.
// For now, filtering for featured or high stars
const scored = projects
  .filter(p => !p.archived && !p.unlisted && !EXCLUDED_REPOS.has(p.repo))
  .map(p => {
    const qualityPenalty = getQualityPenalty(p.repo);
    return {
      ...p,
      // Use stable jitter based on repo name chars instead of random
      score: (p.stars || 0) + (p.featured ? 50 : 0) + (p.repo.length % 10) + qualityPenalty
    };
  })
  .filter(p => p.score > 0) // Filter out the bans
  .sort((a, b) => b.score - a.score);


// Deterministic selection based on date
const dateStr = new Date().toISOString().split('T')[0];
const dayHash = dateStr.split('').reduce((a, b) => a + b.charCodeAt(0), 0);

const PIN = "websketch-ir";

// Check pin health mechanism
const pinProject = projects.find(p => p.repo === PIN) || { repo: PIN, description: "Featured Tool" };
const pinPenalty = getQualityPenalty(PIN);
const isPinHealthy = pinPenalty > -100; // Allow unreachable (fail open), block broken (fail closed)

if (!isPinHealthy) {
    console.warn(`⚠️ Pinned item '${PIN}' is unhealthy (Penalty: ${pinPenalty}). Skipping pin.`);
}

// Remove PIN from candidates to avoid duplication
const candidates = scored.filter(p => p.repo !== PIN).slice(0, 30);
const selected = [];

// If PIN is healthy, start with it. If not, we'll pick 6 randoms essentially? 
// No, the requirement is "6 items". If pin is healthy, it takes slot 1.
let slotsNeeded = 5;

if (isPinHealthy) {
    // Add PIN logic later to final set, just ensure we don't pick it in random
} else {
    slotsNeeded = 6; // Fill the gap
}

// Deterministically pick items
for (let i = 0; i < slotsNeeded; i++) {
  // Use dayHash + index to pick pseudo-randomly but deterministically
  if (candidates.length === 0) break;
  const index = (dayHash + i * 7) % candidates.length;
  selected.push(candidates[index]);
  // Remove picked to avoid duplicates (naive approach for small set)
  candidates.splice(index, 1);
}

// Combine PIN + selected
const finalProjects = isPinHealthy ? [pinProject, ...selected] : selected;

const finalSet = finalProjects.map(p => ({
  slug: p.repo,
  reason: p.description || "Community favorite",
  signals: p.featured ? ["featured"] : ["popular"]
}));


const output = {
  date: dateStr,
  picks: finalSet
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
console.log(`Generated Today's Picks at ${OUT_PATH}`);

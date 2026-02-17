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

// Score projects (simple heuristic)
// In a real implementation, we'd use release recency, stars, screenshot presence etc.
// For now, filtering for featured or high stars
const scored = projects
  .filter(p => !p.archived && !p.unlisted)
  .map(p => ({
    ...p,
    score: (p.stars || 0) + (p.featured ? 50 : 0) + (Math.random() * 10) // slight jitter
  }))
  .sort((a, b) => b.score - a.score);

// Deterministic selection based on date
const dateStr = new Date().toISOString().split('T')[0];
const dayHash = dateStr.split('').reduce((a, b) => a + b.charCodeAt(0), 0);

const PIN = "websketch-ir";

// Remove PIN from candidates to avoid duplication
const candidates = scored.filter(p => p.repo !== PIN).slice(0, 30);

// Deterministically pick 5 items
const selected = [];
for (let i = 0; i < 5; i++) {
  // Use dayHash + index to pick pseudo-randomly but deterministically
  const index = (dayHash + i * 7) % candidates.length;
  selected.push(candidates[index]);
  // Remove picked to avoid duplicates (naive approach for small set)
  candidates.splice(index, 1);
}

// Combine PIN + 5 selected
// Note: We need to find the full object for PIN if it wasn't in candidates
const pinProject = projects.find(p => p.repo === PIN) || { repo: PIN, description: "Featured Tool" };

const finalSet = [pinProject, ...selected].map(p => ({
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

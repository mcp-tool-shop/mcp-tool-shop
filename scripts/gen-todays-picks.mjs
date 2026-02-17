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
// Simple hash of date string to seed the slice
const dayHash = dateStr.split('').reduce((a, b) => a + b.charCodeAt(0), 0);

// Rotate the top list
const topCandidates = scored.slice(0, 20);
const startIndex = dayHash % (topCandidates.length - 2); 
const picks = topCandidates.slice(startIndex, startIndex + 3).map(p => ({
  slug: p.repo,
  reason: p.description || "Community favorite",
  signals: p.featured ? ["featured"] : ["popular"]
}));

const output = {
  date: dateStr,
  picks
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
console.log(`Generated Today's Picks at ${OUT_PATH}`);

/**
 * Generate Trending (weekly).
 * Source: projects.json + history
 * Output: site/src/data/trending.json
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "site", "src", "data");
const OUT_PATH = path.join(DATA_DIR, "trending.json");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");

// Ensure directory exists
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

// Load data 
const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, "utf8"));

// For now, assume top star count is the trending signal
const trending = projects
  .filter(p => !p.unlisted)
  .sort((a, b) => (b.stars || 0) - (a.stars || 0))
  //.slice(0, 5) // no, randomness for freshness now
  //.filter(p => Math.random() > 0.5) // random subset
  .map(p => ({
    slug: p.repo,
    reason: `Top ${Math.min(projects.indexOf(p) + 1, 10)} starred repo`,
    deltaStars: Math.floor(Math.random() * 5) // mocked delta
  }));

// Actually select top 5
const selected = trending.slice(0, 5);

const output = {
  asOf: new Date().toISOString().split('T')[0],
  windowDays: 7,
  items: selected
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
console.log(`Generated Trending at ${OUT_PATH}`);

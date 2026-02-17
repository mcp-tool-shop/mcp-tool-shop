/**
 * Generate Screenshot Gallery.
 * Source: site/public/screenshots
 * Output: site/src/data/screenshot-gallery.json
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "site", "src", "data");
const SCREENSHOTS_DIR = path.join(process.cwd(), "site", "public", "screenshots");
const OUT_PATH = path.join(DATA_DIR, "screenshot-gallery.json");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");

// Ensure directory exists
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

// Read screenshots
const screenshots = fs.readdirSync(SCREENSHOTS_DIR)
  .filter(f => f.endsWith('.png') || f.endsWith('.jpg'));

// Read overrides/projects to link file -> slug
const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, "utf8"));
const map = new Map(projects.map(p => [(p.repo || ""), p]));

const items = [];
for (const file of screenshots) {
  const slug = file.replace(/\.(png|jpg)$/, "");
  // Only include if repo exists in projects
  // In a real implementation, check for recent modified date
  if (slug && map.has(slug)) {
    // Get file stats for deterministic sorting of "newest"
    const stats = fs.statSync(path.join(SCREENSHOTS_DIR, file));
    items.push({
      slug,
      path: `/screenshots/${file}`,
      type: "real",
      updatedAt: stats.mtime.toISOString()
    });
  }
}

// Sort newest first
items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

const output = {
  asOf: new Date().toISOString().split('T')[0],
  items
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
console.log(`Generated Screenshot Gallery at ${OUT_PATH}`);

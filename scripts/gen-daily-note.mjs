/**
 * Generate a daily note (placeholder) or rotate existing ones.
 *
 * This script ensures site/src/data/daily-note.json exists.
 * In a real implementation, this could fetch from a CMS, an issue, or MarketIR.
 */

import fs from 'node:fs';
import path from 'node:path';

const OUT_PATH = path.join(process.cwd(), 'site', 'src', 'data', 'daily-note.json');

// Ensure directory exists
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

const insights = [
  "We are actively refreshing the tool shop. Check back daily for updates.",
  "Did you know? MCP servers can be composed together.",
  "Check out the latest release notes for new features.",
  "Integration tools are growing faster than any other category.",
  "Security is a top priority for all listed tools.",
  "We've added new sorting options for better discovery."
];

// Deterministic selection based on day of year
// This ensures the note doesn't flip flop on multiple runs in the same day
const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
const selectedInsight = insights[dayOfYear % insights.length];

const note = {
  date: new Date().toISOString().split('T')[0],
  title: "Daily Insight",
  body: selectedInsight,
  links: [
    { label: "Browse tools", href: "/tools/" },
    { label: "Trust center", href: "/trust/" }
  ]
};

fs.writeFileSync(OUT_PATH, JSON.stringify(note, null, 2));
console.log(`Updated daily note at ${OUT_PATH} with insight: "${selectedInsight}"`);

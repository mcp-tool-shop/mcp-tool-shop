#!/usr/bin/env node
/**
 * Schema check for site/src/data/overrides.json.
 * Used by site-quality.yml (PRs) and daily-refresh.yml (main).
 * Daily Refresh used to skip this, so a seventh tag could sit on the
 * front door until an unrelated PR noticed.
 */

import fs from "node:fs";
import path from "node:path";

const VALID_KINDS = [
  "mcp-server",
  "cli",
  "library",
  "plugin",
  "desktop-app",
  "vscode-extension",
  "homebrew-tap",
  "template",
  "meta",
];
const VALID_STABILITY = ["stable", "beta", "experimental"];
const VALID_CATEGORIES = [
  "mcp-core",
  "voice",
  "security",
  "ml",
  "infrastructure",
  "desktop",
  "devtools",
  "web",
  "games",
];

const file = path.join(process.cwd(), "site", "src", "data", "overrides.json");
const overrides = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = [];

for (const [repo, entry] of Object.entries(overrides)) {
  if (entry.kind && !VALID_KINDS.includes(entry.kind)) {
    errors.push(`${repo}.kind = "${entry.kind}" (invalid)`);
  }
  if (entry.stability && !VALID_STABILITY.includes(entry.stability)) {
    errors.push(`${repo}.stability = "${entry.stability}" (invalid)`);
  }
  if (entry.category && !VALID_CATEGORIES.includes(entry.category)) {
    errors.push(`${repo}.category = "${entry.category}" (invalid)`);
  }
  if (entry.tagline && entry.tagline.length > 90) {
    errors.push(`${repo}.tagline is ${entry.tagline.length} chars (max 90)`);
  }
  if (entry.tags && entry.tags.length > 6) {
    errors.push(`${repo}.tags has ${entry.tags.length} items (max 6)`);
  }
  if (entry.goodFor && entry.goodFor.length > 4) {
    errors.push(`${repo}.goodFor has ${entry.goodFor.length} items (max 4)`);
  }
  if (entry.notFor && entry.notFor.length > 3) {
    errors.push(`${repo}.notFor has ${entry.notFor.length} items (max 3)`);
  }
  if (entry.screenshotType && !["real", "placeholder"].includes(entry.screenshotType)) {
    errors.push(`${repo}.screenshotType = "${entry.screenshotType}" (must be real|placeholder)`);
  }
  if (entry.screenshot && !entry.screenshot.startsWith("/screenshots/")) {
    errors.push(`${repo}.screenshot must start with /screenshots/`);
  }
}

if (errors.length) {
  for (const e of errors) console.error("ERROR: " + e);
  console.error(`\n${errors.length} validation error(s) found.`);
  process.exit(1);
}
console.log(`overrides.json: ${Object.keys(overrides).length} entries, all valid.`);

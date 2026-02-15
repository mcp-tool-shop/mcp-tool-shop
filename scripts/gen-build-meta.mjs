#!/usr/bin/env node

/**
 * Generates site/public/_build.json with build metadata.
 * Run before `astro build` so the file is included in dist/.
 *
 * Fields:
 *   commit   — git HEAD SHA (short)
 *   builtAt  — ISO timestamp
 *   syncedAt — last registry sync timestamp from meta.json
 *   projects — total project count
 *   node     — Node.js version
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "site", "public", "_build.json");

let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
} catch {}

let syncedAt = null;
let projectCount = 0;
try {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "src", "data", "registry", "meta.json"), "utf8"));
  syncedAt = meta.lastSyncAt || null;
} catch {}
try {
  const projects = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "src", "data", "projects.json"), "utf8"));
  projectCount = projects.length;
} catch {}

const build = {
  commit,
  builtAt: new Date().toISOString(),
  syncedAt,
  projects: projectCount,
  node: process.version,
};

fs.writeFileSync(OUT, JSON.stringify(build, null, 2) + "\n");
console.log("Wrote _build.json:", JSON.stringify(build));

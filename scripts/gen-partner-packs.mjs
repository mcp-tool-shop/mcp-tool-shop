#!/usr/bin/env node

/**
 * Partner Pack Generator
 *
 * Bundles press kit, outreach pack, screenshots, snippets, and campaign
 * materials into a single partner-ready package with manifest.json and
 * convenience ZIP via yazl.
 *
 * Output: site/public/partners/<slug>/
 *   - manifest.json         (canonical file list with SHA-256 hashes)
 *   - partner-pack.zip      (convenience ZIP containing all files)
 *   - (copies of all relevant files from other generators)
 *
 * Usage:
 *   node scripts/gen-partner-packs.mjs
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const PUBLIC = path.join(SITE, "public");
const OVERRIDES_PATH = path.join(SITE, "src", "data", "overrides.json");
const DATA_DIR = path.join(SITE, "src", "data", "marketir");
const OUTPUT_BASE = path.join(PUBLIC, "partners");

// Fixed timestamp for deterministic ZIP metadata (2025-01-01T00:00:00Z)
const FIXED_DATE = new Date("2025-01-01T00:00:00Z");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function copyIfExists(src, destDir, destName) {
  try {
    const data = fs.readFileSync(src);
    const dest = path.join(destDir, destName);
    fs.writeFileSync(dest, data);
    return { path: destName, sha256: sha256(data), bytes: data.length };
  } catch {
    return null;
  }
}

// ─── Load data ────────────────────────────────────────────────────────────────

const overrides = readJson(OVERRIDES_PATH);
if (!overrides) {
  console.error("Failed to load overrides.json");
  process.exit(1);
}

const snapshot = readJson(path.join(DATA_DIR, "marketir.snapshot.json"));
const lockShort = snapshot?.lockSha256?.slice(0, 12) || "unknown";

// ─── Find enabled tools ───────────────────────────────────────────────────────

const enabledSlugs = Object.entries(overrides)
  .filter(([, v]) => v.publicProof === true)
  .map(([k]) => k);

if (enabledSlugs.length === 0) {
  console.log("No tools with publicProof enabled. Nothing to generate.");
  process.exit(0);
}

console.log(`Generating partner packs for: ${enabledSlugs.join(", ")}\n`);

// ─── Generate ─────────────────────────────────────────────────────────────────

for (const slug of enabledSlugs) {
  const tool = readJson(path.join(DATA_DIR, "data", "tools", `${slug}.json`));
  if (!tool?.press) {
    console.warn(`  ⚠ No press block for ${slug}, skipping partner pack.`);
    continue;
  }

  const outDir = path.join(OUTPUT_BASE, slug);
  fs.mkdirSync(outDir, { recursive: true });

  const files = [];

  // ── Copy presskit files ──────────────────────────────────────────────────

  const presskitDir = path.join(PUBLIC, "presskit", slug);
  for (const fname of ["presskit.json", "README.md", "index.html", "release-announcement.md"]) {
    const result = copyIfExists(path.join(presskitDir, fname), outDir, `presskit-${fname}`);
    if (result) files.push(result);
  }

  // ── Copy outreach files ──────────────────────────────────────────────────

  const outreachDir = path.join(PUBLIC, "outreach", slug);
  const outreachFiles = [
    "email-journalist.md",
    "email-partner.md",
    "email-integrator.md",
    "dm-short.md",
    "hn-comment.md",
    "github-readme-snippet.md",
    "press-release-lite.md",
  ];
  for (const fname of outreachFiles) {
    const result = copyIfExists(path.join(outreachDir, fname), outDir, `outreach-${fname}`);
    if (result) files.push(result);
  }

  // ── Copy screenshot ──────────────────────────────────────────────────────

  const override = overrides[slug] || {};
  if (override.screenshot) {
    const screenshotSrc = path.join(PUBLIC, override.screenshot.replace(/^\//, ""));
    const ext = path.extname(override.screenshot);
    const result = copyIfExists(screenshotSrc, outDir, `screenshot${ext}`);
    if (result) files.push(result);
  }

  // ── Copy snippet ─────────────────────────────────────────────────────────

  {
    const result = copyIfExists(path.join(PUBLIC, "snippets", `${slug}.md`), outDir, "snippets.md");
    if (result) files.push(result);
  }

  // ── Copy campaign bundle ─────────────────────────────────────────────────

  // Find campaign dirs that match this slug
  try {
    const campaignDirs = fs.readdirSync(path.join(PUBLIC, "campaigns"));
    for (const dir of campaignDirs) {
      const bundle = readJson(path.join(PUBLIC, "campaigns", dir, "bundle.json"));
      if (bundle?.tool?.slug === slug) {
        const result = copyIfExists(
          path.join(PUBLIC, "campaigns", dir, "bundle.json"),
          outDir,
          `campaign-${dir}-bundle.json`
        );
        if (result) files.push(result);
        const readmeResult = copyIfExists(
          path.join(PUBLIC, "campaigns", dir, "README.md"),
          outDir,
          `campaign-${dir}-README.md`
        );
        if (readmeResult) files.push(readmeResult);
      }
    }
  } catch {}

  // ── Sort files for determinism ───────────────────────────────────────────

  files.sort((a, b) => a.path.localeCompare(b.path));

  // ── Write manifest.json ──────────────────────────────────────────────────

  const manifest = {
    tool: slug,
    generatedAt: new Date().toISOString(),
    sourcelock: lockShort,
    files,
  };

  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  const manifestBuf = Buffer.from(manifestText, "utf8");
  fs.writeFileSync(path.join(outDir, "manifest.json"), manifestBuf);

  // Add manifest to the file list for the ZIP (but after writing the file)
  const manifestEntry = {
    path: "manifest.json",
    sha256: sha256(manifestBuf),
    bytes: manifestBuf.length,
  };

  console.log(`  wrote ${slug}/manifest.json (${files.length} files)`);

  // ── Build ZIP ────────────────────────────────────────────────────────────

  const zipPath = path.join(outDir, "partner-pack.zip");
  await new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();

    // Add manifest first
    zipfile.addBuffer(manifestBuf, "manifest.json", { mtime: FIXED_DATE, compress: true });

    // Add all collected files in sorted order
    for (const f of files) {
      const filePath = path.join(outDir, f.path);
      zipfile.addFile(filePath, f.path, { mtime: FIXED_DATE, compress: true });
    }

    zipfile.end();

    const writeStream = fs.createWriteStream(zipPath);
    zipfile.outputStream.pipe(writeStream);
    writeStream.on("close", resolve);
    writeStream.on("error", reject);
  });

  const zipSize = fs.statSync(zipPath).size;
  console.log(`  wrote ${slug}/partner-pack.zip (${(zipSize / 1024).toFixed(1)} KB)`);
  console.log(`  ✓ ${slug} partner pack complete`);
}

console.log(`\nDone. ${enabledSlugs.length} partner pack(s) generated.`);

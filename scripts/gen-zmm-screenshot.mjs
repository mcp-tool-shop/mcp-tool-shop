#!/usr/bin/env node

/**
 * Generate a "real" screenshot for zip-meta-map showing actual build output.
 * Renders an SVG dashboard → 1280×640 PNG via sharp.
 *
 * Usage:
 *   node scripts/gen-zmm-screenshot.mjs [path-to-META_ZIP_INDEX.json]
 *
 * If no path given, runs `python -m zip_meta_map.cli build` on the
 * zip-meta-map repo at F:\AI\zip-meta-map and uses that index.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "site", "public", "screenshots", "zip-meta-map.png");

const WIDTH = 1280;
const HEIGHT = 640;

// Dark theme
const BG = "#0d1117";
const BG_SURFACE = "#161b22";
const BORDER = "#21262d";
const TEXT = "#f0f6fc";
const TEXT_DIM = "#c9d1d9";
const TEXT_MUTED = "#8b949e";
const GREEN = "#7ee787";
const GREEN_BG = "#1b3a2d";
const BLUE = "#58a6ff";
const CYAN = "#79c0ff";
const PURPLE = "#bc8cff";
const ORANGE = "#f0883e";
const PINK = "#f778ba";
const LAVENDER = "#d2a8ff";
const GRAY = "#484f58";

const ROLE_COLORS = {
  test: "#3fb950",
  doc: "#58a6ff",
  config: "#bc8cff",
  source: "#f0883e",
  fixture: "#d2a8ff",
  data: "#79c0ff",
  schema: "#7ee787",
  ci: "#f778ba",
  unknown: "#484f58",
  asset: "#d29922",
  public_api: "#58a6ff",
  entrypoint: "#f0883e",
};

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getIndex(indexPath) {
  if (indexPath && fs.existsSync(indexPath)) {
    return JSON.parse(fs.readFileSync(indexPath, "utf8"));
  }

  // Build from local repo
  const zmm = "F:\\AI\\zip-meta-map";
  const tmpDir = path.join(process.env.TEMP || "/tmp", "zmm-screenshot");
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log("Building index from", zmm);
  execSync(`python -m zip_meta_map.cli build "${zmm}" -o "${tmpDir}"`, {
    stdio: "pipe",
    cwd: zmm,
  });

  return JSON.parse(
    fs.readFileSync(path.join(tmpDir, "META_ZIP_INDEX.json"), "utf8")
  );
}

function buildSvg(index) {
  const profile = index.profile || "unknown";
  const version = index.generator?.split("/")?.[1] || "0.2.0";
  const files = index.files || [];
  const fileCount = files.length;
  const modules = index.modules || [];
  const moduleCount = modules.length;
  const plansObj = index.plans || {};
  const plans = Object.entries(plansObj).map(([name, p]) => ({
    name,
    budget_kb: p.budget_bytes ? Math.round(p.budget_bytes / 1024) : null,
    steps: p.steps || [],
  }));
  const planCount = plans.length;
  const capabilities = index.capabilities || [];
  const warnings = index.warnings || [];

  // Role distribution
  const roleCounts = {};
  for (const f of files) {
    const role = f.role || "unknown";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }
  const roles = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxRoleCount = roles[0]?.[1] || 1;

  // Flagged files
  const flaggedCount = files.filter(
    (f) => f.risk_flags && f.risk_flags.length > 0
  ).length;

  // ─── Header ────────────────────────────────────────────
  const header = `
    <rect x="0" y="0" width="${WIDTH}" height="60" fill="${BG}"/>
    <line x1="0" y1="60" x2="${WIDTH}" y2="60" stroke="${BORDER}" stroke-width="1"/>
    <text x="40" y="40" font-family="'Segoe UI', system-ui, sans-serif" font-size="28" font-weight="700" fill="${TEXT}">zip-meta-map</text>
    <rect x="240" y="20" rx="12" width="68" height="26" fill="${GREEN_BG}"/>
    <text x="274" y="38" text-anchor="middle" font-family="'Segoe UI', system-ui, sans-serif" font-size="14" font-weight="600" fill="${GREEN}">v${esc(version)}</text>
    <text x="${WIDTH - 40}" y="40" text-anchor="end" font-family="'Segoe UI', system-ui, sans-serif" font-size="14" fill="${TEXT_MUTED}">zip-meta-map build .  |  profile: ${esc(profile)}  |  ${fileCount} files  |  ${moduleCount} modules</text>
  `;

  // ─── Stats bar ─────────────────────────────────────────
  const statsY = 76;
  const statsH = 70;
  const statItems = [
    { num: fileCount, label: "FILES" },
    { num: moduleCount, label: "MODULES" },
    { num: planCount, label: "PLANS" },
    { num: flaggedCount, label: "FLAGGED" },
  ];
  const statsCard = `
    <rect x="32" y="${statsY}" width="${WIDTH - 64}" height="${statsH}" rx="8" fill="${BG_SURFACE}" stroke="${BORDER}" stroke-width="1"/>
    ${statItems
      .map((s, i) => {
        const cx = 32 + (WIDTH - 64) * ((i + 0.5) / statItems.length);
        return `
      <text x="${cx}" y="${statsY + 34}" text-anchor="middle" font-family="'Segoe UI', system-ui, sans-serif" font-size="32" font-weight="700" fill="${TEXT}">${s.num}</text>
      <text x="${cx}" y="${statsY + 54}" text-anchor="middle" font-family="'Segoe UI', system-ui, sans-serif" font-size="12" letter-spacing="1" fill="${TEXT_MUTED}">${s.label}</text>`;
      })
      .join("")}
  `;

  // ─── Role distribution card (left) ────────────────────
  const cardY = 164;
  const cardH = 290;
  const barMaxW = 200;
  const rolesCard = `
    <rect x="32" y="${cardY}" width="${(WIDTH - 80) / 2}" height="${cardH}" rx="8" fill="${BG_SURFACE}" stroke="${BORDER}" stroke-width="1"/>
    <text x="56" y="${cardY + 28}" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="1" fill="${TEXT_MUTED}">ROLE DISTRIBUTION</text>
    ${roles
      .map((r, i) => {
        const ry = cardY + 52 + i * 30;
        const barW = Math.max(4, (r[1] / maxRoleCount) * barMaxW);
        const color = ROLE_COLORS[r[0]] || GRAY;
        return `
      <text x="148" y="${ry + 13}" text-anchor="end" font-family="Consolas, 'Cascadia Code', monospace" font-size="13" fill="${TEXT_MUTED}">${esc(r[0])}</text>
      <rect x="160" y="${ry}" width="${barW}" height="18" rx="3" fill="${color}"/>
      <text x="${164 + barW}" y="${ry + 13}" font-family="Consolas, 'Cascadia Code', monospace" font-size="12" fill="${TEXT_DIM}">${r[1]}</text>`;
      })
      .join("")}
  `;

  // ─── Plans card (right top) ────────────────────────────
  const rightX = 32 + (WIDTH - 80) / 2 + 16;
  const rightW = (WIDTH - 80) / 2;
  const plansCardH = plans.length > 0 ? 40 + plans.length * 28 : 80;
  const plansCard = `
    <rect x="${rightX}" y="${cardY}" width="${rightW}" height="${plansCardH}" rx="8" fill="${BG_SURFACE}" stroke="${BORDER}" stroke-width="1"/>
    <text x="${rightX + 24}" y="${cardY + 28}" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="1" fill="${TEXT_MUTED}">LLM PLANS</text>
    ${plans
      .map((p, i) => {
        const py = cardY + 52 + i * 28;
        const budget = p.budget_kb ? `~${p.budget_kb} KB` : "";
        const steps = p.steps ? `${p.steps.length} steps` : "";
        return `
      <text x="${rightX + 24}" y="${py + 13}" font-family="Consolas, 'Cascadia Code', monospace" font-size="13" fill="${CYAN}">${esc(p.name)}</text>
      <text x="${rightX + rightW - 120}" y="${py + 13}" text-anchor="end" font-family="Consolas, 'Cascadia Code', monospace" font-size="13" fill="${TEXT_MUTED}">${budget}</text>
      <text x="${rightX + rightW - 24}" y="${py + 13}" text-anchor="end" font-family="Consolas, 'Cascadia Code', monospace" font-size="13" fill="${TEXT_DIM}">${steps}</text>`;
      })
      .join("")}
  `;

  // ─── Capabilities card (right bottom) ──────────────────
  const capY = cardY + plansCardH + 12;
  const capH = 60;
  const badgeGap = 10;
  let bx = rightX + 24;
  const capBadges = capabilities
    .map((c) => {
      const tw = c.length * 7.5 + 24;
      const el = `
      <rect x="${bx}" y="${capY + 32}" width="${tw}" height="22" rx="11" fill="${GREEN_BG}"/>
      <text x="${bx + tw / 2}" y="${capY + 47}" text-anchor="middle" font-family="'Segoe UI', system-ui, sans-serif" font-size="12" font-weight="600" fill="${GREEN}">${esc(c)}</text>`;
      bx += tw + badgeGap;
      return el;
    })
    .join("");

  const capsCard = `
    <rect x="${rightX}" y="${capY}" width="${rightW}" height="${capH}" rx="8" fill="${BG_SURFACE}" stroke="${BORDER}" stroke-width="1"/>
    <text x="${rightX + 24}" y="${capY + 24}" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" font-weight="600" letter-spacing="1" fill="${TEXT_MUTED}">CAPABILITIES</text>
    ${capBadges}
  `;

  // ─── Footer ────────────────────────────────────────────
  const footerY = HEIGHT - 36;
  const footer = `
    <line x1="0" y1="${footerY - 8}" x2="${WIDTH}" y2="${footerY - 8}" stroke="${BORDER}" stroke-width="1"/>
    <text x="40" y="${footerY + 10}" font-family="Consolas, 'Cascadia Code', monospace" font-size="12" fill="${GRAY}">$ pipx install zip-meta-map &amp;&amp; zip-meta-map build .</text>
    <text x="${WIDTH - 40}" y="${footerY + 10}" text-anchor="end" font-family="'Segoe UI', system-ui, sans-serif" font-size="12" fill="${GRAY}">mcptoolshop.com/tools/zip-meta-map</text>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  ${header}
  ${statsCard}
  ${rolesCard}
  ${plansCard}
  ${capsCard}
  ${footer}
</svg>`;
}

async function main() {
  const indexPath = process.argv[2] || null;
  const index = getIndex(indexPath);

  console.log(
    `Index: ${index.files.length} files, ${(index.modules || []).length} modules, ${(index.plans || []).length} plans`
  );

  const svg = buildSvg(index);

  // Write SVG for debugging
  const svgPath = OUT_PATH.replace(".png", ".svg");
  fs.writeFileSync(svgPath, svg);
  console.log("Wrote SVG:", svgPath);

  // Render to PNG via sharp
  const sharp = (await import("sharp")).default;
  await sharp(Buffer.from(svg))
    .resize(WIDTH, HEIGHT)
    .png()
    .toFile(OUT_PATH);

  console.log("Wrote PNG:", OUT_PATH);

  // Clean up SVG
  fs.unlinkSync(svgPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * promo-kit CLI
 *
 * Portable promotion engine for tool catalogs.
 *
 * Usage:
 *   promo-kit init [--dry-run] [--force]
 *   promo-kit selftest [--skip-build] [--skip-invariants]
 *   promo-kit migrate
 *   promo-kit --print-config
 *   promo-kit --version
 *   promo-kit --help
 */

import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const SCRIPTS = join(PKG_ROOT, "scripts");

const args = process.argv.slice(2);
const command = args[0];

// ── --version ───────────────────────────────────────────────

if (args.includes("--version") || args.includes("-v")) {
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
  console.log(`${pkg.name} v${pkg.version}`);
  process.exit(0);
}

// ── --help ──────────────────────────────────────────────────

if (!command || args.includes("--help") || args.includes("-h")) {
  console.log(`
  @mcptoolshop/promo-kit — Portable promotion engine for tool catalogs

  Usage:
    promo-kit init [--dry-run] [--force]   Bootstrap seed files (auto-creates kit.config.json)
    promo-kit selftest                     Validate config, seeds, and dry-runs
    promo-kit migrate                      Apply schema version upgrades
    promo-kit --print-config               Show resolved config after defaults
    promo-kit --version                    Show version
    promo-kit --help                       Show this help

  Environment:
    KIT_CONFIG=/path/to/kit.config.json    Point at an alternate config root
`.trimEnd());
  process.exit(0);
}

// ── Config resolution ───────────────────────────────────────

const cwdConfig = resolve(process.cwd(), "kit.config.json");

function resolveConfig() {
  if (process.env.KIT_CONFIG) return; // already set
  if (existsSync(cwdConfig)) {
    process.env.KIT_CONFIG = cwdConfig;
  }
}

// ── --print-config ──────────────────────────────────────────

if (args.includes("--print-config")) {
  resolveConfig();
  const { getConfig, getRoot } = await import(pathToFileURL(join(SCRIPTS, "lib", "config.mjs")).href);
  console.log("Root:", getRoot());
  console.log(JSON.stringify(getConfig(), null, 2));
  process.exit(0);
}

// ── init ────────────────────────────────────────────────────

if (command === "init") {
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  // Auto-create kit.config.json if absent
  if (!process.env.KIT_CONFIG && !existsSync(cwdConfig)) {
    const exampleConfig = join(PKG_ROOT, "kit.config.example.json");
    if (dryRun) {
      console.log("[dry-run] Would create kit.config.json from template");
      console.log("[dry-run] Would bootstrap seed files in current directory");
      process.exit(0);
    }
    copyFileSync(exampleConfig, cwdConfig);
    console.log("Created kit.config.json from template.");
    console.log("  Edit these fields: org.name, org.account, site.title, contact.email\n");
    process.env.KIT_CONFIG = cwdConfig;
  } else if (process.env.KIT_CONFIG) {
    // KIT_CONFIG already set, use it
  } else if (existsSync(cwdConfig)) {
    if (!force) {
      console.log("kit.config.json already exists (use --force to overwrite).");
    } else {
      const exampleConfig = join(PKG_ROOT, "kit.config.example.json");
      copyFileSync(exampleConfig, cwdConfig);
      console.log("Overwrote kit.config.json from template.");
    }
    process.env.KIT_CONFIG = cwdConfig;
  }

  const child = fork(join(SCRIPTS, "kit-bootstrap.mjs"), [], {
    env: { ...process.env },
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (code === 0) {
      console.log("\nNext: promo-kit selftest");
    }
    process.exit(code);
  });
}

// ── selftest ────────────────────────────────────────────────

else if (command === "selftest") {
  resolveConfig();
  const childArgs = args.slice(1); // forward flags like --skip-build
  const child = fork(join(SCRIPTS, "kit-selftest.mjs"), childArgs, {
    env: { ...process.env },
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code));
}

// ── migrate ─────────────────────────────────────────────────

else if (command === "migrate") {
  resolveConfig();
  const child = fork(join(SCRIPTS, "kit-migrate.mjs"), [], {
    env: { ...process.env },
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code));
}

// ── unknown command ─────────────────────────────────────────

else {
  console.error(`Unknown command: ${command}`);
  console.error("Run promo-kit --help for usage.");
  process.exit(1);
}

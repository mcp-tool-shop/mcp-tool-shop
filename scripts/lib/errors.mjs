/**
 * Friendly error helpers for marketing pipeline scripts.
 *
 * Error codes follow the pattern: MKT.<AREA>.<KIND>
 *
 * Areas:
 *   FETCH   — network / HTTP / download failures
 *   DATA    — JSON parse, missing files, bad shapes
 *   HASH    — integrity verification (lockfile, evidence)
 *   GEN     — generator failures (presskit, go-links, etc.)
 *   AUTH    — token / permission issues
 *
 * Kinds:
 *   MISSING — expected file/resource not found
 *   INVALID — data exists but is wrong shape/format
 *   MISMATCH — hash or size doesn't match expected
 *   NETWORK — HTTP or DNS failure
 *   DENIED  — 401/403 or missing token
 *   QUOTA   — rate limit exceeded
 *
 * Usage:
 *   import { fail, warn } from "./lib/errors.mjs";
 *
 *   fail("MKT.DATA.MISSING", "overrides.json not found", {
 *     fix: "Run `node scripts/sync-org-metadata.mjs` first.",
 *     path: "site/src/data/overrides.json",
 *   });
 *
 *   warn("MKT.FETCH.DENIED", "Traffic API returned 403", {
 *     fix: "Set GITHUB_TOKEN with repo scope for traffic data.",
 *     nerd: "Traffic endpoint requires push access to the repo.",
 *   });
 */

const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// Detect NO_COLOR / CI environments
const useColor =
  !process.env.NO_COLOR && !process.env.CI && process.stderr.isTTY;

function c(code, text) {
  return useColor ? `${code}${text}${RESET}` : text;
}

/**
 * Format and print an error block, then exit.
 *
 * @param {string} code    MKT.AREA.KIND error code
 * @param {string} headline  One-line description of what went wrong
 * @param {object} [opts]
 * @param {string} [opts.fix]   What the user should do to fix it
 * @param {string} [opts.path]  File path involved (for context)
 * @param {string} [opts.nerd]  Technical detail for debugging
 * @param {number} [opts.exitCode=1]  Process exit code
 */
export function fail(code, headline, opts = {}) {
  const { fix, path, nerd, exitCode = 1 } = opts;

  const lines = [];
  lines.push("");
  lines.push(c(RED, `  ${c(BOLD, code)}  ${headline}`));
  if (path) lines.push(c(DIM, `  file: ${path}`));
  if (fix) lines.push(`  fix:  ${fix}`);
  if (nerd) lines.push(c(DIM, `  nerd: ${nerd}`));
  lines.push("");

  console.error(lines.join("\n"));
  process.exit(exitCode);
}

/**
 * Format and print a warning block. Does NOT exit.
 *
 * @param {string} code    MKT.AREA.KIND error code
 * @param {string} headline  One-line description
 * @param {object} [opts]
 * @param {string} [opts.fix]   Suggested fix
 * @param {string} [opts.path]  File path involved
 * @param {string} [opts.nerd]  Technical detail
 */
export function warn(code, headline, opts = {}) {
  const { fix, path, nerd } = opts;

  const lines = [];
  lines.push(c(YELLOW, `  ${c(BOLD, code)}  ${headline}`));
  if (path) lines.push(c(DIM, `  file: ${path}`));
  if (fix) lines.push(`  fix:  ${fix}`);
  if (nerd) lines.push(c(DIM, `  nerd: ${nerd}`));

  console.warn(lines.join("\n"));
}

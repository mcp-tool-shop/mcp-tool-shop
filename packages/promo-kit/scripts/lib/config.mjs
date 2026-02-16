/**
 * Kit configuration loader.
 *
 * Reads kit.config.json from the repo root and deep-merges with defaults.
 * All scripts in the portable core import from here instead of hardcoding values.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Defaults ─────────────────────────────────────────────────

const DEFAULTS = {
  kitVersion: 1,
  org: { name: "", account: "", url: "" },
  site: { title: "", url: "", description: "" },
  repo: { marketing: "" },
  contact: { email: "" },
  paths: { dataDir: "site/src/data", publicDir: "site/public" },
  guardrails: {
    maxDataPatchesPerRun: 5,
    dailyTelemetryCapPerType: 50,
    spikeThreshold: 300,
    maxRecommendations: 20,
  },
};

export const KIT_VERSION_SUPPORTED = [1, 1]; // [min, max]

// ── Deep merge ───────────────────────────────────────────────

function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object") {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Loader ───────────────────────────────────────────────────

/**
 * Load kit config from a specific root directory.
 * @param {string} root - repo root path
 * @returns {object} merged config
 */
export function loadKitConfig(root) {
  const configPath = join(root, "kit.config.json");
  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    return deepMerge(DEFAULTS, raw);
  } catch {
    return { ...DEFAULTS };
  }
}

// ── Cached singleton ─────────────────────────────────────────

let _cached = null;
let _cachedRoot = null;

/**
 * Find the kit root directory.
 * Priority: KIT_CONFIG env var > walk up from scripts/lib/ > fallback 2 levels up.
 */
function findRoot() {
  // 1. KIT_CONFIG env var takes precedence
  if (process.env.KIT_CONFIG) {
    const envPath = resolve(process.env.KIT_CONFIG);
    if (existsSync(envPath)) return dirname(envPath);
    console.warn(
      `  \u26A0 KIT_CONFIG="${process.env.KIT_CONFIG}" not found, falling back to auto-discovery`
    );
  }

  // 2. Walk up from scripts/lib/ looking for kit.config.json
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "kit.config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 3. Fallback: assume scripts/lib/ is 2 levels deep from root
  return resolve(thisDir, "..", "..");
}

/**
 * Get the kit root directory. Prefers KIT_CONFIG env var, then auto-discovery.
 * Use this for data/config path resolution in portable core scripts.
 * @returns {string} absolute root path
 */
export function getRoot() {
  return findRoot();
}

/**
 * Get the kit config singleton. Discovers repo root automatically.
 * @returns {object} merged config
 */
export function getConfig() {
  const root = findRoot();
  if (_cached && _cachedRoot === root) return _cached;
  _cached = loadKitConfig(root);
  _cachedRoot = root;
  return _cached;
}

/**
 * Reset the cached config (for testing).
 */
export function resetConfigCache() {
  _cached = null;
  _cachedRoot = null;
}

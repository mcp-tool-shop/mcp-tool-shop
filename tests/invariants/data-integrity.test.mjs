/**
 * Data Integrity / Invariant Tests
 *
 * Cross-referential checks on the site data files.
 * These catch "impossible states" and broken references.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateUrl } from "../../scripts/lib/sanitize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../site/src/data");

function loadJson(relPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, relPath), "utf8"));
  } catch {
    return null;
  }
}

// Load all data files once
let projects, overrides, collections, orgStats, links, releases;

before(() => {
  projects = loadJson("projects.json");
  overrides = loadJson("overrides.json");
  collections = loadJson("collections.json");
  orgStats = loadJson("org-stats.json");
  links = loadJson("links.json");
  releases = loadJson("releases.json");
});

describe("projects.json", () => {
  it("exists and is a non-empty array", () => {
    assert.ok(Array.isArray(projects), "projects.json must be an array");
    assert.ok(projects.length > 0, "projects.json must not be empty");
  });

  it("every project has required fields", () => {
    for (const p of projects) {
      assert.ok(p.repo, `project missing repo: ${JSON.stringify(p).slice(0, 50)}`);
      assert.ok(typeof p.registered === "boolean", `${p.repo}: registered must be boolean`);
      assert.ok(typeof p.unlisted === "boolean", `${p.repo}: unlisted must be boolean`);
      assert.ok(typeof p.deprecated === "boolean", `${p.repo}: deprecated must be boolean`);
    }
  });

  it("no project is both registered and unlisted", () => {
    const violations = projects.filter((p) => p.registered && p.unlisted);
    assert.equal(
      violations.length,
      0,
      `registered + unlisted conflict: ${violations.map((p) => p.repo).join(", ")}`
    );
  });

  it("no duplicate repos", () => {
    const repos = projects.map((p) => p.repo);
    const dupes = repos.filter((r, i) => repos.indexOf(r) !== i);
    assert.equal(dupes.length, 0, `duplicate repos: ${dupes.join(", ")}`);
  });
});

describe("overrides.json", () => {
  it("exists and is an object", () => {
    assert.ok(overrides && typeof overrides === "object");
  });

  it("every override key exists in projects.json (except registry)", () => {
    const projectRepos = new Set(projects.map((p) => p.repo));
    // mcp-tool-registry is the registry repo, not a tool — allowed as override
    const ALLOWED_ORPHANS = new Set(["mcp-tool-registry"]);
    const orphans = Object.keys(overrides).filter(
      (k) => !projectRepos.has(k) && !ALLOWED_ORPHANS.has(k)
    );
    assert.equal(
      orphans.length,
      0,
      `override keys with no project: ${orphans.join(", ")}`
    );
  });
});

describe("collections.json", () => {
  it("exists and is a non-empty array", () => {
    assert.ok(Array.isArray(collections));
    assert.ok(collections.length > 0);
  });

  it("every collection repo exists in projects.json", () => {
    const projectRepos = new Set(projects.map((p) => p.repo));
    const missing = [];
    for (const col of collections) {
      for (const repo of col.repos || []) {
        if (!projectRepos.has(repo)) {
          missing.push(`${col.id} -> ${repo}`);
        }
      }
    }
    assert.equal(
      missing.length,
      0,
      `collection refs to missing projects: ${missing.join(", ")}`
    );
  });

  it("no duplicate collection IDs", () => {
    const ids = collections.map((c) => c.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.equal(dupes.length, 0, `duplicate collection IDs: ${dupes.join(", ")}`);
  });
});

describe("links.json", () => {
  it("exists and has links array", () => {
    assert.ok(links?.links, "links.json must have links array");
  });

  it("all link targets are valid https/http URLs", () => {
    for (const link of links.links) {
      assert.doesNotThrow(
        () => validateUrl(link.target, { label: `link ${link.id}` }),
        `link ${link.id}: invalid target "${link.target}"`
      );
    }
  });

  it("no duplicate link IDs", () => {
    const ids = links.links.map((l) => l.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.equal(dupes.length, 0, `duplicate link IDs: ${dupes.join(", ")}`);
  });
});

describe("org-stats.json", () => {
  it("exists and has expected shape", () => {
    assert.ok(orgStats, "org-stats.json must exist");
    assert.ok(typeof orgStats.totalStars === "number", "must have totalStars");
    assert.ok(typeof orgStats.repoCount === "number", "must have repoCount");
  });

  it("totalStars >= sum of project stars", () => {
    const sumStars = projects.reduce((s, p) => s + (p.stars || 0), 0);
    assert.ok(
      orgStats.totalStars >= sumStars,
      `totalStars (${orgStats.totalStars}) < sum of project stars (${sumStars})`
    );
  });
});

describe("releases.json", () => {
  it("exists and is a non-empty array", () => {
    assert.ok(Array.isArray(releases), "releases.json must be an array");
  });

  it("every release has repo and tag", () => {
    for (const r of releases) {
      assert.ok(r.repo, `release missing repo`);
      assert.ok(r.tag, `${r.repo}: release missing tag`);
    }
  });
});

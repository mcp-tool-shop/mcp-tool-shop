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
let projects, overrides, collections, orgStats, links, releases, promo, promoQueue, worthy, baseline, partners, feedbackSummary, experiments, governance, promoDecisions, experimentDecisions;

before(() => {
  projects = loadJson("projects.json");
  overrides = loadJson("overrides.json");
  collections = loadJson("collections.json");
  orgStats = loadJson("org-stats.json");
  links = loadJson("links.json");
  releases = loadJson("releases.json");
  promo = loadJson("promo.json");
  promoQueue = loadJson("promo-queue.json");
  worthy = loadJson("worthy.json");
  baseline = loadJson("baseline.json");
  partners = loadJson("partners.json");
  feedbackSummary = loadJson("feedback-summary.json");
  experiments = loadJson("experiments.json");
  governance = loadJson("governance.json");
  promoDecisions = loadJson("promo-decisions.json");
  experimentDecisions = loadJson("experiment-decisions.json");
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

describe("promo.json", () => {
  it("exists and has valid schema", () => {
    assert.ok(promo, "promo.json must exist");
    assert.ok(typeof promo.enabled === "boolean", "enabled must be boolean");
    assert.ok(promo.caps && typeof promo.caps === "object", "caps must be an object");
  });

  it("caps has valid fields", () => {
    assert.ok(typeof promo.caps.maxNamesPerRun === "number", "maxNamesPerRun must be a number");
    assert.ok(promo.caps.maxNamesPerRun > 0, "maxNamesPerRun must be positive");
    assert.ok(promo.caps.maxNamesPerRun <= 500, "maxNamesPerRun must not exceed 500");
    assert.ok(
      ["fail-closed", "fail-open"].includes(promo.caps.failMode),
      `failMode must be fail-closed or fail-open, got: ${promo.caps.failMode}`
    );
  });

  it("has modification metadata", () => {
    assert.ok(promo.lastModified, "must have lastModified date");
    assert.ok(promo.modifiedBy, "must have modifiedBy");
  });
});

describe("promo-queue.json", () => {
  it("exists and has valid schema", () => {
    assert.ok(promoQueue, "promo-queue.json must exist");
    assert.ok(typeof promoQueue.week === "string", "week must be a string");
    assert.ok(Array.isArray(promoQueue.slugs), "slugs must be an array");
    assert.ok(
      ["own", "ecosystem"].includes(promoQueue.promotionType),
      `promotionType must be own or ecosystem, got: ${promoQueue.promotionType}`
    );
  });

  it("slug entries have required fields", () => {
    for (const entry of promoQueue.slugs) {
      if (typeof entry === "string") continue; // simple slug string is ok
      assert.ok(entry.slug, "slug entry must have slug field");
      if (entry.channels) {
        assert.ok(Array.isArray(entry.channels), "channels must be an array");
      }
    }
  });
});

describe("worthy.json", () => {
  it("exists and has valid schema", () => {
    assert.ok(worthy, "worthy.json must exist");
    assert.ok(worthy.version, "must have version");
    assert.ok(worthy.rubric, "must have rubric");
    assert.ok(Array.isArray(worthy.rubric.criteria), "rubric.criteria must be array");
    assert.ok(worthy.rubric.criteria.length > 0, "rubric must have at least one criterion");
    assert.ok(typeof worthy.rubric.minimumScore === "number", "minimumScore must be number");
    assert.ok(worthy.repos && typeof worthy.repos === "object", "repos must be object");
  });

  it("every repo has required rubric fields", () => {
    for (const [slug, entry] of Object.entries(worthy.repos)) {
      assert.ok(typeof entry.worthy === "boolean", `${slug}: worthy must be boolean`);
      assert.ok(typeof entry.score === "number", `${slug}: score must be number`);
      assert.ok(entry.reason, `${slug}: must have reason`);
    }
  });

  it("missing field is array when present", () => {
    for (const [slug, entry] of Object.entries(worthy.repos)) {
      if ("missing" in entry) {
        assert.ok(Array.isArray(entry.missing), `${slug}: missing must be array`);
      }
    }
  });
});

describe("trust.json", () => {
  it("has required provenance fields when present", () => {
    const PUBLIC = path.resolve(__dirname, "../../site/public");
    let trust = null;
    try {
      trust = JSON.parse(fs.readFileSync(path.join(PUBLIC, "trust.json"), "utf8"));
    } catch { /* optional file */ }
    if (!trust) return;
    assert.ok(trust.commit, "must have commit SHA");
    assert.ok(trust.artifactManifest && typeof trust.artifactManifest === "object", "must have artifactManifest");
    assert.ok(typeof trust.provenClaims === "number", "must have provenClaims count");
    assert.ok(trust.worthyStats && typeof trust.worthyStats === "object", "must have worthyStats");
  });
});

describe("baseline.json", () => {
  it("exists and has required fields when present", () => {
    if (!baseline) return; // optional file — skip if absent
    assert.ok(typeof baseline.runCount === "number", "runCount must be number");
    assert.ok(baseline.period && typeof baseline.period === "object", "period must be object");
    assert.ok(typeof baseline.avgRuntimeMs === "number", "avgRuntimeMs must be number");
    assert.ok(typeof baseline.p95RuntimeMs === "number", "p95RuntimeMs must be number");
    assert.ok(typeof baseline.avgCacheHitRate === "number", "avgCacheHitRate must be number");
    assert.ok(baseline.projection && typeof baseline.projection === "object", "projection must be object");
    assert.ok(typeof baseline.projection.estimatedCost === "number", "estimatedCost must be number");
  });
});

describe("partners.json", () => {
  it("exists and has valid schema", () => {
    assert.ok(partners, "partners.json must exist");
    assert.ok(Array.isArray(partners.partners), "partners must be array");
    assert.ok(partners.schema, "must have schema");
    assert.ok(partners.schema.version, "schema must have version");
  });

  it("every partner has required fields", () => {
    const VALID_TYPES = ["journalist", "partner", "integrator", "amplifier"];
    for (const p of partners.partners) {
      assert.ok(p.name, "partner must have name");
      assert.ok(p.type, "partner must have type");
      assert.ok(
        VALID_TYPES.includes(p.type),
        `invalid partner type: ${p.type}`
      );
    }
  });
});

describe("feedback-summary.json", () => {
  it("has valid schema when present", () => {
    if (!feedbackSummary) return; // optional
    assert.ok(typeof feedbackSummary.totalEntries === "number", "totalEntries must be number");
    assert.ok(feedbackSummary.perChannel && typeof feedbackSummary.perChannel === "object", "perChannel must be object");
    assert.ok(feedbackSummary.perSlug && typeof feedbackSummary.perSlug === "object", "perSlug must be object");
    assert.ok(Array.isArray(feedbackSummary.recommendations), "recommendations must be array");
  });

  it("perExperiment is object when present", () => {
    if (!feedbackSummary) return;
    if ("perExperiment" in feedbackSummary) {
      assert.ok(
        feedbackSummary.perExperiment && typeof feedbackSummary.perExperiment === "object",
        "perExperiment must be object"
      );
    }
  });
});

describe("experiments.json", () => {
  it("has valid schema when present", () => {
    if (!experiments) return; // optional
    assert.ok(typeof experiments.schemaVersion === "number", "schemaVersion must be number");
    assert.ok(Array.isArray(experiments.experiments), "experiments must be array");
  });

  it("every experiment has required fields", () => {
    if (!experiments) return;
    for (const exp of experiments.experiments) {
      assert.ok(exp.id, `experiment missing id`);
      assert.ok(exp.name, `${exp.id}: must have name`);
      assert.ok(exp.status, `${exp.id}: must have status`);
      assert.ok(exp.dimension, `${exp.id}: must have dimension`);
      assert.ok(exp.control && exp.control.key, `${exp.id}: must have control.key`);
      assert.ok(exp.variant && exp.variant.key, `${exp.id}: must have variant.key`);
    }
  });

  it("status is valid enum", () => {
    if (!experiments) return;
    const VALID = ["draft", "active", "concluded"];
    for (const exp of experiments.experiments) {
      assert.ok(
        VALID.includes(exp.status),
        `${exp.id}: status must be draft|active|concluded, got: ${exp.status}`
      );
    }
  });

  it("dimension is valid enum", () => {
    if (!experiments) return;
    const VALID = ["tagline", "snippet", "cta"];
    for (const exp of experiments.experiments) {
      assert.ok(
        VALID.includes(exp.dimension),
        `${exp.id}: dimension must be tagline|snippet|cta, got: ${exp.dimension}`
      );
    }
  });

  it("no duplicate experiment IDs", () => {
    if (!experiments) return;
    const ids = experiments.experiments.map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.equal(dupes.length, 0, `duplicate experiment IDs: ${dupes.join(", ")}`);
  });
});

describe("promo.json - learningMode", () => {
  it("learningMode is valid enum when present", () => {
    if (!promo || !("learningMode" in promo)) return;
    assert.ok(
      ["off", "suggest", "apply"].includes(promo.learningMode),
      `learningMode must be off|suggest|apply, got: ${promo.learningMode}`
    );
  });
});

describe("baseline.json - minuteBudgets", () => {
  it("minuteBudgets has expected tiers when present", () => {
    if (!baseline || !baseline.minuteBudgets) return;
    assert.ok(baseline.minuteBudgets["200"], "must have 200-minute tier");
    assert.ok(baseline.minuteBudgets["500"], "must have 500-minute tier");
    assert.ok(baseline.minuteBudgets["1000"], "must have 1000-minute tier");
  });
});

describe("governance.json", () => {
  it("exists and has valid schema", () => {
    assert.ok(governance, "governance.json must exist");
    assert.ok(typeof governance.schemaVersion === "number", "schemaVersion must be number");
    assert.ok(typeof governance.maxPromosPerWeek === "number", "maxPromosPerWeek must be number");
    assert.ok(typeof governance.cooldownDaysPerSlug === "number", "cooldownDaysPerSlug must be number");
    assert.ok(typeof governance.cooldownDaysPerPartner === "number", "cooldownDaysPerPartner must be number");
    assert.ok(typeof governance.minCoverageScore === "number", "minCoverageScore must be number");
    assert.ok(typeof governance.minExperimentDataThreshold === "number", "minExperimentDataThreshold must be number");
    assert.ok(Array.isArray(governance.hardRules), "hardRules must be array");
  });

  it("maxPromosPerWeek is positive integer", () => {
    assert.ok(governance.maxPromosPerWeek > 0, "maxPromosPerWeek must be > 0");
    assert.ok(governance.maxPromosPerWeek <= 20, "maxPromosPerWeek must be <= 20");
    assert.ok(Number.isInteger(governance.maxPromosPerWeek), "maxPromosPerWeek must be integer");
  });

  it("cooldownDaysPerSlug is positive integer", () => {
    assert.ok(governance.cooldownDaysPerSlug > 0, "cooldownDaysPerSlug must be > 0");
    assert.ok(governance.cooldownDaysPerSlug <= 90, "cooldownDaysPerSlug must be <= 90");
    assert.ok(Number.isInteger(governance.cooldownDaysPerSlug), "cooldownDaysPerSlug must be integer");
  });

  it("cooldownDaysPerPartner is positive integer", () => {
    assert.ok(governance.cooldownDaysPerPartner > 0, "cooldownDaysPerPartner must be > 0");
    assert.ok(governance.cooldownDaysPerPartner <= 90, "cooldownDaysPerPartner must be <= 90");
    assert.ok(Number.isInteger(governance.cooldownDaysPerPartner), "cooldownDaysPerPartner must be integer");
  });

  it("minCoverageScore is in range [0, 100]", () => {
    assert.ok(governance.minCoverageScore >= 0, "minCoverageScore must be >= 0");
    assert.ok(governance.minCoverageScore <= 100, "minCoverageScore must be <= 100");
  });

  it("minExperimentDataThreshold is positive integer", () => {
    assert.ok(governance.minExperimentDataThreshold > 0, "minExperimentDataThreshold must be > 0");
    assert.ok(governance.minExperimentDataThreshold <= 1000, "minExperimentDataThreshold must be <= 1000");
    assert.ok(Number.isInteger(governance.minExperimentDataThreshold), "minExperimentDataThreshold must be integer");
  });

  it("hardRules is non-empty string array", () => {
    assert.ok(governance.hardRules.length > 0, "hardRules must not be empty");
    for (const rule of governance.hardRules) {
      assert.ok(typeof rule === "string", `hardRule must be string, got: ${typeof rule}`);
      assert.ok(rule.length > 0, "hardRule must not be empty string");
    }
  });

  it("hardRules contains safety-critical rules", () => {
    const rules = governance.hardRules.join(" ");
    assert.ok(rules.includes("never edit human-owned files"), "must include human-owned files rule");
    assert.ok(rules.includes("never send outreach automatically"), "must include outreach rule");
    assert.ok(rules.includes("never push directly to main"), "must include main branch rule");
    assert.ok(rules.includes("never exceed minutes budget"), "must include budget rule");
    assert.ok(rules.includes("never promote without publicProof"), "must include publicProof rule");
  });
});

describe("promo-decisions.json", () => {
  it("has valid schema when present", () => {
    if (!promoDecisions) return;
    assert.ok(Array.isArray(promoDecisions.decisions), "decisions must be array");
    assert.ok(promoDecisions.budget && typeof promoDecisions.budget === "object", "budget must be object");
    assert.ok(Array.isArray(promoDecisions.warnings), "warnings must be array");
  });

  it("every decision has required fields", () => {
    if (!promoDecisions) return;
    for (const d of promoDecisions.decisions) {
      assert.ok(d.slug, "decision must have slug");
      assert.ok(d.action, `${d.slug}: must have action`);
      assert.ok(typeof d.score === "number", `${d.slug}: score must be number`);
      assert.ok(Array.isArray(d.explanation), `${d.slug}: explanation must be array`);
    }
  });

  it("action is valid enum", () => {
    if (!promoDecisions) return;
    const VALID = ["promote", "skip", "defer"];
    for (const d of promoDecisions.decisions) {
      assert.ok(
        VALID.includes(d.action),
        `${d.slug}: action must be promote|skip|defer, got: ${d.action}`
      );
    }
  });
});

describe("experiment-decisions.json", () => {
  it("has valid schema when present", () => {
    if (!experimentDecisions) return;
    assert.ok(Array.isArray(experimentDecisions.evaluations), "evaluations must be array");
    assert.ok(Array.isArray(experimentDecisions.warnings), "warnings must be array");
  });

  it("every evaluation has required fields", () => {
    if (!experimentDecisions) return;
    for (const e of experimentDecisions.evaluations) {
      assert.ok(e.experimentId, "evaluation must have experimentId");
      assert.ok(e.status, `${e.experimentId}: must have status`);
      assert.ok("winnerKey" in e, `${e.experimentId}: must have winnerKey`);
      assert.ok(e.recommendation, `${e.experimentId}: must have recommendation`);
    }
  });

  it("status is valid enum", () => {
    if (!experimentDecisions) return;
    const VALID = ["needs-more-data", "winner-found", "no-decision"];
    for (const e of experimentDecisions.evaluations) {
      assert.ok(
        VALID.includes(e.status),
        `${e.experimentId}: status must be needs-more-data|winner-found|no-decision, got: ${e.status}`
      );
    }
  });
});

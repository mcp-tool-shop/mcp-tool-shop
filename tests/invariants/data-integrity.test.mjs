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
import { KIT_VERSION_SUPPORTED } from "../../scripts/lib/config.mjs";

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

// ── Phase 17 — Public Growth Surface invariants ──────────────

describe("trust.json - Phase 17 artifacts", () => {
  it("artifactManifest includes promo-decisions.json when trust.json exists", () => {
    const PUBLIC = path.resolve(__dirname, "../../site/public");
    let trust = null;
    try {
      trust = JSON.parse(fs.readFileSync(path.join(PUBLIC, "trust.json"), "utf8"));
    } catch { /* optional file */ }
    if (!trust) return;
    assert.ok(
      "promo-decisions.json" in trust.artifactManifest,
      "artifactManifest must include promo-decisions.json"
    );
  });

  it("artifactManifest includes experiment-decisions.json when trust.json exists", () => {
    const PUBLIC = path.resolve(__dirname, "../../site/public");
    let trust = null;
    try {
      trust = JSON.parse(fs.readFileSync(path.join(PUBLIC, "trust.json"), "utf8"));
    } catch { /* optional file */ }
    if (!trust) return;
    assert.ok(
      "experiment-decisions.json" in trust.artifactManifest,
      "artifactManifest must include experiment-decisions.json"
    );
  });
});

describe("now page data contract", () => {
  it("every promoted slug has publicProof in overrides", () => {
    if (!promoDecisions || !overrides) return;
    const promoted = (promoDecisions.decisions || []).filter((d) => d.action === "promote");
    for (const d of promoted) {
      const ov = overrides[d.slug];
      assert.ok(
        ov && ov.publicProof === true,
        `promoted slug "${d.slug}" must have publicProof: true in overrides`
      );
    }
  });

  it("promo-decisions generatedAt is valid ISO date", () => {
    if (!promoDecisions || !promoDecisions.generatedAt) return;
    const parsed = new Date(promoDecisions.generatedAt);
    assert.ok(!isNaN(parsed.getTime()), "generatedAt must be valid ISO date");
  });

  it("promo-decisions budget has required fields when present", () => {
    if (!promoDecisions || !promoDecisions.budget) return;
    const budget = promoDecisions.budget;
    assert.ok(typeof budget.tier === "number", "budget.tier must be number");
    assert.ok(typeof budget.headroom === "number", "budget.headroom must be number");
    assert.ok(typeof budget.itemsAllowed === "number", "budget.itemsAllowed must be number");
  });
});

describe("experiments page data contract", () => {
  it("every concluded experiment has a matching evaluation", () => {
    if (!experiments || !experimentDecisions) return;
    const evalIds = new Set((experimentDecisions.evaluations || []).map((e) => e.experimentId));
    const concluded = (experiments.experiments || []).filter((e) => e.status === "concluded");
    for (const exp of concluded) {
      assert.ok(
        evalIds.has(exp.id),
        `concluded experiment "${exp.id}" must have a matching evaluation`
      );
    }
  });

  it("experiment-decisions winnerKey matches control or variant key when winner-found", () => {
    if (!experiments || !experimentDecisions) return;
    const expLookup = {};
    for (const e of experiments.experiments || []) { expLookup[e.id] = e; }
    for (const ev of experimentDecisions.evaluations || []) {
      if (ev.status !== "winner-found") continue;
      const exp = expLookup[ev.experimentId];
      if (!exp) continue;
      const validKeys = [exp.control?.key, exp.variant?.key];
      assert.ok(
        validKeys.includes(ev.winnerKey),
        `${ev.experimentId}: winnerKey "${ev.winnerKey}" must be control or variant key`
      );
    }
  });

  it("experiment dimensions are limited to known set", () => {
    if (!experiments) return;
    const VALID = ["tagline", "snippet", "cta"];
    for (const exp of experiments.experiments || []) {
      assert.ok(
        VALID.includes(exp.dimension),
        `${exp.id}: dimension must be tagline|snippet|cta, got: ${exp.dimension}`
      );
    }
  });
});

describe("control panel data contract", () => {
  it("governance + promo + promo-queue all exist together", () => {
    // If any one exists, all should exist
    const exists = [governance, promo, promoQueue].filter(Boolean).length;
    assert.ok(
      exists === 0 || exists === 3,
      "governance, promo, and promo-queue must all exist or all be absent"
    );
  });

  it("governance maxPromosPerWeek >= promo-queue slugs length", () => {
    if (!governance || !promoQueue) return;
    const queueLen = (promoQueue.slugs || []).length;
    assert.ok(
      governance.maxPromosPerWeek >= queueLen,
      `maxPromosPerWeek (${governance.maxPromosPerWeek}) < queue length (${queueLen})`
    );
  });
});

// ── Phase 18 — Govern the Governors invariants ───────────────

describe("decision-drift.json", () => {
  it("has valid schema when present (entrants, exits, scoreDeltas are arrays)", () => {
    const drift = loadJson("decision-drift.json");
    if (!drift) return; // optional — absent on first run
    assert.ok(Array.isArray(drift.entrants), "entrants must be array");
    assert.ok(Array.isArray(drift.exits), "exits must be array");
    assert.ok(Array.isArray(drift.scoreDeltas), "scoreDeltas must be array");
    assert.ok(Array.isArray(drift.reasonChanges), "reasonChanges must be array");
    assert.ok(drift.summary && typeof drift.summary === "object", "summary must be object");
  });

  it("scoreDeltas have required fields (slug, prevScore, currScore, delta)", () => {
    const drift = loadJson("decision-drift.json");
    if (!drift || !drift.scoreDeltas || drift.scoreDeltas.length === 0) return;
    for (const d of drift.scoreDeltas) {
      assert.ok(d.slug, "scoreDelta must have slug");
      assert.ok(typeof d.prevScore === "number", `${d.slug}: prevScore must be number`);
      assert.ok(typeof d.currScore === "number", `${d.slug}: currScore must be number`);
      assert.ok(typeof d.delta === "number", `${d.slug}: delta must be number`);
    }
  });
});

describe("governance freeze consistency", () => {
  it("freeze fields are boolean when present", () => {
    if (!governance) return;
    if ("decisionsFrozen" in governance) {
      assert.ok(typeof governance.decisionsFrozen === "boolean", "decisionsFrozen must be boolean");
    }
    if ("experimentsFrozen" in governance) {
      assert.ok(typeof governance.experimentsFrozen === "boolean", "experimentsFrozen must be boolean");
    }
  });

  it("schemaVersion >= 2 when freeze fields are present", () => {
    if (!governance) return;
    if ("decisionsFrozen" in governance || "experimentsFrozen" in governance) {
      assert.ok(governance.schemaVersion >= 2, "schemaVersion must be >= 2 when freeze fields present");
    }
  });
});

describe("apply-control-patch contract", () => {
  it("governance.json hardRules cannot be empty", () => {
    if (!governance) return;
    assert.ok(Array.isArray(governance.hardRules), "hardRules must be array");
    assert.ok(governance.hardRules.length > 0, "hardRules must not be empty");
  });

  it("governance.json schemaVersion must be >= 1", () => {
    if (!governance) return;
    assert.ok(typeof governance.schemaVersion === "number", "schemaVersion must be number");
    assert.ok(governance.schemaVersion >= 1, "schemaVersion must be >= 1");
  });
});

describe("cross-page consistency", () => {
  it("no experiment in decisions references unknown experiment", () => {
    if (!experiments || !experimentDecisions) return;
    const knownIds = new Set((experiments.experiments || []).map((e) => e.id));
    for (const ev of experimentDecisions.evaluations || []) {
      assert.ok(
        knownIds.has(ev.experimentId),
        `evaluation references unknown experiment: ${ev.experimentId}`
      );
    }
  });

  it("promo-decisions and promo-calendar generatedAt within 7 days", () => {
    if (!promoDecisions || !promoDecisions.generatedAt) return;
    // Load promo-calendar if it exists
    const calPath = path.join(DATA, "promo-calendar.json");
    let promoCal = null;
    try { promoCal = JSON.parse(fs.readFileSync(calPath, "utf8")); } catch { /* optional */ }
    if (!promoCal || !promoCal.generatedAt) return;

    const d1 = new Date(promoDecisions.generatedAt).getTime();
    const d2 = new Date(promoCal.generatedAt).getTime();
    const diffDays = Math.abs(d1 - d2) / (1000 * 60 * 60 * 24);
    assert.ok(
      diffDays <= 7,
      `promo-decisions and promo-calendar are ${Math.round(diffDays)} days apart (max 7)`
    );
  });
});

// ── Phase 19: Receipts + Trust Page Contract ────────────────

describe("promo-week receipts contract", () => {
  const outreachDir = path.resolve(__dirname, "../../site/public/outreach-run");
  let receiptFiles = [];
  try {
    if (fs.existsSync(outreachDir)) {
      const dirs = fs.readdirSync(outreachDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name));
      for (const d of dirs) {
        const rp = path.join(outreachDir, d.name, "promo-week-receipt.json");
        if (fs.existsSync(rp)) {
          receiptFiles.push({ path: rp, week: d.name, data: JSON.parse(fs.readFileSync(rp, "utf8")) });
        }
      }
    }
  } catch { /* fail soft */ }

  it("every receipt has required fields (week, generatedAt, inputs)", () => {
    for (const rf of receiptFiles) {
      assert.ok(rf.data.week, `receipt ${rf.week} missing week`);
      assert.ok(rf.data.generatedAt, `receipt ${rf.week} missing generatedAt`);
      assert.ok(rf.data.inputs, `receipt ${rf.week} missing inputs`);
    }
  });

  it("receipt input hashes use sha256: prefix when present", () => {
    for (const rf of receiptFiles) {
      const inputs = rf.data.inputs || {};
      for (const [key, value] of Object.entries(inputs)) {
        if (typeof value === "string" && value.length > 10) {
          assert.ok(
            value.startsWith("sha256:"),
            `receipt ${rf.week} input ${key} missing sha256: prefix`
          );
        }
      }
    }
  });

  it("receipt week format matches YYYY-MM-DD", () => {
    for (const rf of receiptFiles) {
      assert.match(rf.data.week, /^\d{4}-\d{2}-\d{2}$/, `receipt ${rf.week} has invalid week format`);
    }
  });
});

describe("trust page contract", () => {
  it("governance.json freeze fields exist and are boolean", () => {
    if (!governance) return;
    assert.ok("decisionsFrozen" in governance, "governance missing decisionsFrozen");
    assert.ok("experimentsFrozen" in governance, "governance missing experimentsFrozen");
    assert.equal(typeof governance.decisionsFrozen, "boolean");
    assert.equal(typeof governance.experimentsFrozen, "boolean");
  });

  it("trust.json commit field is non-empty string when present", () => {
    const trustPath = path.resolve(__dirname, "../../site/public/trust.json");
    if (!fs.existsSync(trustPath)) return;
    const trust = JSON.parse(fs.readFileSync(trustPath, "utf8"));
    if (trust.commit) {
      assert.equal(typeof trust.commit, "string");
      assert.ok(trust.commit.length > 0, "trust.json commit must not be empty");
    }
  });
});

// ── Phase 20: Submissions Contract ──────────────────────────

const telemetrySchema = loadJson("telemetry-schema.json");
const telemetryRollup = loadJson("telemetry/rollup.json");
const queueHealthData = loadJson("queue-health.json");
const submissionsData = loadJson("submissions.json");

describe("submissions.json", () => {
  it("exists and has submissions array", () => {
    assert.ok(submissionsData, "submissions.json must exist");
    assert.ok(Array.isArray(submissionsData.submissions), "submissions must be an array");
  });

  it("every submission has required fields (slug, status, lane, submittedAt)", () => {
    for (const s of submissionsData?.submissions || []) {
      assert.ok(s.slug, `submission missing slug`);
      assert.ok(s.status, `${s.slug}: missing status`);
      assert.ok(s.lane, `${s.slug}: missing lane`);
      assert.ok(s.submittedAt, `${s.slug}: missing submittedAt`);
    }
  });

  it("status is valid enum (pending, accepted, rejected, withdrawn, needs-info)", () => {
    const VALID = ["pending", "accepted", "rejected", "withdrawn", "needs-info"];
    for (const s of submissionsData?.submissions || []) {
      assert.ok(VALID.includes(s.status), `${s.slug}: invalid status "${s.status}"`);
    }
  });

  it("lane is valid enum (promo, experiment)", () => {
    const VALID = ["promo", "experiment"];
    for (const s of submissionsData?.submissions || []) {
      assert.ok(VALID.includes(s.lane), `${s.slug}: invalid lane "${s.lane}"`);
    }
  });

  it("no duplicate slugs", () => {
    const slugs = new Set();
    for (const s of submissionsData?.submissions || []) {
      assert.ok(!slugs.has(s.slug), `duplicate submission slug: ${s.slug}`);
      slugs.add(s.slug);
    }
  });

  it("submittedAt is valid ISO date", () => {
    for (const s of submissionsData?.submissions || []) {
      assert.ok(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s.submittedAt),
        `${s.slug}: invalid submittedAt format`
      );
    }
  });

  it("updatedAt is valid ISO date when present", () => {
    for (const s of submissionsData?.submissions || []) {
      if (s.updatedAt) {
        assert.ok(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s.updatedAt),
          `${s.slug}: invalid updatedAt format`
        );
      }
    }
  });

  it("category and kind use valid enums when present", () => {
    const KINDS = ["mcp-server", "cli", "library", "plugin", "desktop-app", "vscode-extension", "homebrew-tap", "template", "meta"];
    const CATS = ["mcp-core", "voice", "security", "ml", "infrastructure", "desktop", "devtools", "web", "games"];
    for (const s of submissionsData?.submissions || []) {
      if (s.kind) assert.ok(KINDS.includes(s.kind), `${s.slug}: invalid kind "${s.kind}"`);
      if (s.category) assert.ok(CATS.includes(s.category), `${s.slug}: invalid category "${s.category}"`);
    }
  });

  it("needs-info submissions have reviewNotes string when present", () => {
    for (const s of submissionsData?.submissions || []) {
      if (s.status === "needs-info" && s.reviewNotes !== undefined) {
        assert.equal(typeof s.reviewNotes, "string", `${s.slug}: reviewNotes must be a string`);
      }
    }
  });

  it("lastReviewedAt is valid ISO date when present", () => {
    for (const s of submissionsData?.submissions || []) {
      if (s.lastReviewedAt) {
        assert.ok(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s.lastReviewedAt),
          `${s.slug}: invalid lastReviewedAt format`
        );
      }
    }
  });

  it("sourcePr is valid https URL when present", () => {
    for (const s of submissionsData?.submissions || []) {
      if (s.sourcePr) {
        assert.ok(
          validateUrl(s.sourcePr),
          `${s.slug}: sourcePr must be a valid https URL`
        );
      }
    }
  });
});

// ── Phase 22: Telemetry + Queue Health Contract ──────────────

describe("telemetry-schema.json", () => {
  it("exists and has eventTypes object", () => {
    assert.ok(telemetrySchema, "telemetry-schema.json must exist");
    assert.ok(
      telemetrySchema.eventTypes && typeof telemetrySchema.eventTypes === "object",
      "must have eventTypes object"
    );
  });

  it("every event type has description and payload", () => {
    for (const [name, def] of Object.entries(telemetrySchema.eventTypes)) {
      assert.ok(def.description, `${name}: must have description`);
      assert.ok(def.payload && typeof def.payload === "object", `${name}: must have payload object`);
    }
  });

  it("payload fields are only allowed types (string, number)", () => {
    const ALLOWED = ["string", "number"];
    for (const [name, def] of Object.entries(telemetrySchema.eventTypes)) {
      for (const [field, fieldDef] of Object.entries(def.payload)) {
        assert.ok(
          fieldDef && ALLOWED.includes(fieldDef.type),
          `${name}.${field}: type must be string|number, got: ${fieldDef?.type}`
        );
      }
    }
  });

  it("no PII field names (email, ip, userId, userAgent, cookie)", () => {
    const PII_FIELDS = ["email", "ip", "userId", "userAgent", "cookie", "password", "token"];
    for (const [name, def] of Object.entries(telemetrySchema.eventTypes)) {
      for (const field of Object.keys(def.payload)) {
        assert.ok(
          !PII_FIELDS.includes(field),
          `${name}: PII field "${field}" not allowed in telemetry`
        );
      }
    }
  });
});

describe("telemetry rollup.json", () => {
  it("exists and has expected shape (totalEvents, byType, metrics)", () => {
    assert.ok(telemetryRollup, "telemetry/rollup.json must exist");
    assert.ok("totalEvents" in telemetryRollup, "must have totalEvents");
    assert.ok("byType" in telemetryRollup, "must have byType");
    assert.ok("metrics" in telemetryRollup, "must have metrics");
  });

  it("byType keys are valid event type names from schema", () => {
    if (!telemetrySchema || !telemetryRollup) return;
    const validTypes = new Set(Object.keys(telemetrySchema.eventTypes));
    for (const key of Object.keys(telemetryRollup.byType)) {
      assert.ok(validTypes.has(key), `byType key "${key}" not in telemetry schema`);
    }
  });
});

describe("queue-health.json", () => {
  it("exists and has expected shape (byStatus, stuckCount, topLintFailures)", () => {
    assert.ok(queueHealthData, "queue-health.json must exist");
    assert.ok("byStatus" in queueHealthData, "must have byStatus");
    assert.ok("stuckCount" in queueHealthData, "must have stuckCount");
    assert.ok("topLintFailures" in queueHealthData, "must have topLintFailures");
  });

  it("byStatus keys are valid submission statuses", () => {
    const VALID = ["pending", "accepted", "rejected", "withdrawn", "needs-info"];
    for (const key of Object.keys(queueHealthData.byStatus)) {
      assert.ok(VALID.includes(key), `byStatus key "${key}" not a valid submission status`);
    }
  });
});

// ── Phase 23: Recommendations Contract ───────────────────────

const recommendationsData = loadJson("recommendations.json");

describe("recommendations.json", () => {
  it("exists and has expected shape (recommendations array, signals, guardrails)", () => {
    assert.ok(recommendationsData, "recommendations.json must exist");
    assert.ok(Array.isArray(recommendationsData.recommendations), "recommendations must be an array");
    assert.ok(
      recommendationsData.signals && typeof recommendationsData.signals === "object",
      "must have signals object"
    );
    assert.ok(
      recommendationsData.guardrails && typeof recommendationsData.guardrails === "object",
      "must have guardrails object"
    );
  });

  it("every recommendation has required fields (priority, category, slug, title, insight, action, evidence)", () => {
    const REQUIRED = ["priority", "category", "slug", "title", "insight", "action", "evidence"];
    for (const rec of recommendationsData?.recommendations || []) {
      for (const field of REQUIRED) {
        assert.ok(
          field in rec,
          `recommendation ${rec.slug || "unknown"}: missing required field "${field}"`
        );
      }
    }
  });

  it("priority values are valid enum (high, medium, low)", () => {
    const VALID = ["high", "medium", "low"];
    for (const rec of recommendationsData?.recommendations || []) {
      assert.ok(
        VALID.includes(rec.priority),
        `recommendation ${rec.slug}: invalid priority "${rec.priority}"`
      );
    }
  });

  it("category values are valid enum (re-feature, improve-proof, stuck-submission, experiment-graduation, lint-promotion)", () => {
    const VALID = ["re-feature", "improve-proof", "stuck-submission", "experiment-graduation", "lint-promotion"];
    for (const rec of recommendationsData?.recommendations || []) {
      assert.ok(
        VALID.includes(rec.category),
        `recommendation ${rec.slug}: invalid category "${rec.category}"`
      );
    }
  });

  it("lintInsights has expected arrays (warningsToElevate, docsToRewrite)", () => {
    const lint = recommendationsData?.lintInsights;
    assert.ok(lint, "must have lintInsights");
    assert.ok(Array.isArray(lint.warningsToElevate), "warningsToElevate must be an array");
    assert.ok(Array.isArray(lint.docsToRewrite), "docsToRewrite must be an array");
  });

  it("signals has expected keys (trustByWeek, proofEngagementBySlug, submissionFrictionBySlug)", () => {
    const signals = recommendationsData?.signals;
    assert.ok(signals, "must have signals");
    assert.ok("trustByWeek" in signals, "signals must have trustByWeek");
    assert.ok("proofEngagementBySlug" in signals, "signals must have proofEngagementBySlug");
    assert.ok("submissionFrictionBySlug" in signals, "signals must have submissionFrictionBySlug");
  });
});

// ── Phase 24: Recommendation Patch Contract ──────────────────

const recommendationPatch = loadJson("recommendation-patch.json");

describe("recommendation-patch.json", () => {
  it("has valid schema when present (patches, advisoryNotes, riskNotes, frozenActions arrays)", () => {
    if (!recommendationPatch) return; // optional — absent before first run
    assert.ok(Array.isArray(recommendationPatch.patches), "patches must be array");
    assert.ok(Array.isArray(recommendationPatch.advisoryNotes), "advisoryNotes must be array");
    assert.ok(Array.isArray(recommendationPatch.riskNotes), "riskNotes must be array");
    assert.ok(Array.isArray(recommendationPatch.frozenActions), "frozenActions must be array");
  });

  it("every patch has required fields (category, slug, targetFile, description)", () => {
    if (!recommendationPatch) return;
    for (const p of recommendationPatch.patches) {
      assert.ok(p.category, "patch must have category");
      assert.ok(p.slug, "patch must have slug");
      assert.ok(p.targetFile, "patch must have targetFile");
      assert.ok(p.description, "patch must have description");
    }
  });

  it("patch targetFile is in allowed set (promo-queue.json, experiments.json)", () => {
    if (!recommendationPatch) return;
    const ALLOWED = ["promo-queue.json", "experiments.json"];
    for (const p of recommendationPatch.patches) {
      assert.ok(ALLOWED.includes(p.targetFile), `patch targetFile "${p.targetFile}" not allowed`);
    }
  });

  it("patch count does not exceed max cap (5)", () => {
    if (!recommendationPatch) return;
    assert.ok(recommendationPatch.patches.length <= 5, `too many patches: ${recommendationPatch.patches.length}`);
  });

  it("every advisory note has category, slug, and note", () => {
    if (!recommendationPatch) return;
    for (const n of recommendationPatch.advisoryNotes) {
      assert.ok(n.category, "advisory note must have category");
      assert.ok(n.slug, "advisory note must have slug");
      assert.ok(n.note, "advisory note must have note");
    }
  });
});

// ── kit.config.json ──────────────────────────────────────────

describe("kit.config.json", () => {
  const kitConfigPath = path.resolve(__dirname, "../../kit.config.json");

  it("kit.config.json exists", () => {
    assert.ok(fs.existsSync(kitConfigPath), "kit.config.json must exist in repo root");
  });

  it("kitVersion is present and in supported range", () => {
    const raw = JSON.parse(fs.readFileSync(kitConfigPath, "utf8"));
    assert.ok(raw.kitVersion != null, "kitVersion must be present");
    assert.ok(
      raw.kitVersion >= KIT_VERSION_SUPPORTED[0] && raw.kitVersion <= KIT_VERSION_SUPPORTED[1],
      `kitVersion ${raw.kitVersion} not in [${KIT_VERSION_SUPPORTED.join(", ")}]`
    );
  });
});

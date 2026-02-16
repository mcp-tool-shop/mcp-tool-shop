# Portable Core — Contract

The **Portable Core** is the governed promotion engine that another org can adopt by forking the repo and editing `kit.config.json`.

## What It Is

A self-contained pipeline: **trust → receipts → promo → submissions → telemetry → recommendations → patch-to-PR**.

Every promotion decision is scored deterministically, every input is hashed into a receipt, freeze modes prevent unwanted changes, and drift detection flags surprises.

## Data Flow

```
kit.config.json
       │
   ┌───┴───────────────────────────────────────────────┐
   │                                                     │
   ▼                                                     ▼
scripts/lib/config.mjs                        site/src/lib/kit.ts
   │                                                     │
   ├── gen-promo-decisions.mjs                           ├── Base.astro (layout)
   ├── gen-experiment-decisions.mjs                      ├── trust.astro
   ├── gen-decision-drift.mjs                            ├── receipts/index.astro
   ├── gen-trust-receipt.mjs                             ├── submit/index.astro
   ├── gen-baseline.mjs                                  ├── submit/queue.astro
   ├── gen-feedback-summary.mjs                          ├── proof/index.astro
   ├── gen-telemetry-aggregate.mjs                       ├── proof/[slug].astro
   ├── gen-queue-health.mjs                              ├── promo/[week].astro
   ├── gen-recommendations.mjs                           └── now.astro
   ├── gen-recommendation-patch.mjs
   ├── apply-control-patch.mjs
   └── apply-submission-status.mjs
```

## What Inputs the Kit Expects

| File | Purpose | Generated? |
|------|---------|-----------|
| `kit.config.json` | Org identity, paths, guardrails | Human-owned |
| `site/src/data/governance.json` | Freeze state, promo caps, hard rules | Human-owned |
| `site/src/data/promo-queue.json` | Weekly promotion candidates | Human-owned |
| `site/src/data/experiments.json` | Active A/B experiments | Human-owned |
| `site/src/data/submissions.json` | External tool submissions | Human-owned |
| `site/src/data/worthy.json` | Worthiness rubric + scores | Generated |
| `site/src/data/overrides.json` | Per-tool metadata overrides | Human-owned |
| `site/src/data/feedback.jsonl` | Append-only feedback log | Append-only |
| `site/src/data/telemetry/events/*.jsonl` | Raw telemetry events | Append-only |
| `site/src/data/ops-history.json` | Workflow run history | Generated |

## What Artifacts It Produces

| Artifact | Script | Description |
|----------|--------|-------------|
| `promo-decisions.json` | gen-promo-decisions | Scored promote/skip/defer decisions |
| `experiment-decisions.json` | gen-experiment-decisions | Winner/loser/insufficient |
| `decision-drift.json` | gen-decision-drift | Week-over-week delta |
| `baseline.json` | gen-baseline | Cost projections, workflow stats |
| `feedback-summary.json` | gen-feedback-summary | Per-channel, per-slug rollup |
| `telemetry/rollup.json` | gen-telemetry-aggregate | Aggregated event counts |
| `queue-health.json` | gen-queue-health | Stuck submissions, throughput |
| `recommendations.json` | gen-recommendations | Advisory improvement signals |
| `recommendation-patch.json` | gen-recommendation-patch | Governed data patches + audit |
| `trust.json` (public) | gen-trust-receipt | Hashed inputs, provenance |

## What an Adopter Customizes

Edit `kit.config.json` in the repo root:

```json
{
  "kitVersion": 1,
  "org": {
    "name": "your-org",
    "account": "your-github-account",
    "url": "https://github.com/your-org"
  },
  "site": {
    "title": "your-site-title",
    "url": "https://your-domain.com",
    "description": "Your site description."
  },
  "repo": {
    "marketing": "your-account/your-repo"
  },
  "contact": {
    "email": "your-email"
  },
  "paths": {
    "dataDir": "site/src/data",
    "publicDir": "site/public"
  },
  "guardrails": {
    "maxDataPatchesPerRun": 5,
    "dailyTelemetryCapPerType": 50,
    "spikeThreshold": 300,
    "maxRecommendations": 20
  }
}
```

Most adopters only change `org`, `site`, `repo`, and `contact`. Paths and guardrails have sensible defaults.

## Bootstrap

```bash
npm run kit:init       # Create zero-state seed files
npm run kit:selftest   # Validate config + seeds + invariants + build
npm run kit:migrate    # Apply version upgrades (v1→v1 is no-op)
```

## What You Get After kit:selftest Passes

When selftest reports all checks passed, you have:

- **17+ seed files** in your data directory, all valid JSON
- **governance.json** with both freeze modes active (safe default)
- **Zero org-specific strings** in any generated file
- **All 10 portable core scripts** pass dry-run against seed data
- **Config resolution** works via `KIT_CONFIG` env var or auto-discovery
- **Error messages** include file paths and actionable fix hints

You are now ready to:

1. Edit `promo-queue.json` to queue your first promotion
2. Run `gen-promo-decisions.mjs --dry-run` to see scored decisions
3. Unfreeze decisions in `governance.json` when ready to go live

## Minimum Edits for Adoption

### Required edits (4 fields)

| Field | Purpose | Example |
|-------|---------|---------|
| `org.name` | Your GitHub org name | `"acme-tools"` |
| `org.account` | Your GitHub account | `"acme-tools"` |
| `site.title` | Displayed in header/footer/titles | `"Acme Tool Catalog"` |
| `contact.email` | Contact for generated artifacts | `"team@acme.com"` |

### Optional edits

- `org.url` — your org's GitHub URL (default: empty)
- `site.url` — your live site URL (default: empty)
- `site.description` — site description (default: empty)
- `repo.marketing` — your marketing repo slug (default: empty)
- `paths.dataDir` / `paths.publicDir` — if your directory layout differs from `site/src/data` / `site/public`
- `guardrails.*` — tune thresholds (all have sensible defaults)

### `KIT_CONFIG` environment variable

Set `KIT_CONFIG=/path/to/your/kit.config.json` to run scripts against a config file outside the default repo root. All data paths resolve relative to the directory containing the specified config file.

```bash
export KIT_CONFIG=/path/to/your-org/kit.config.json
node scripts/kit-bootstrap.mjs
node scripts/kit-selftest.mjs --skip-build --skip-invariants
```

### Quickstart

```bash
# 1. Fork or copy the repo
# 2. Edit kit.config.json with your org details
# 3. Bootstrap
npm run kit:init
# 4. Validate
npm run kit:selftest --skip-build
# 5. Run a dry-run
node scripts/gen-promo-decisions.mjs --dry-run
```

### What success looks like

- `kit:init` creates ~17 seed files in your data directory
- `kit:selftest` reports all checks passed
- Dry-runs complete without errors
- No references to the original org in generated output

## Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Forgetting to edit `kit.config.json` before bootstrap | Seed files reference original org strings | Delete `data/` directory, edit config, re-run `kit:init` |
| Running `kit:selftest` without `--skip-build` on a pilot org | Build fails because `site/` directory does not exist | Add `--skip-build` flag (pilot orgs have no Astro site yet) |
| Running invariant tests against a pilot org | Tests fail looking for `projects.json`, `collections.json` | Add `--skip-invariants` flag (invariants test main-org-specific files) |
| Setting `KIT_CONFIG` to a relative path | Scripts resolve paths incorrectly | Always use an absolute path or `$(pwd)/...` |
| Editing seed files by hand instead of using governance.json | Changes are overwritten on next `kit:init` | Edit `governance.json` for freeze modes; edit `promo-queue.json` for promotions |
| Running `gen-promo-decisions.mjs` without `--dry-run` first | Unexpected promotion decisions written to disk | Always dry-run first, review output, then run without the flag |

## Guardrails

- **Freeze modes**: `decisionsFrozen` pauses promotion automation; `experimentsFrozen` pauses experiment graduation. Both are respected by scripts and the recommendation-patch workflow.
- **Max patches per run**: `guardrails.maxDataPatchesPerRun` caps how many data files a single recommendation run can change (default 5).
- **Telemetry caps**: `guardrails.dailyTelemetryCapPerType` prevents event flooding (default 50/type/day).
- **Spike detection**: `guardrails.spikeThreshold` flags suspicious event volumes (default 300/day).
- **Recommendation limit**: `guardrails.maxRecommendations` caps advisory output (default 20).

## Upgrade Path

The `kitVersion` field enables future schema migrations. When a new kit version is released:

1. Update the repo code
2. Run `npm run kit:migrate` — it reads `kitVersion`, checks the supported range, and applies transforms
3. Run `npm run kit:selftest` to verify

Currently `kitVersion: 1` is the only supported version.

## What Is NOT in the Portable Core

These remain org-specific and are not covered by `kit.config.json`:

- Outreach scripts (press kits, snippets, social copy)
- Target/signal/enrichment pipelines
- MarketIR claim management
- Collection curation
- Screenshot generation
- Link tracking / attribution
- Draft override enrichment

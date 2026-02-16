# Internal Marketing Wing Recap

> Architecture and script inventory for the mcp-tool-shop marketing pipeline.
> This document is the starting point for AI agents and maintainers resuming work on the site.

## What this repo does

This repo (`mcp-tool-shop/mcp-tool-shop`) is the **public marketing site** for [mcp-tool-shop-org](https://github.com/mcp-tool-shop-org). It discovers tools from the org, enriches them with metadata, and publishes a catalog at [mcptoolshop.com](https://mcp-tool-shop.github.io/).

The pipeline has four stages:

```
Fetch  →  Verify  →  Generate  →  Deploy
```

1. **Fetch** pulls data from three sources: the mcp-tool-registry, GitHub API, and MarketIR (upstream marketing data).
2. **Verify** checks hashes, validates JSON schemas, and runs integrity tests.
3. **Generate** produces HTML press kits, SVG placeholders, go-link redirects, outreach packs, partner bundles, target lists, and snippets.
4. **Deploy** builds the Astro site and publishes via GitHub Pages.

## CLAUDE bootstrap snippet

Drop this into any conversation to orient Claude on the marketing wing:

```
Read these files in order:
1. F:\AI\mcp-tool-shop\docs\automation.md        — data ownership + override schema
2. F:\AI\mcp-tool-shop\docs\SECURITY-MODEL.md     — trust boundaries + sanitization
3. F:\AI\mcp-tool-shop\docs\INTERNAL-MARKETING-WING.md — this file (architecture + scripts)
4. F:\AI\mcp-tool-shop\package.json               — available npm scripts
```

## Data files (site/src/data/)

| File | Owner | Generator |
|------|-------|-----------|
| `projects.json` | Generated | `sync-org-metadata.mjs` |
| `org-stats.json` | Generated | `sync-org-metadata.mjs` |
| `releases.json` | Generated | `sync-org-metadata.mjs` |
| `overrides.json` | Human-curated | Hand-edited (automation may draft with `needsHumanReview: true`) |
| `collections.json` | Human-curated | Hand-edited |
| `automation.ignore.json` | Human-curated | Hand-edited skip list |
| `links.json` | Human-curated | Short-link definitions for go-links |
| `registry/registry.json` | Generated | `fetch-registry.mjs` |
| `registry/registry.index.json` | Generated | `fetch-registry.mjs` |
| `registry/aliases.json` | Human-curated | Registry ID to repo name mappings |
| `registry/cleanup.json` | Generated | `sync-org-metadata.mjs` |
| `registry/meta.json` | Generated | `sync-org-metadata.mjs` |
| `marketir/*.json` | Generated | `fetch-marketir.mjs` |
| `github-facts/*.json` | Generated | `fetch-github-facts.mjs` |
| `distribution-signals/*.json` | Generated | `fetch-distribution-signals.mjs` |

## Script inventory

### Fetchers (pull external data)

| Script | What it does | Needs token? |
|--------|-------------|--------------|
| `fetch-registry.mjs` | Downloads registry from mcp-tool-registry | No |
| `fetch-marketir.mjs` | Downloads + hash-verifies MarketIR vendor data | Optional |
| `fetch-github-facts.mjs` | Collects GitHub stats for tools with `publicProof: true` | Optional (higher rate limit) |
| `fetch-distribution-signals.mjs` | npm/PyPI download counts, Docker pulls | No |
| `sync-org-metadata.mjs` | Syncs org repos into `projects.json` + `org-stats.json` | Yes |

### Generators (produce output files)

| Script | Output | Format |
|--------|--------|--------|
| `gen-presskit.mjs` | `site/public/presskit/<slug>/` | HTML + MD + JSON |
| `gen-go-links.mjs` | `site/public/go/<id>/` | HTML redirect pages |
| `gen-placeholders.mjs` | `site/public/screenshots/<slug>.png` | SVG rendered to PNG |
| `gen-outreach-packs.mjs` | `site/public/outreach/<slug>/` | Markdown bundles |
| `gen-partner-packs.mjs` | `site/public/partners/<slug>/` | Markdown bundles |
| `gen-targets.mjs` | `site/public/targets/<slug>/` | JSON target lists |
| `gen-snippets.mjs` | `site/public/snippets/<slug>/` | Markdown copy blocks |
| `gen-campaign-bundles.mjs` | `site/public/campaigns/<slug>/` | Bundled campaign assets |
| `gen-links.mjs` | `site/src/data/links.json` | JSON (go-link definitions) |
| `gen-build-meta.mjs` | Build metadata | JSON |
| `gen-legacy-redirects.mjs` | `site/public/*.html` | HTML redirect shims |

### Analyzers (inspect, don't modify)

| Script | What it does |
|--------|-------------|
| `draft-overrides.mjs` | Heuristic override enrichment (kind/stability/tags), opens PR |
| `suggest-collections.mjs` | Analyzes projects for collection groupings |
| `smoke-test.mjs` | Post-deploy live site checks (links, security scan) |
| `registry-cleanup-issue.mjs` | Creates GitHub issue for registry hygiene |

## Shared libraries (scripts/lib/)

| Module | Exports | Used by |
|--------|---------|---------|
| `sanitize.mjs` | `htmlEsc()`, `escapeXml()`, `validateUrl()` | gen-presskit, gen-go-links, gen-placeholders |
| `errors.mjs` | `fail()`, `warn()` | fetch-marketir, fetch-github-facts, gen-presskit |

## Error codes

All structured errors use the format `MKT.<AREA>.<KIND>`:

| Code | Meaning |
|------|---------|
| `MKT.FETCH.NETWORK` | HTTP/DNS failure during data fetch |
| `MKT.FETCH.DENIED` | 401/403 — missing or insufficient token |
| `MKT.DATA.MISSING` | Expected file not found |
| `MKT.DATA.INVALID` | File exists but has wrong shape or format |
| `MKT.HASH.MISMATCH` | SHA-256 doesn't match lockfile |
| `MKT.GEN.MISSING` | Generator can't find required input data |
| `MKT.AUTH.QUOTA` | GitHub API rate limit exceeded |

## CI workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `pages.yml` | Push to `main` (paths-filtered) | Build Astro site + deploy to GitHub Pages |
| `site-quality.yml` | PR (paths-filtered) | Unit tests, invariant tests, schema validation, link check, secret scan |
| `sync-org-metadata.yml` | Manual | Sync org repos into projects.json |
| `overrides-weekly.yml` | Monday 08:00 UTC | Sync + enrich + open PR |
| `screenshots-weekly.yml` | Wednesday 08:00 UTC | Generate placeholder screenshots + open PR |
| `targets-weekly.yml` | Friday 08:00 UTC | Generate target lists + open PR |

All actions are pinned to commit SHAs. All workflows declare explicit `permissions:` blocks.

## Test infrastructure

```bash
npm test              # unit tests (sanitize, XSS vectors)
npm run test:invariants  # cross-referential data integrity
npm run test:all      # both
```

Tests use `node:test` (zero dependencies). Fixtures live in `tests/fixtures/`.

# Phase 26A — Pilot Report

## What Was Tested

- **Bootstrap**: `KIT_CONFIG=examples/pilot-org/kit.config.json node scripts/kit-bootstrap.mjs`
- **Selftest**: `KIT_CONFIG=... node scripts/kit-selftest.mjs --skip-build --skip-invariants`
- **Dry-runs**: All 10 portable core scripts via selftest
- **String isolation**: `grep -r "mcp-tool-shop" examples/pilot-org/data/` — zero matches
- **Unit tests**: 9 new KIT_CONFIG env var tests, all passing
- **Backward compatibility**: Original org selftest 29/29, 539+ total tests pass

## What Worked

- Bootstrap created 19 seed files/dirs in `examples/pilot-org/data/` — correct directory, not `site/src/data/`
- All 10 dry-runs passed against zero-state seed data
- No org-specific strings leaked into pilot org data files
- `getRoot()` correctly resolves KIT_CONFIG env var or falls back to auto-discovery
- Original org is completely unaffected when KIT_CONFIG is not set
- Selftest correctly splits SCRIPT_ROOT (where code lives) from DATA_ROOT (where config/data lives)

## Papercuts Found and Fixed

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| `gen-baseline.mjs --dry-run` crashed with `TypeError: history.map is not a function` | `safeParseJson` returned `{ schemaVersion: 1, runs: [] }` but `computeBaseline` expected a bare array | Extract `.runs` from parsed ops-history.json when result is an object |
| Bootstrap error "kit.config.json not found in repo root" gave no path | `checkEnvironment()` used hardcoded ROOT without passing to message | Now shows actual path + KIT_CONFIG hint |
| Selftest seed-missing errors showed path but no fix hint | Missing guidance | Now appends "Fix: run npm run kit:init" |
| Selftest dry-run errors showed only stderr excerpt | No context about what to do | Now names the script + suggests running bootstrap |

## What Is Ready

- **KIT_CONFIG env var**: Works across all 12 gen scripts + 3 kit tooling scripts
- **Example org**: Complete at `examples/pilot-org/` with config, README, and quickstart
- **CI enforcement**: `kit-pilot` job in site-quality.yml validates bootstrap + selftest + string isolation
- **Documentation**: "Minimum Edits for Adoption" section in portable-core.md
- **Error UX**: Actionable messages with file paths and fix hints
- **Selftest flags**: `--skip-build` + `--skip-invariants` for pilot-org use

## What Is NOT Ready

- **Astro site for pilot org**: Pilot org has no `site/` directory. The site is the main org's Astro setup and is NOT portable yet. Adopters can run the governance engine (scripts) without the site.
- **Invariant tests with pilot org**: The invariant tests in `tests/invariants/data-integrity.test.mjs` hardcode `../../site/src/data` and test for main-org-specific files (projects.json, collections.json, etc.). These cannot run against a pilot org. The `--skip-invariants` flag works around this.
- **CI workflow portability**: The site-quality.yml workflow is specific to this repo. An adopter would need to create their own CI.
- **Migration on alternate root**: `kit-migrate.mjs` works with KIT_CONFIG but has never been tested with actual migrations (v1 is a no-op).

## Recommendations for Phase 26B

1. **Portable invariant tests**: Create a subset of invariants that work against any kit root (seed schema validation, governance rules, data type checks) — not dependent on projects.json/collections.json.
2. **Site template**: Minimal Astro site that works out of the box with kit.config.json — even if it's just a dashboard showing governance state.
3. **`npx create-kit`**: Bootstrap an entirely new repo (not just seed data) from a template.
4. **Adopter CI template**: `.github/workflows/kit-ci.yml` that an adopter can copy into their repo.
5. **Migration testing**: Create a v1→v2 migration with actual transforms to exercise the migration path.

## Test Counts

| Category | Before | Added | After |
|----------|--------|-------|-------|
| Unit | 433 | 9 | 442 |
| Invariant | 106 | 0 | 106 |
| **Total** | **539** | **9** | **548** |

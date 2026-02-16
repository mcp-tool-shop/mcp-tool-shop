# Pilot Notes — Dogfood (mcp-tool-shop marketing wing)

**Date**: 2026-02-16
**Pilot type**: internal / dogfood
**promo-kit version**: 0.1.2

## Setup

```bash
mkdir custom/promo-kit-pilot && cd custom/promo-kit-pilot
npm init -y
npm i @mcptoolshop/promo-kit
npx promo-kit init
# edited kit.config.json
npx promo-kit selftest
```

## Time to green

- `npm i` → `selftest pass`: ~3 minutes (including config editing)

## First point of confusion

**Config field name for data directory is not discoverable.**

The template (`kit.config.example.json`) omits `paths` entirely, which is fine — defaults are sensible. But when you want to override the data directory, you need to know the field is called `paths.dataDir`, not `paths.data`.

I set `"paths": { "data": "data" }` — this was silently accepted (deep merge just added a new key) and seeds still went to the default `site/src/data/`.

**Expected**: either the field name is intuitive (`paths.data`) or the template includes commented-out `paths` with field names visible.

### Recommended fix (for 0.1.3)

Option A: Add `paths` to the config template with comments:
```json
{
  "paths": {
    "dataDir": "site/src/data",
    "publicDir": "site/public"
  }
}
```

Option B: Accept `paths.data` as an alias for `paths.dataDir` in config.mjs.

Option C: Both.

## First error

None — all commands ran without errors.

## Config fields misunderstood

| Field | What I thought | What it actually means |
|-------|---------------|----------------------|
| `paths.data` | Override for data directory | Does not exist; silently ignored |
| `paths.dataDir` | (didn't know this existed) | Actual field for data directory |

## Artifacts generated

| Generator | Output | Status |
|-----------|--------|--------|
| `gen-decision-drift.mjs` | `data/decision-drift.json` | Clean (empty — expected for zero-state) |
| `gen-trust-receipt.mjs` | `site/public/trust.json` | Clean (commit 3387766, 6 artifact hashes) |
| `gen-recommendations.mjs` | `data/recommendations.json` | Clean (0 recommendations — expected for zero-state) |

## Docs fixes needed

| File | Change | Status |
|------|--------|--------|
| `kit.config.example.json` | Add `paths` section with `dataDir` and `publicDir` | Pending |
| `packages/promo-kit/README.md` | Mention `paths.dataDir` in config editing section | Pending |

## Outcome

- [x] Completed without external help
- [ ] Required a docs fix (patch release)
- [ ] Required a code fix (patch release)
- [ ] Blocked — could not complete

## Notes

- Install was instant (1 package, 0 deps, 0 vulnerabilities)
- `init` auto-creates config + 19 seed files — very smooth
- Selftest 28/28 on first try after correcting `dataDir`
- Trust receipt with SHA-256 hashes is the best outreach proof artifact
- The `site/public/trust.json` output path is hardcoded to `publicDir` — makes sense for the live site but may confuse adopters who don't have a `site/` directory

# Pilot Org Example

**One-line promise**: A working example of the portable promotion engine running against a non-default config root.

**Full reference**: [Portable Core contract](../../docs/portable-core.md) · [Presskit Handbook](../../docs/presskit-handbook.md)

---

## Quickstart

```bash
# From repo root:
export KIT_CONFIG=$(pwd)/examples/pilot-org/kit.config.json
node scripts/kit-bootstrap.mjs          # creates seed files in examples/pilot-org/data/
node scripts/kit-selftest.mjs --skip-build --skip-invariants
node scripts/gen-promo-decisions.mjs --dry-run
```

## What this tests

- `KIT_CONFIG` env var resolves to this directory
- Bootstrap creates seeds in `data/` (not `site/src/data/`)
- Selftest passes without the main org's site or invariants
- Dry-runs complete without org-specific strings leaking

## What you get after selftest passes

- 17+ seed files in `data/`, all zero-state JSON
- Both freeze modes active (safe default)
- All portable core scripts pass dry-run
- No references to the original org in any output

See [What You Get After kit:selftest Passes](../../docs/portable-core.md#what-you-get-after-kitselftest-passes) for the full checklist.

## Customizing

Edit `kit.config.json` in this directory. See [Portable Core](../../docs/portable-core.md) for the full field reference.

# Changelog

## 0.1.3 — 2026-02-16

### Fixed

- Config template now includes `paths.dataDir` and `paths.publicDir` so path overrides are discoverable
- Selftest detects unknown keys in `paths` (e.g. `paths.data` → "did you mean `paths.dataDir`?")

### Added

- Dogfood pilot: trust receipt generated against own catalog repo (commit + SHA-256 hashes)

## 0.1.2 — 2026-02-16

### Changed

- Rewrite npm README for scannability (product-page layout, split seed/artifact tables, KIT_CONFIG example)
- Logo sized to 420px (was 200→300, still too small on npmjs.com)

## 0.1.1 — 2026-02-16

### Fixed

- Add logo to npm README (renders on npmjs.com via raw GitHub URL)

## 0.1.0 — 2026-02-16

Initial release of the portable promotion engine.

### Included

- `promo-kit init` — bootstrap 17 zero-state seed files (auto-creates kit.config.json)
- `promo-kit selftest` — validate config, seeds, and dry-runs
- `promo-kit migrate` — apply schema version upgrades
- `promo-kit --print-config` — show resolved config after defaults
- Programmatic API: `bootstrap()`, `migrate()`, `getConfig()`, `getRoot()`, `loadKitConfig()`
- 10 portable core generators (promo-decisions, experiment-decisions, baseline, feedback-summary, queue-health, telemetry-aggregate, recommendations, recommendation-patch, decision-drift, trust-receipt)
- 2 apply scripts (control-patch, submission-status)
- Example config template (`kit.config.example.json`)
- Zero runtime dependencies

# @mcptoolshop/promo-kit

Portable promotion engine for tool catalogs. Receipt-backed promotions, freeze modes, drift detection — zero dependencies.

## What it does

`promo-kit` gives your tool catalog a complete promotion pipeline:

- **Bootstrap** 17 zero-state seed files (governance, promo queue, experiments, etc.)
- **Generate** promotion decisions, baselines, drift reports, and trust receipts
- **Verify** everything with SHA-256 hashed inputs and commit SHAs
- **Freeze** automation when you need human review

All data stays local. No cloud dependencies. No runtime npm dependencies.

## Quickstart

```bash
npm install @mcptoolshop/promo-kit

# Initialize (auto-creates kit.config.json from template)
npx promo-kit init

# Edit kit.config.json with your org details:
#   org.name, org.account, site.title, contact.email

# Validate the installation
npx promo-kit selftest
```

## CLI Commands

### `promo-kit init`

Creates `kit.config.json` (if absent) and bootstraps 17 seed files in your data directory.

```bash
promo-kit init              # create config + seeds
promo-kit init --dry-run    # show what would be created
promo-kit init --force      # overwrite existing kit.config.json
```

### `promo-kit selftest`

Validates config, seed files, and runs all portable core generators in dry-run mode.

```bash
promo-kit selftest
```

### `promo-kit migrate`

Applies schema version upgrades when `kitVersion` changes.

```bash
promo-kit migrate
```

### Flags

```bash
promo-kit --version         # show version
promo-kit --help            # show usage
promo-kit --print-config    # show resolved config after defaults
```

## Programmatic API

```js
import { bootstrap, migrate, getConfig, getRoot, loadKitConfig } from "@mcptoolshop/promo-kit";

// Bootstrap seed files in a directory
const result = bootstrap("/path/to/your/project");
// => { success: true, errors: [], created: [...], skipped: [...] }

// Get resolved config (deep-merged with defaults)
const config = getConfig();

// Run migrations
const migrationResult = migrate("/path/to/your/project");
```

Config utilities are also available as a separate export:

```js
import { getConfig, getRoot } from "@mcptoolshop/promo-kit/config";
```

## What it generates

`promo-kit init` creates these seed files in your data directory:

| File | Purpose |
|------|---------|
| `governance.json` | Freeze modes, promo caps, hard rules |
| `promo-queue.json` | Weekly promotion candidates |
| `experiments.json` | Active A/B experiments |
| `submissions.json` | External tool submissions |
| `overrides.json` | Per-tool metadata overrides |
| `ops-history.json` | Workflow run history |
| `feedback.jsonl` | Append-only feedback log |
| `worthy.json` | Worthiness rubric and scores |
| `promo-decisions.json` | Generated promotion decisions |
| `experiment-decisions.json` | Generated experiment decisions |
| `baseline.json` | Computed baseline metrics |
| `feedback-summary.json` | Aggregated feedback |
| `queue-health.json` | Queue health metrics |
| `recommendations.json` | Advisory recommendations |
| `recommendation-patch.json` | Recommended data patches |
| `decision-drift.json` | Week-over-week drift report |
| `telemetry/rollup.json` | Telemetry aggregates |

## Environment

| Variable | Purpose |
|----------|---------|
| `KIT_CONFIG` | Path to an alternate `kit.config.json` (overrides cwd discovery) |

## Requirements

- Node.js >= 22
- Zero runtime dependencies

## Links

- [Portable Core docs](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/portable-core.md) — full contract and field reference
- [Presskit Handbook](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/presskit-handbook.md) — brand assets and verification walkthrough
- [Trust Center](https://mcp-tool-shop.github.io/trust/) — live verification infrastructure

## License

MIT

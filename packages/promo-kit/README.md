<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop/mcp-tool-shop/main/logo.png" width="420" alt="mcp-tool-shop logo" />
</p>

<h1 align="center">@mcptoolshop/promo-kit</h1>

<p align="center">
  <b>The engine behind the Weekly Spotlight.</b><br/>
  Receipt-backed spotlight picks · freeze modes · drift detection · <b>zero dependencies</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/promo-kit"><img src="https://img.shields.io/npm/v/@mcptoolshop/promo-kit?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/mcp-tool-shop/mcp-tool-shop/releases"><img src="https://img.shields.io/github/v/release/mcp-tool-shop/mcp-tool-shop?style=flat-square&label=release" alt="GitHub release" /></a>
  <a href="https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/packages/promo-kit/LICENSE"><img src="https://img.shields.io/npm/l/@mcptoolshop/promo-kit?style=flat-square" alt="license" /></a>
</p>

---

## What it does

`promo-kit` is the automation engine behind MCP Tool Shop's Weekly Spotlight. It gives any tool catalog a governed promotion pipeline:

- **Bootstraps** a zero-state data model (governance, promo queue, experiments, submissions)
- **Generates** promotion decisions, baselines, drift reports, and trust receipts
- **Verifies inputs** with SHA-256 hashes (and ties outputs back to commits)
- **Supports freeze modes** when you need human review
- **Keeps data local** (no cloud services, no trackers, no runtime npm deps)

If your catalog needs "trust you can audit," this is the boring machinery that makes it real.

---

## Quickstart

Install:

```bash
npm i @mcptoolshop/promo-kit
```

Initialize (creates `kit.config.json` from a template if missing, then seeds data):

```bash
npx promo-kit init
```

Edit `kit.config.json` (minimum):

- `org.name`
- `org.account`
- `site.title`
- `contact.email`
- `paths.dataDir` / `paths.publicDir` — override if your data lives somewhere other than `site/src/data`

Validate the installation:

```bash
npx promo-kit selftest
```

---

## CLI

### `promo-kit init`

Creates `kit.config.json` (if absent) and bootstraps seed files in your configured data directory.

```bash
promo-kit init
promo-kit init --dry-run
promo-kit init --force
```

### `promo-kit selftest`

Validates config + seeds and runs the portable core generators in dry-run mode.

```bash
promo-kit selftest
```

### `promo-kit migrate`

Applies schema upgrades when `kitVersion` changes.

```bash
promo-kit migrate
```

### Flags

```bash
promo-kit --version
promo-kit --help
promo-kit --print-config
```

---

## Programmatic API

```js
import {
  bootstrap,
  migrate,
  getConfig,
  getRoot,
  loadKitConfig
} from "@mcptoolshop/promo-kit";

// Create seed files (idempotent)
const result = bootstrap("/path/to/project");
// => { success: true, errors: [], created: [...], skipped: [...] }

// Read resolved config (deep-merged with defaults)
const config = getConfig();

// Apply migrations (if needed)
const migrationResult = migrate("/path/to/project");
```

Config utilities are also available as a separate export:

```js
import { getConfig, getRoot } from "@mcptoolshop/promo-kit/config";
```

---

## What it generates

By default, `promo-kit init` creates a set of seed files in your configured data directory.

**Core seeds:**

| File | Purpose |
|------|---------|
| `governance.json` | Freeze modes, caps, hard rules |
| `promo-queue.json` | Weekly promotion candidates |
| `experiments.json` | Active experiments |
| `submissions.json` | External tool submissions |
| `overrides.json` | Per-tool metadata overrides |
| `ops-history.json` | Workflow run history |
| `feedback.jsonl` | Append-only feedback log |
| `worthy.json` | Worthiness rubric and scores |

**Generated artifacts** (produced by the pipeline):

| File | Purpose |
|------|---------|
| `promo-decisions.json` | Generated promotion decisions |
| `experiment-decisions.json` | Generated experiment decisions |
| `baseline.json` | Computed baseline metrics |
| `feedback-summary.json` | Aggregated feedback |
| `queue-health.json` | Queue health metrics |
| `recommendations.json` | Advisory recommendations |
| `recommendation-patch.json` | Recommended governed data patches |
| `decision-drift.json` | Week-over-week drift report |
| `telemetry/rollup.json` | Telemetry aggregates |

---

## Environment

| Variable | Purpose |
|----------|---------|
| `KIT_CONFIG` | Path to an alternate `kit.config.json` (overrides cwd discovery) |

Example:

```bash
KIT_CONFIG=examples/pilot-org/kit.config.json npx promo-kit selftest
```

---

## Why trust this kit?

555 tests (449 unit + 106 invariant) · portable selftest included · invariants enforced in CI

- **Zero runtime deps** — nothing to audit, nothing to break
- **Local-only data** — no external services, no tracking, no network calls
- **Deterministic outputs** — same inputs produce the same outputs, every time
- **Receipt-backed** — every artifact is SHA-256 hashed with a commit SHA
- **PR-only automation** — proposes changes; humans merge
- **Freeze modes** — pause automation for human review at any time

Example outputs: [trust receipt](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/examples/trust-receipt.json) · [drift report](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/examples/decision-drift.json) · [recommendations](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/examples/recommendations.json)

---

## Requirements

- Node.js >= 22
- Zero runtime dependencies

## Links

- [Quickstart](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/quickstart.md) — zero to trust receipt in 5 minutes
- [Portable Core docs](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/portable-core.md) — contract + field reference
- [Presskit Handbook](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/presskit-handbook.md) — assets + verification walkthrough
- [Trust Center](https://mcp-tool-shop.github.io/trust/) — live example of the verification UX

## License

MIT

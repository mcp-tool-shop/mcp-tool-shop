# Quickstart

Get from zero to a verified trust receipt in under 5 minutes.

## Requirements

- Node.js 22+

## Install

```bash
mkdir my-catalog && cd my-catalog
npm init -y
npm i @mcptoolshop/promo-kit
```

One package. Zero dependencies. Nothing else to install.

## Initialize

```bash
npx promo-kit init
```

This does two things:

1. Creates `kit.config.json` from a template (if it doesn't already exist)
2. Bootstraps 17 seed files in your data directory

You'll see output like:

```
Created kit.config.json from template.
  Edit these fields: org.name, org.account, site.title, contact.email

Kit Bootstrap
========================================
✓ Environment OK
✓ Config loaded (kitVersion: 1)
✓ Created: 19 files/dirs
```

## Configure

Open `kit.config.json` and edit these fields:

```json
{
  "org": {
    "name": "your-org-name",
    "account": "your-github-account"
  },
  "site": {
    "title": "Your Tool Catalog"
  },
  "contact": {
    "email": "you@example.com"
  }
}
```

**Optional:** override where data lives (defaults to `site/src/data`):

```json
{
  "paths": {
    "dataDir": "data",
    "publicDir": "public"
  }
}
```

## Validate

```bash
npx promo-kit selftest
```

You should see all checks pass:

```
Kit Self-Test
========================================

[Config]
  ✓ kit.config.json exists
  ✓ kit.config.json is valid JSON with required fields
  ✓ no unknown keys in paths
  ✓ kitVersion in supported range

[Seed Files]
  ✓ governance.json exists
  ✓ promo-queue.json exists
  ... (17 seed checks)

[Core Dry-Runs]
  ✓ gen-promo-decisions.mjs --dry-run
  ✓ gen-trust-receipt.mjs --dry-run
  ... (10 generator checks)

========================================
Results: 28 passed, 0 failed, 28 total
✓ All checks passed.
```

If any check fails, the error message tells you what's wrong and how to fix it.

## What you now have

After init + selftest, your data directory contains:

| File | What it does |
|------|-------------|
| `governance.json` | Freeze modes, promo caps, hard rules |
| `promo-queue.json` | Weekly promotion candidates |
| `experiments.json` | Active A/B experiments |
| `submissions.json` | External tool submissions |
| `overrides.json` | Per-tool metadata overrides |
| `worthy.json` | Worthiness rubric and scores |
| `ops-history.json` | Workflow run history |
| `feedback.jsonl` | Append-only feedback log |
| + 9 generated artifacts | Decisions, baselines, drift, receipts |

All JSON. All local. All auditable.

## Generate a trust receipt

Run a generator for real (not dry-run):

```bash
KIT_CONFIG=./kit.config.json node node_modules/@mcptoolshop/promo-kit/scripts/gen-trust-receipt.mjs
```

This produces `trust.json` in your public directory:

```json
{
  "generatedAt": "2026-02-16T22:38:02.146Z",
  "commit": "3387766",
  "provenClaims": 0,
  "artifactManifest": {
    "overrides.json": "sha256:ca3d163b...",
    "worthy.json": "sha256:184194b5...",
    "baseline.json": "sha256:8a1d8af7...",
    "promo-decisions.json": "sha256:8e16730d..."
  }
}
```

Every artifact is SHA-256 hashed. The commit ties the receipt to a specific point in your repo history. Anyone can verify that your promotion decisions match the inputs they were derived from.

## What's next

- **Edit seed data** — add tools to `promo-queue.json`, set rules in `governance.json`
- **Run generators** — produce promotion decisions, drift reports, recommendations
- **Commit everything** — all artifacts are deterministic and diffable in PRs
- **Set up CI** — run `npx promo-kit selftest` in your CI pipeline

## Useful commands

```bash
npx promo-kit --version        # installed version
npx promo-kit --help           # full usage
npx promo-kit --print-config   # resolved config after defaults
npx promo-kit migrate          # apply schema upgrades
```

## Why trust this kit?

- **Zero runtime deps** — nothing to audit, nothing to break
- **Local-only data** — no external services, no tracking, no network calls
- **Deterministic outputs** — same inputs produce the same outputs, every time
- **Receipt-backed** — every artifact is SHA-256 hashed with a commit SHA
- **PR-only automation** — proposes changes; humans merge
- **Freeze modes** — pause automation for human review at any time

## Links

- [npm package](https://www.npmjs.com/package/@mcptoolshop/promo-kit)
- [Portable Core docs](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/portable-core.md) — full contract and field reference
- [Presskit Handbook](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/docs/presskit-handbook.md) — brand assets and verification walkthrough
- [Trust Center](https://mcp-tool-shop.github.io/trust/) — live verification example
- [Example outputs](https://github.com/mcp-tool-shop/mcp-tool-shop/tree/main/docs/examples) — real trust receipt, drift report, recommendations
- [Security policy](https://github.com/mcp-tool-shop/mcp-tool-shop/blob/main/SECURITY.md)

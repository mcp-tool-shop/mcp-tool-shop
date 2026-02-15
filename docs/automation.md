# Automation Contract

> Source of truth for every automated process that touches the marketing site.
> Humans own `overrides.json`. Automation may propose draft entries but never
> publishes without `needsHumanReview: true`.

---

## 1. Data Ownership

| File | Owner | Who writes it |
|------|-------|---------------|
| `site/src/data/projects.json` | **Generated** | `scripts/sync-org-metadata.mjs` via Sync workflow |
| `site/src/data/org-stats.json` | **Generated** | same sync script |
| `site/src/data/releases.json` | **Generated** | same sync script |
| `site/src/data/overrides.json` | **Human-curated** | Hand-edited; automation may append drafts |
| `site/src/data/collections.json` | **Human-curated** | Hand-edited only |
| `site/src/data/automation.ignore.json` | **Human-curated** | Hand-edited only |
| `site/src/data/registry/registry.json` | **Generated** | `scripts/fetch-registry.mjs` from mcp-tool-registry |
| `site/src/data/registry/registry.index.json` | **Generated** | same fetch script |

### Draft override rule

Automation (enrichment scripts, CI bots) may add new keys to `overrides.json`
**only if** the entry includes:

```json
"needsHumanReview": true
```

This flag tells the site build and any reviewer that the entry is a proposal,
not a final product page. Humans remove the flag after review.

---

## 2. Override Schema

Every key in `overrides.json` is a repo name (matching `repo` in `projects.json`).
Values follow this schema:

| Field | Type | Constraints | Required |
|-------|------|-------------|----------|
| `featured` | `boolean` | — | no |
| `tags` | `string[]` | max **6** items | no |
| `category` | `string` | see Category enum | no |
| `stability` | `string` | `stable` \| `beta` \| `experimental` | no |
| `kind` | `string` | see Kind enum | no |
| `install` | `string` | shell command, ≤ 120 chars | no |
| `tagline` | `string` | ≤ **90** chars | no |
| `goodFor` | `string[]` | max **4** items, each ≤ 120 chars | no |
| `notFor` | `string[]` | max **3** items, each ≤ 120 chars | no |
| `screenshot` | `string` | path: `/screenshots/<slug>.png` | no |
| `screenshotType` | `string` | `real` \| `placeholder` | no |
| `needsHumanReview` | `boolean` | `true` on auto-generated entries | auto-only |

### Kind enum

| Value | Description |
|-------|-------------|
| `mcp-server` | MCP protocol server |
| `cli` | Command-line tool |
| `library` | Importable package (pip, npm, NuGet) |
| `plugin` | Plugin for a host app (Claude Code, VS Code, etc.) |
| `desktop-app` | Standalone desktop application (MAUI, WinUI, Electron) |
| `vscode-extension` | VS Code / editor extension |
| `homebrew-tap` | Homebrew formula repository |
| `template` | Example / demo / reference repo |
| `meta` | Org infrastructure, profiles, registries |

### Stability enum

| Value | Meaning |
|-------|---------|
| `stable` | Production-ready, API surface locked |
| `beta` | Usable but API may change |
| `experimental` | Proof-of-concept, expect breakage |

### Category enum

| Value | Description |
|-------|-------------|
| `mcp-core` | MCP servers, discovery, routing |
| `voice` | TTS, audio, speech |
| `security` | Scanning, testing, hardening |
| `ml` | Training, fine-tuning, inference |
| `infrastructure` | Governance, provenance, ledgers |
| `desktop` | Desktop apps and control surfaces |
| `devtools` | Developer productivity and IDE tooling |
| `web` | Web capture, rendering, browser tools |
| `games` | Games and training simulations |

---

## 3. Selection Logic (Auto-Enrichment)

The enrichment script selects **3-5 repos per batch** using this priority:

### Include (highest priority first)

1. **Missing override** — repo has no entry in `overrides.json`
2. **Recently updated** — `pushedAt` within last 30 days
3. **Has releases** — at least one release in `releases.json`
4. **Has description** — GitHub description is non-empty
5. **Has language** — GitHub detected a primary language

Repos meeting more criteria rank higher. Ties broken by most recently updated.

### Exclude (hard filters, applied before ranking)

- Repo is in `automation.ignore.json`
- Repo is archived on GitHub (`archived: true` in API)
- Repo is a fork (`fork: true` in API)
- Repo already has a complete override (has `stability` + `kind` + `tagline` and
  `needsHumanReview` is absent or `false`)

### Batch size

- Default: **5** repos per run
- Configurable via `ENRICHMENT_BATCH_SIZE` environment variable
- Maximum: **10** (hard cap to keep diffs reviewable)

---

## 4. Skip List

`site/src/data/automation.ignore.json` contains repos that automation must
never propose overrides for. Reasons include:

- Org infrastructure (`.github`, profile repos)
- The marketing site itself
- Deprecated/superseded repos (prefixed with `old_`)
- Vendor forks or mirrors
- Repos the owner has explicitly excluded

Format: flat JSON array of repo names (strings).

```json
[
  ".github",
  "mcp-tool-shop.github.io",
  "old_voice-soundboard",
  "homebrew-core",
  "mcp-tool-registry",
  "mcp-examples"
]
```

To add a repo: edit `automation.ignore.json` directly. The sync and enrichment
scripts read this file at startup and skip any listed repo.

---

## 5. Workflow Budget

All automation runs on the **personal repo** (`mcp-tool-shop/mcp-tool-shop`),
not the org. This uses personal Actions minutes, not org minutes.

| Workflow | Trigger | Runner | Est. time |
|----------|---------|--------|-----------|
| Pages deploy | push to `main` (paths-filtered) | ubuntu-latest | ~30s |
| Sync org metadata | `workflow_dispatch` (manual) | ubuntu-latest | ~20s |
| Auto-enrichment | (future) `workflow_dispatch` or weekly cron | ubuntu-latest | ~60s |

---

## 6. Review Workflow

1. Automation adds draft entries to `overrides.json` with `needsHumanReview: true`
2. Automation opens a PR (never pushes directly to `main`)
3. Human reviews the PR, edits entries as needed, removes `needsHumanReview`
4. Human merges; Pages deploy fires automatically

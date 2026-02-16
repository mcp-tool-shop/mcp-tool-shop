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
| `site/src/data/registry/aliases.json` | **Human-curated** | Maps registry IDs to actual org repo names (case mismatches) |
| `site/src/data/registry/cleanup.json` | **Generated** | Upstream cleanup queue: archived, missing, aliases (from sync) |
| `site/src/data/registry/meta.json` | **Generated** | Footer nutrition facts: schema version, registry ref, sync timestamp, cleanup issue URL |
| `site/src/data/ops-history.json` | **Generated** | Rolling ops log from NameOps runs (max 30 entries, `scripts/ingest-ops.mjs`) |
| `site/src/data/promo.json` | **Human-curated** | Promotion enabled flag + safety caps (`maxNamesPerRun`, `failMode`) |
| `site/src/data/promo-queue.json` | **Human-curated** | Weekly promotion queue — slugs + channels + type |
| `site/src/data/worthy.json` | **Human-curated** | Repo worthiness rubric — criteria, scores, assessment |
| `site/src/data/recommendation-patch.json` | **Generated** | `scripts/gen-recommendation-patch.mjs` — audit artifact for recommendation patches |

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

## 3. Registry-Driven Merge Rules

The registry (`registry.json`) is the **canonical tool list**. GitHub API provides
**enrichment** (stars, language, updatedAt, releases). Overrides provide **editorial**
polish (tagline, goodFor, screenshots).

### Project flags

Every entry in `projects.json` carries two computed flags:

| Flag | Type | Default | Meaning |
|------|------|---------|---------|
| `registered` | `boolean` | `false` | Tool exists in `registry.json` |
| `unlisted` | `boolean` | `false` | Hidden from `/tools/` listing by default |
| `deprecated` | `boolean` | `false` | Tool is archived or marked deprecated in registry |

**Policy:**

- Registry tools → `registered: true`, `unlisted: false`
- Org repos **not** in registry and **not** in ignore list → `registered: false`, `unlisted: true`
- Override can set `unlisted: false` on an unregistered repo to force-show it
- `deprecated: true` is set when: registry has `deprecated: true`, OR the GitHub repo is archived

### Field precedence (who wins)

| Field | Winner | Rationale |
|-------|--------|-----------|
| `name` | Registry → GitHub → slug | Registry curates display names |
| `description` | Registry → GitHub | Registry descriptions are reviewed |
| `tags` | Override → Registry → GitHub topics | Editorial tags override all |
| `install` | Override → (computed) | Override shell commands are more useful than raw `git clone` |
| `ecosystem` | Registry only | Not present in GitHub or overrides |
| `stars` | GitHub only | Live signal |
| `language` | GitHub only | Live signal |
| `updatedAt` | GitHub only | Live signal |
| `featured` | Override only | Editorial decision |
| `category` | Override only | Editorial decision |
| `stability` | Override only | Editorial decision |
| `kind` | Override only | Editorial decision |
| `tagline` | Override only | Editorial decision |
| `goodFor` | Override only | Editorial decision |
| `notFor` | Override only | Editorial decision |
| `screenshot` | Override only | Editorial decision |
| `screenshotType` | Override only | Editorial decision |
| `deprecated` | Registry → GitHub archived | Auto-computed from registry flag or archived status |

### Merge order

1. **Start** with registry entry (if `registered: true`)
   — or empty base (if org-only repo)
2. **Overlay** GitHub API live signals (stars, language, updatedAt, description if missing)
3. **Overlay** override fields (overrides always win for editorial fields)
4. **Compute** `registered` and `unlisted` flags

### Registry ID → org repo mapping

Registry tool `id` should match the org repo `name`. When they don't match:

- The sync script logs a warning (registry tool with no matching org repo)
- The tool is still included with `registered: true` but GitHub enrichment is skipped
- These mismatches are surfaced in the registry health report

### Aliases (temporary workaround)

`site/src/data/registry/aliases.json` maps registry IDs to actual org repo names
when they differ (case mismatch, rename, etc.). This is a **band-aid**, not a
permanent solution.

**Lifecycle:**

1. Sync detects a registry tool with no matching org repo
2. Human investigates and adds an alias if the repo exists under a different name
3. Alias is used during sync to resolve the mismatch
4. Upstream fix: PR to `mcp-tool-registry` correcting the `id` or `repo` URL
5. Once merged upstream, the alias is removed from `aliases.json`

**Rules:**

- Aliases are human-curated — automation never writes to this file
- Each alias should have a corresponding entry in `cleanup.json` tracking it
- Aliases for archived repos should be retired (remove from registry instead)
- Goal: **zero aliases** — every alias is a known mismatch awaiting upstream fix

### Cleanup queue

`site/src/data/registry/cleanup.json` is a generated artifact produced by the
sync script. It captures structured data about registry hygiene issues:

- `archived[]` — registry tools pointing to archived GitHub repos
- `missing[]` — registry tools with no matching repo (not archived, just absent)
- `aliases[]` — active alias workarounds

The cleanup queue feeds into:
- The `/registry/` page (visible to visitors)
- The `registry-cleanup-issue.mjs` script (creates/updates a GitHub issue upstream)

---

## 4. Selection Logic (Auto-Enrichment)

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

## 5. Skip List

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

## 6. Workflow Budget

All automation runs on the **personal repo** (`mcp-tool-shop/mcp-tool-shop`),
not the org. This uses personal Actions minutes, not org minutes.

| Workflow | Trigger | Runner | Est. time |
|----------|---------|--------|-----------|
| Pages deploy | push to `main` (paths-filtered) | ubuntu-latest | ~30s |
| Sync org metadata | `workflow_dispatch` (manual) | ubuntu-latest | ~20s |
| Auto-enrichment | (future) `workflow_dispatch` or weekly cron | ubuntu-latest | ~60s |
| Recommendations to PR | weekly schedule (Mon 09:00 UTC) or `workflow_dispatch` | ubuntu-latest | ~30s |

---

## 7. Review Workflow

1. Automation adds draft entries to `overrides.json` with `needsHumanReview: true`
2. Automation opens a PR (never pushes directly to `main`)
3. Human reviews the PR, edits entries as needed, removes `needsHumanReview`
4. Human merges; Pages deploy fires automatically

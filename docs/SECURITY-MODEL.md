# Security Model

Threat model and security controls for the mcp-tool-shop marketing pipeline.

## Trust Boundaries

| Source | Trust Level | Controls |
|--------|-------------|----------|
| MarketIR upstream (mcpt-marketing) | **High** | Schema-validated, hash-locked, version-controlled |
| GitHub API responses | **Low** | Repo names, descriptions, topics come from arbitrary repo owners |
| User-authored overrides.json | **High** | Direct human edits, schema-validated in CI |
| Generated HTML/SVG output | **Untrusted until escaped** | All fields pass through `htmlEsc()` / `escapeXml()` |

## Data Flow

```
MarketIR (upstream)
  └→ fetch-marketir.mjs → site/src/data/marketir/ (JSON snapshot)

GitHub API
  ├→ sync-org-metadata.mjs → projects.json, org-stats.json, releases.json
  ├→ fetch-github-facts.mjs → github-facts/<slug>.json
  ├→ fetch-distribution-signals.mjs → distribution-signals/<slug>.json
  └→ gen-targets.mjs → site/public/targets/<slug>/

Generated output (HTML/SVG/MD)
  ├→ gen-presskit.mjs → site/public/presskit/<slug>/ (HTML)
  ├→ gen-go-links.mjs → site/public/go/<id>/ (HTML redirect)
  ├→ gen-placeholders.mjs → site/public/screenshots/<slug>.png (SVG→PNG)
  ├→ gen-outreach-packs.mjs → site/public/outreach/<slug>/ (MD)
  ├→ gen-partner-packs.mjs → site/public/partners/<slug>/ (MD)
  └→ gen-snippets.mjs → site/public/snippets/<slug>/ (MD)

Astro build
  └→ site/dist/ → GitHub Pages deploy
```

## Sanitization Points

All generators that produce HTML or SVG use the shared sanitization library:

- **`scripts/lib/sanitize.mjs`** — single source of truth
  - `htmlEsc(s)` — escapes `& < > " '` for HTML content and attributes
  - `escapeXml(s)` — alias for `htmlEsc` (XML needs the same characters)
  - `validateUrl(raw)` — enforces `https:` / `http:` protocol allowlist

Consumers:
- `gen-presskit.mjs` — imports `htmlEsc`, escapes all tool data in HTML output
- `gen-go-links.mjs` — imports `htmlEsc` + `validateUrl`, validates redirect targets
- `gen-placeholders.mjs` — imports `escapeXml`, escapes tool data in SVG templates

Astro pages use expression syntax `{value}` which auto-escapes output. No `set:html` is used anywhere in the codebase.

## CI Controls

### Action pinning
All GitHub Actions are pinned to commit SHAs (not version tags) to prevent supply chain attacks via tag-moving.

### Permissions
Every workflow declares explicit `permissions:` blocks with least privilege:
- `site-quality.yml` — `contents: read` (no write needed for PR checks)
- `pages.yml` — `contents: read`, `pages: write`, `id-token: write`
- Scheduled workflows — `contents: write`, `pull-requests: write` (minimum for PR creation)

### Secret scanning
`site-quality.yml` scans `site/dist/` for leaked secrets (GitHub PATs, AWS keys, API keys) on every PR. Patterns: `ghp_*`, `gho_*`, `github_pat_*`, `AKIA*`, `sk-*`.

### Dangerous URL scanning
Both CI (`site-quality.yml`) and live smoke test (`smoke-test.mjs`) scan HTML output for `javascript:`, `data:`, and `vbscript:` protocol URLs.

## Test Infrastructure

### Unit tests (`tests/unit/`)
- `sanitize.test.mjs` — validates all escape characters, XSS vectors, URL protocol rejection
- `html-output-safety.test.mjs` — proves XSS fixtures are neutralized by `htmlEsc`

### Invariant tests (`tests/invariants/`)
- `data-integrity.test.mjs` — cross-referential checks (collections → projects, overrides → projects, link URL validation, no contradictory flags)

### CI enforcement
Tests run on every PR via `site-quality.yml` (unit tests before build, invariant tests after).

## What's NOT in Scope

This is a static marketing site with no:
- User authentication or sessions
- Databases or server-side state
- PII collection or payment processing
- Dynamic API endpoints
- User-generated content (all content is author-controlled)

The attack surface is limited to: XSS via GitHub API data flowing through generators into HTML, and supply chain attacks via GitHub Actions.

# Handbook

> How the marketing site works, in plain language.

## What is this?

This repo powers [mcptoolshop.com](https://mcp-tool-shop.github.io/) — the catalog site for tools built under [mcp-tool-shop-org](https://github.com/mcp-tool-shop-org). It lists every tool, shows install commands, and hosts press kits and outreach materials.

## How tools appear on the site

1. You push a repo to `mcp-tool-shop-org`.
2. Someone runs the **Sync** workflow (Actions tab, manual trigger).
3. The repo appears in the tools directory at `/tools/`.
4. Optionally, you add an entry to `overrides.json` to polish how it looks (tagline, install command, stability badge, etc.).

That's it. The site rebuilds automatically when changes land on `main`.

## Common tasks

### Add a new tool to the site

1. Push the repo to `mcp-tool-shop-org`.
2. Go to Actions > "Sync org metadata" > Run workflow.
3. The tool appears on the next deploy.

### Polish a tool's listing

Edit `site/src/data/overrides.json`. Add an entry keyed by the repo name:

```json
"my-tool": {
  "tagline": "One-line description of what it does",
  "kind": "mcp-server",
  "stability": "beta",
  "install": "npx my-tool",
  "tags": ["search", "local"],
  "goodFor": ["Finding files by meaning", "Indexing codebases"],
  "notFor": ["Cloud-hosted search"]
}
```

See [automation.md](automation.md) for the full schema (valid `kind`, `stability`, and `category` values).

### Generate a press kit

Press kits require MarketIR data. If the tool has `publicProof: true` in overrides:

```bash
node scripts/fetch-marketir.mjs    # pull upstream data
node scripts/fetch-github-facts.mjs  # collect GitHub stats
node scripts/gen-presskit.mjs      # generate press kit
```

Output lands in `site/public/presskit/<slug>/`.

### Add a go-link (short redirect)

Edit `site/src/data/links.json` and add an entry:

```json
{
  "id": "my-link",
  "slug": "my-tool",
  "target": "https://example.com/destination",
  "channel": "github-readme"
}
```

Then regenerate: `node scripts/gen-go-links.mjs`

The link will be live at `mcptoolshop.com/go/my-link/`.

### Run tests locally

```bash
npm test              # unit tests
npm run test:invariants  # data integrity checks
npm run test:all      # both
```

### Build the site locally

```bash
cd site
npm install
npm run dev       # dev server on localhost:4321
npm run build     # production build
npm run preview   # preview the build
```

## Where things live

```
mcp-tool-shop/
  site/                     # Astro site
    src/data/               # JSON data files (the "database")
    src/pages/              # Page templates
    public/                 # Generated static assets (press kits, screenshots, etc.)
  scripts/                  # Pipeline scripts (fetch, generate, analyze)
    lib/                    # Shared utilities (sanitize, errors)
  tests/                    # Test suites
    unit/                   # Unit tests
    invariants/             # Cross-referential data checks
    fixtures/               # Test data
  docs/                     # Documentation (you are here)
  .github/workflows/        # CI/CD
```

## Glossary

| Term | Meaning |
|------|---------|
| **MarketIR** | Upstream marketing data (claims, evidence, press quotes) stored in the `mcpt-marketing` repo. Fetched and hash-verified before use. |
| **Override** | A human-curated entry in `overrides.json` that polishes how a tool appears on the site (tagline, install command, badges). |
| **Registered** | A tool that exists in the official [mcp-tool-registry](https://github.com/nicobailon/mcp-tool-registry). Gets a "registered" badge. |
| **Unlisted** | A repo that exists in the org but isn't shown in the catalog by default. Usually infrastructure repos or forks. |
| **Go-link** | A short redirect URL (e.g., `mcptoolshop.com/go/fc-npm/`) that tracks which channel referred the click. |
| **Press kit** | Auto-generated bundle (HTML + Markdown + JSON) with verified claims, GitHub stats, and quotes for a tool. |
| **Outreach pack** | Markdown bundle for reaching out to potential users/partners about a tool. |
| **Partner pack** | Markdown bundle for integration partners with technical details. |
| **Target list** | JSON file listing relevant communities, publications, or platforms for a tool's distribution. |
| **Snippet** | Pre-written copy block (tweet, post, description) ready to paste. |
| **Collection** | A curated group of tools shown on the homepage (e.g., "MCP Core Tools", "Voice Stack"). |
| **Stability badge** | `stable` / `beta` / `experimental` label shown on tool cards. |
| **Kind badge** | Tool type label: `mcp-server`, `cli`, `library`, `plugin`, `desktop-app`, etc. |
| **Enrichment** | Automated process that drafts override entries for repos that don't have them yet. Always flagged `needsHumanReview: true`. |
| **Lockfile** | `marketing.lock.json` — SHA-256 hashes of every MarketIR file. Ensures fetched data hasn't been tampered with. |
| **Slug** | URL-safe repo name used as a directory name and URL path segment (e.g., `file-compass`). |
| **Distribution signal** | Download/install counts from npm, PyPI, Docker Hub — fetched to show adoption metrics. |
| **Smoke test** | Post-deploy script that visits live pages and checks for broken links, missing content, and dangerous URLs. |

## Error codes

When a script fails, it prints a structured error like:

```
  MKT.DATA.MISSING  overrides.json not found or invalid JSON
  fix:  Run `node scripts/sync-org-metadata.mjs` to generate it.
  file: site/src/data/overrides.json
```

The code tells you what went wrong. The `fix` line tells you what to do. See [INTERNAL-MARKETING-WING.md](INTERNAL-MARKETING-WING.md) for the full error code table.

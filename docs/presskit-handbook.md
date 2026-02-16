# Presskit Handbook

> Verified facts, approved blurbs, brand assets, and a step-by-step verification recipe -- all in one place.

**Who it's for**: Journalists, reviewers, partners, and anyone writing about MCP Tool Shop.
**Not for**: Tool authors adding repos (see [Handbook](HANDBOOK.md)), or adopters forking the engine (see [Portable Core](portable-core.md)).

---

## What is MCP Tool Shop?

MCP Tool Shop is a catalog of open-source tools built for AI agents. The [mcp-tool-shop-org](https://github.com/mcp-tool-shop-org) GitHub organization hosts 99+ public repositories spanning semantic search, code analysis, voice synthesis, accessibility tooling, and Windows desktop apps.

The marketing site at [mcp-tool-shop.github.io](https://mcp-tool-shop.github.io/) lists every tool with install commands, press kits, and verified claims.

The tools use the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) -- a standard that lets AI assistants call tools over a structured API. Everything runs locally. No cloud dependencies for core functionality.

The promotion engine is available as an npm package:

```bash
npm install @mcptoolshop/promo-kit
npx promo-kit init
npx promo-kit selftest
```

See [@mcptoolshop/promo-kit on npm](https://www.npmjs.com/package/@mcptoolshop/promo-kit) for the full package docs.

---

## Boilerplate Blurbs

### 25 words

MCP Tool Shop builds open-source tools for AI agents -- semantic search, voice synthesis, code analysis, and more. Everything runs locally, verified by receipts.

### 50 words

MCP Tool Shop is an open-source catalog of 99+ tools for AI agents, built around the Model Context Protocol. Tools span semantic search, voice synthesis, code analysis, accessibility, and desktop apps. Every promotion is receipt-backed: hashed inputs, commit SHAs, and freeze modes ensure nothing is promoted in the dark.

### 100 words

MCP Tool Shop is an open-source organization building tools that AI agents use to get real work done. The catalog at mcp-tool-shop.github.io hosts 99+ public repositories spanning semantic search (File Compass), voice synthesis (Soundboard Plugin), code analysis (Brain-Dev), and more. All tools use the Model Context Protocol and run locally -- no cloud dependencies.

What sets MCP Tool Shop apart is its promotion engine: every public claim is evidence-backed, every promotion week produces hashed receipts, and governance includes freeze modes and drift detection. Anyone can independently verify a promotion by checking commit SHAs and input hashes. Build trust from receipts, not promises.

---

## How Verification Works

MCP Tool Shop uses a receipt-based verification system. Every time a tool is promoted, the pipeline records:

1. **Which inputs were used** -- hashed with SHA-256
2. **Which commit generated the outputs** -- Git SHA
3. **When it happened** -- ISO timestamp
4. **What decisions were made** -- promote, skip, or defer, each with a numeric score

This data is published as a JSON receipt alongside the promotion materials.

### The canonical link path

```
Presskit Handbook (you are here)
  --> Trust Center (/trust/)
    --> Receipts index (/receipts/)
      --> Individual promo week (/promo/<week>/)
        --> Verify Box (SHA comparison)
```

Bidirectional links also connect:

- [Proof pages](https://mcp-tool-shop.github.io/proof/) -- verified claims per tool
- [Press pages](https://mcp-tool-shop.github.io/press/) -- press boilerplate per tool
- [Press kits](https://mcp-tool-shop.github.io/presskit/) -- downloadable HTML + JSON + Markdown bundles

### What makes a claim "proven"?

A claim is **proven** when it has at least one piece of reproducible evidence: a benchmark result, a GitHub fact (stars, releases), a third-party review, or an auditable test output. Claims without evidence are labeled **aspirational**. Claims about what a tool *doesn't* do are **anti-claims** -- explicit scope boundaries that prevent misrepresentation.

---

## Verification Example: Step by Step

Want to verify a specific promotion week? Here is the full walkthrough.

### Step 1: Pick a week

Visit [mcp-tool-shop.github.io/receipts/](https://mcp-tool-shop.github.io/receipts/) and choose a promotion week (e.g., `2026-02-10`).

### Step 2: Open the promo page

Navigate to `/promo/2026-02-10/`. The page shows:

- Which tools were promoted
- The promotion type (own / partner / cross-promo)
- A **Verify this week** box with commit SHA and input hashes

### Step 3: Clone and checkout

```bash
git clone https://github.com/mcp-tool-shop/mcp-tool-shop.git
cd mcp-tool-shop
git checkout <commit-sha-from-verify-box>
```

### Step 4: Hash the inputs

For each input file listed in the verification bundle:

```bash
sha256sum site/src/data/promo-decisions.json
sha256sum site/src/data/experiment-decisions.json
sha256sum site/src/data/governance.json
```

### Step 5: Compare

If your computed hashes match the hashes in the verification bundle, the promotion used exactly those inputs. No data was altered after the fact.

### Machine-readable receipt

Every build also produces `trust.json` at the site root:
[mcp-tool-shop.github.io/trust.json](https://mcp-tool-shop.github.io/trust.json)

This JSON file contains the commit SHA, artifact hashes, MarketIR lock hash, and generation timestamp -- suitable for automated verification pipelines.

---

## Logos and Brand Usage

### Files

| File | Location | Size | Format |
|------|----------|------|--------|
| `logo.png` | Repo root | 1536 x 1024 | PNG |

### Usage rules

- Use the logo at its original aspect ratio (3:2). Do not crop or stretch.
- Minimum display size: 120px wide.
- Preferred background: dark (`#0d1117` or similar). The logo is designed for dark backgrounds.
- Do not add effects (drop shadows, gradients, borders) to the logo.
- Do not place the logo on busy or low-contrast backgrounds.

### Name

- Full name: **MCP Tool Shop**
- GitHub org: `mcp-tool-shop-org`
- Marketing site: `mcp-tool-shop.github.io`
- Do not abbreviate to "MCTS" or "MTS" in published copy.
- Acceptable short forms: "Tool Shop" (in context where MCP is already established).

---

## Screenshots Checklist

When including screenshots in articles or reviews:

- [ ] Use the live site at [mcp-tool-shop.github.io](https://mcp-tool-shop.github.io/), not localhost
- [ ] Use dark theme (the site default)
- [ ] Capture at 1280 x 800 minimum resolution
- [ ] Include the page header with site navigation for context
- [ ] For tool pages: show the install command and badges
- [ ] For the Trust Center: show the freshness metrics and freeze state
- [ ] Do not crop out the footer (it contains provenance info)
- [ ] Placeholder screenshots are labeled "preview" on the site -- prefer real screenshots when available

---

## FAQ

### Is MCP Tool Shop a registry?

No. The [mcp-tool-registry](https://github.com/nicobailon/mcp-tool-registry) is the upstream registry. MCP Tool Shop is a **promotion and catalog engine** that consumes the registry and adds editorial polish, verification, and press infrastructure.

### Are the tools free?

Yes. All tools in mcp-tool-shop-org are open source.

### How often is the site updated?

The site rebuilds automatically on every push to `main`. Org metadata syncs are triggered manually. Enrichment, screenshots, and target lists run on weekly schedules.

### Can I fork the promotion engine?

Yes. Install via `npm install @mcptoolshop/promo-kit`, then run `npx promo-kit init` and `npx promo-kit selftest`. See [Portable Core](portable-core.md) for the full contract.

### How do I request a press kit for a specific tool?

If the tool has `publicProof: true` in the site data, its press kit is auto-generated and lives at `/presskit/<slug>/`. If it doesn't have one yet, [open an issue](https://github.com/mcp-tool-shop/mcp-tool-shop/issues).

### How do I report an error on a press page?

[Open an issue](https://github.com/mcp-tool-shop/mcp-tool-shop/issues) with the tool slug and the incorrect claim.

### Where is the Trust Center?

[mcp-tool-shop.github.io/trust/](https://mcp-tool-shop.github.io/trust/)

---

## Contact

- **Issues**: [github.com/mcp-tool-shop/mcp-tool-shop/issues](https://github.com/mcp-tool-shop/mcp-tool-shop/issues)
- **Email**: 64996768+mcp-tool-shop@users.noreply.github.com
- **Press pages**: [mcp-tool-shop.github.io/press/](https://mcp-tool-shop.github.io/press/)
- **Proof pages**: [mcp-tool-shop.github.io/proof/](https://mcp-tool-shop.github.io/proof/)
- **Trust Center**: [mcp-tool-shop.github.io/trust/](https://mcp-tool-shop.github.io/trust/)

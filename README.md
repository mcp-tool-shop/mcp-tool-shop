<div align="center">

<img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/mcp-tool-shop.github.io/readme.png" alt="MCP Tool Shop" width="400">

**The catalog and publishing engine behind [mcptoolshop.com](https://mcptoolshop.com/).**

[![CI](https://github.com/mcp-tool-shop/mcp-tool-shop/actions/workflows/site-quality.yml/badge.svg)](https://github.com/mcp-tool-shop/mcp-tool-shop/actions/workflows/site-quality.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Live Site](https://img.shields.io/badge/Live%20Site-mcptoolshop.com-blue)](https://mcptoolshop.com/)

[Live Site](https://mcptoolshop.com/) · [Get started](https://mcptoolshop.com/start/) · [Browse Tools](https://mcptoolshop.com/tools/) · [Ecosystem spec](https://github.com/mcp-tool-shop-org/.github/blob/main/docs/ECOSYSTEM.md)

</div>

---

## Who this is for

- **Contributors and tool authors** in [mcp-tool-shop-org](https://github.com/mcp-tool-shop-org) who want a repository listed with a verified install command and an area.
- **Visitors** looking for local-first MCP servers, training pipelines, media tooling, agent infrastructure, or game tooling. Start at [mcptoolshop.com/start](https://mcptoolshop.com/start/).
- **Other orgs** who want to run the catalog engine for their own organization. See [Portable Core](docs/portable-core.md).

**Not for**: end users of a single tool — go to that tool's [catalog page](https://mcptoolshop.com/tools/) or its own README.

## 60-Second Quickstart

```bash
git clone https://github.com/mcp-tool-shop/mcp-tool-shop.git
cd mcp-tool-shop/site
npm install
npm run dev          # localhost:4321
```

To add a tool: push a repo to [mcp-tool-shop-org](https://github.com/mcp-tool-shop-org), then run Actions > "Sync org metadata". The tool appears on the next deploy.

## Featured tools

Install commands name packages this organization owns. Unrelated packages that share a repository name (`motif`, `roll`, `shipcheck` unscoped) are never listed.

- **[Tool Compass](https://github.com/mcp-tool-shop-org/tool-compass)** — find MCP tools by describing what you need. `npx @mcptoolshop/tool-compass`
- **[Comfy Headless](https://github.com/mcp-tool-shop-org/comfy-headless)** — drive ComfyUI from Python, no node canvas. `pip install comfy-headless`
- **[Backpropagate](https://github.com/mcp-tool-shop-org/backpropagate)** — headless fine-tuning with GGUF export. `pip install backpropagate`
- **[Ollama Intern MCP](https://github.com/mcp-tool-shop-org/ollama-intern-mcp)** — delegate bulk analysis to a local Ollama model. `npx ollama-intern-mcp`
- **[Shipcheck](https://github.com/mcp-tool-shop-org/shipcheck)** — the release quality gate. `npx @mcptoolshop/shipcheck audit`

The full classified catalog is the [ecosystem specification](https://github.com/mcp-tool-shop-org/.github/blob/main/docs/ECOSYSTEM.md).

## Proof

- Catalog data is generated from the GitHub organization and the [ecosystem catalog](https://github.com/mcp-tool-shop-org/.github/blob/main/docs/catalog.yaml). Editorial taglines are reviewed by hand. Install commands are not guessed from the repository name.
- Tests cover the merge rules, including the invariant that an install command is only published when this organization owns the package.
- Zero runtime dependencies in the catalog engine besides `yazl`.

## Stack

```
Python · TypeScript · Rust · C# · Godot 4 · Astro
MCP · Ollama · ComfyUI · SQLite · CUDA
Windows-first · NVIDIA · local-first
```

## Principles

Everything runs locally; no cloud dependency for core functionality. Tools compose through the Model Context Protocol. Data files are generated from the GitHub organization, never hand-edited, and every published claim links to something you can verify. Accessibility is built in, not bolted on.

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [Quickstart](docs/quickstart.md) | Zero to trust receipt in 5 minutes (npm package) |
| [Handbook](docs/HANDBOOK.md) | How the site works, common tasks, glossary |
| [Presskit Handbook](docs/presskit-handbook.md) | Brand assets, blurbs, verification examples for press |
| [Automation contract](docs/automation.md) | Data ownership, override schema, merge rules |
| [Portable Core](docs/portable-core.md) | Fork the engine for your own org |
| [Security model](docs/SECURITY-MODEL.md) | Threat model, sanitization, CI controls |
| [Ops Runbook](docs/OPS-RUNBOOK.md) | Weekly operations, promotion pipeline, error codes |
| [Contributing](CONTRIBUTING.md) | Local dev setup, testing |

## Security & Data Scope

| Aspect | Detail |
|--------|--------|
| **Data touched** | GitHub org metadata (via API), tool manifests (JSON), site build output |
| **Data NOT touched** | No user data, no analytics, no external tracking services |
| **Permissions** | Read: GitHub API (org repos, releases). Write: site data files, build output |
| **Network** | GitHub API only — for org metadata sync |
| **Telemetry** | None collected or sent |

See [SECURITY.md](SECURITY.md) and [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md) for full details.

## Scorecard

| Category | Score |
|----------|-------|
| A. Security | 10 |
| B. Error Handling | 10 |
| C. Operator Docs | 10 |
| D. Shipping Hygiene | 10 |
| E. Identity (soft) | 10 |
| **Overall** | **50/50** |

> Full audit: [SHIP_GATE.md](SHIP_GATE.md) · [SCORECARD.md](SCORECARD.md)

## Support

- **Issues**: [github.com/mcp-tool-shop/mcp-tool-shop/issues](https://github.com/mcp-tool-shop/mcp-tool-shop/issues)
- **Press inquiries**: [Presskit Handbook](docs/presskit-handbook.md)

<div align="center">

**[mcp-tool-shop-org](https://github.com/mcp-tool-shop-org)** · **[mcptoolshop.com](https://mcptoolshop.com/)**

Built by <a href="https://mcptoolshop.com/">MCP Tool Shop</a>

</div>

<div align="center">

<img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/mcp-tool-shop.github.io/readme.png" alt="MCP Tool Shop" width="400">

**Local AI research and tooling, built in the open.**

Local models, device routing, datasets, training and verification.<br>
The work lives at [mcp-tool-shop-org](https://github.com/mcp-tool-shop-org), and most of it is measured on one Windows workstation with an RTX 5090.

[mcptoolshop.com](https://mcptoolshop.com/) · [The Bench, the research newsletter](https://mcp-tool-shop-org.github.io/rnd/) · [readouts, verified knowledge](https://mcp-tool-shop-org.github.io/readouts/) · [Every tool](https://mcptoolshop.com/tools/)

</div>

---

## What I'm working on

### Research

- **[rnd](https://github.com/mcp-tool-shop-org/rnd)**: the research bench. Sourced entries, experiments run on the rig with their receipts, and a weekly watch of NVIDIA, CUDA and the local-inference projects. Its newsletter is [The Bench](https://mcp-tool-shop-org.github.io/rnd/).
- **[readouts](https://github.com/mcp-tool-shop-org/readouts)**: verified, source-backed SQLite knowledge bases. A topic moves here from rnd once its claims are checked. [What's new](https://mcp-tool-shop-org.github.io/readouts/#whats-new).

### Local inference and routing

- **[interlock](https://github.com/mcp-tool-shop-org/interlock)**: a local AI device router for the RTX 5090 and the Intel NPU and iGPU. It measures before it routes. A prototype.
- **[offrig](https://github.com/mcp-tool-shop-org/offrig)**: run big models and GPU jobs on rented RunPod GPUs, with the price planned before anything starts.
- **[ollama-intern-mcp](https://github.com/mcp-tool-shop-org/ollama-intern-mcp)**: a local intern for Claude Code. It hands bulk analysis to a model running in Ollama.

### Training and datasets

- **[backpropagate](https://github.com/mcp-tool-shop-org/backpropagate)**: headless fine-tuning with VRAM-aware defaults and GGUF export for Ollama.
- **[aspire-si](https://github.com/mcp-tool-shop-org/aspire-si)**: train a model to take on a teacher's judgment through adversarial dialogue, with a learned critic.

### Agents and verification

- **[testing-os](https://github.com/dogfood-lab/testing-os)**, home of **Atlas**: a map of each repository (its parts, the workflows that start work, and what a change reaches) that CI checks on every push.
- **[role-os](https://github.com/mcp-tool-shop-org/role-os)**: staffs coding-agent work through role contracts, missions and a critic jury.
- **[loadout-os](https://github.com/mcp-tool-shop-org/loadout-os)**: routes the right context to the model when it's needed, instead of loading it all at once.
- **[shipcheck](https://github.com/mcp-tool-shop-org/shipcheck)**: the release quality gate every repository passes before it ships.

### Media and music

- **[comfy-headless](https://github.com/mcp-tool-shop-org/comfy-headless)**: drive ComfyUI from Python, with no node canvas.
- **[ai-jam-sessions](https://github.com/mcp-tool-shop-org/ai-jam-sessions)**: teach an AI to play piano and guitar, sing, and listen.

The full list, sorted by area, is at [mcptoolshop.com/tools](https://mcptoolshop.com/tools/).

## How the work is done

- **Measured, with receipts.** A number about the rig comes from a run on the rig, and the run's record is committed beside it.
- **Claims are tiered.** Every source is labelled by tier, and a claim stays unverified until something checks it.
- **Local first.** Models run on the workstation. A rented GPU is used only when a job needs more, and its price is planned first.
- **Small steps in the open.** Changes land by pull request with their tests, and each repository keeps a map that CI checks.

---

## This repository

The catalog and publishing engine behind [mcptoolshop.com](https://mcptoolshop.com/). It reads the GitHub organization and the [ecosystem catalog](https://github.com/mcp-tool-shop-org/.github/blob/main/docs/catalog.yaml), merges the hand-reviewed overrides, and builds the site. An install command is published only when the organization owns the package, so it is never guessed from a repository's name.

[![Deploy](https://github.com/mcp-tool-shop/mcp-tool-shop/actions/workflows/pages.yml/badge.svg)](https://github.com/mcp-tool-shop/mcp-tool-shop/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

### Quickstart

Node 22, on Windows, macOS or Linux.

```bash
git clone https://github.com/mcp-tool-shop/mcp-tool-shop.git
cd mcp-tool-shop/site
npm install
npm run dev          # localhost:4321
```

To list a tool, push its repository to [mcp-tool-shop-org](https://github.com/mcp-tool-shop-org) and run the "Sync org metadata" action. It appears on the next deploy. Other organizations can run the engine for their own catalog: see [Portable Core](docs/portable-core.md).

### Documentation

| Doc | Purpose |
|-----|---------|
| [Handbook](docs/HANDBOOK.md) | How the site works, common tasks, glossary |
| [Automation contract](docs/automation.md) | Data ownership, override schema, merge rules |
| [Ops Runbook](docs/OPS-RUNBOOK.md) | Weekly operations, the promotion pipeline, error codes |
| [Quickstart](docs/quickstart.md) | Zero to a trust receipt in 5 minutes (npm package) |
| [Presskit Handbook](docs/presskit-handbook.md) | Brand assets, blurbs, verification examples for press |
| [Security model](docs/SECURITY-MODEL.md) | Threat model, sanitization, CI controls |
| [Contributing](CONTRIBUTING.md) | Local development and testing |

### Security and data scope

| Aspect | Detail |
|--------|--------|
| **Data touched** | GitHub organization metadata (through the API), tool manifests (JSON), the site's build output |
| **Data not touched** | No user data, no analytics, no external tracking services |
| **Permissions** | Read: the GitHub API (organization repositories and releases). Write: the site's data files and build output |
| **Network** | The GitHub API only, for the organization metadata sync |
| **Telemetry** | None collected or sent |

See [SECURITY.md](SECURITY.md) and [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md) for the full model. The release gate's results are in [SHIP_GATE.md](SHIP_GATE.md) and [SCORECARD.md](SCORECARD.md). Issues go to [the issue tracker](https://github.com/mcp-tool-shop/mcp-tool-shop/issues).

<div align="center">

**[mcp-tool-shop-org](https://github.com/mcp-tool-shop-org)** · **[mcptoolshop.com](https://mcptoolshop.com/)**

</div>

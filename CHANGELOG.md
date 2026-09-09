# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-09-08

### Changed

- Site rewrite: homepage, tools catalog, releases, about, and support pages now describe the
  organization's actual output (MCP servers, training pipelines, media tooling, agent
  infrastructure, developer tooling, games, ledger tools). The weekly-spotlight framing and
  the "Syntropy above all else" tagline are gone.
- Navigation and footer simplified; the footer no longer advertises promo-kit.
- Tools catalog defaults to shipped and in-development repositories, with status, ecosystem,
  language, type, and stability filters. The registry / org-only distinction is no longer
  exposed to visitors, and catalog ghosts (registry entries with no repository) are not rendered.
- Release notes are summarized as plain text: blockquotes, HTML, tables, markdown emphasis and
  links are stripped by the sync script and again at render time for existing data.
- Site title is "MCP Tool Shop"; page titles are suffixed consistently.
- Homepage and About now present the sister organization dogfood-lab (testing-os, study-swarm)
  from a curated `site/src/data/dogfood-lab.json`; the sync pipeline is unchanged.

### Fixed

- Daily Refresh had failed every day since 2026-05-20: `overrides.json` carried keys for
  renamed (`Attestia` to `attestia`), archived (`ai-loadout`, `game-foundry-os`) and removed
  (`creator-studio-os`) repositories, and `collections.json` referenced two of them.
- 53 install commands in `overrides.json` named packages that do not exist or belong to other
  publishers (for example `npm install shipcheck`). Every install command now names a package
  verified on npm or PyPI under this organization; commands with no published package were removed.
- 13 UTF-8 mojibake sequences in editorial taglines.
- Display names for unregistered repositories respect common acronyms ("MCP Voice Soundboard",
  "XRPL Lab") instead of naive title case.

## [1.0.0] - 2026-05-15

### Added

- SHIP_GATE.md and SCORECARD.md for product audit trail
- Security & Data Scope section in README
- CHANGELOG.md
- README badges: CI status, MIT license, Live Site
- "Built by MCP Tool Shop" footer per org convention
- Repo Knowledge DB entry (thesis, architecture, conventions, relationships)

### Changed

- Formalized as v1.0.0 stable marketing platform
- README logo points to canonical brand URL (`mcp-tool-shop-org/brand` raw) instead of repo-local `logo.png`
- Replaced root `logo.png` with the correct mcp-tool-shop toolbox logo (was incorrectly the promo-kit megaphone)
- Updated all live-site links from `mcp-tool-shop.github.io` to canonical `mcptoolshop.com` domain
- Updated test counts in README Proof section (566 = 449 unit + 117 invariant)

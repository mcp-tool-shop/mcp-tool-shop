# Copilot Instructions — mcp-tool-shop (Astro Site)

This repository is the **public website** (Astro). It owns:
- `site/` (Astro app)
- `site/public/screenshots/` (tool screenshots)
- the homepage widgets (e.g., “Recently shipped”)
- daily/weekly refresh workflows

## Daily refresh goal
Keep the site fresh by updating generated data daily and rebuilding Pages.

## Key rules
- Generated JSON is not hand-edited (follow repo contract).
- Prefer deterministic outputs (stable sorting, consistent formatting).
- If adding automation: one daily workflow, build before commit, commit only if changed.

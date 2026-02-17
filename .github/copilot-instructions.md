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

This repo is the **Site Repo** (mcp-tool-shop). It is the source of truth for the [mcp-tool-shop.org](https://mcp-tool-shop.org) website.
Features:
- **Daily Refresh**: A GitHub Action runs every day at 13:00 UTC to sync org metadata (`npm run sync`), generate a daily note (`npm run daily:note`), and commit changes.
- **Daily Note**: A script (`scripts/gen-daily-note.mjs`) picks a random "insight" from a list to keep the homepage freshness indicator alive.
- **Org Stats**: `src/data/org-stats.json` powers the "Last refreshed" timer on the /releases page.

# Contributing

**One-line promise**: Everything you need to contribute to the mcp-tool-shop marketing site.

**Who it's for**: Developers contributing to the site codebase.
**Not for**: Tool authors wanting to list a tool (see [Handbook](docs/HANDBOOK.md)), or press contacts (see [Presskit Handbook](docs/presskit-handbook.md)).

---

## Local development

```bash
cd site
npm install
npm run dev       # dev server on localhost:4321
npm run build     # production build to site/dist/
npm run preview   # preview production build
```

## Project structure

```
site/
  src/
    data/         # JSON data files (projects, etc.)
    layouts/      # Astro layout components
    pages/        # File-based routing (*.astro)
    styles/       # Global CSS
  public/         # Static assets (favicon, images)
```

## Deployment

Push to `main` triggers the GitHub Pages workflow automatically (filtered to `site/**` changes only). You can also trigger a deploy manually from the Actions tab.

## Running tests

```bash
npm test                 # unit tests
npm run test:invariants  # cross-referential data integrity
npm run test:all         # both suites
```

All PRs must pass `site-quality.yml` checks: unit tests, invariant tests, schema validation, internal link check, and secret scan.

## Useful links

- [Handbook](docs/HANDBOOK.md) -- how the site works, common tasks, glossary
- [Automation contract](docs/automation.md) -- what automation owns vs. humans
- [Security model](docs/SECURITY-MODEL.md) -- sanitization rules and CI controls
- [Trust Center](https://mcp-tool-shop.github.io/trust/) -- verification infrastructure
- [Presskit Handbook](docs/presskit-handbook.md) -- brand assets and press blurbs

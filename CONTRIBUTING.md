# Contributing

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

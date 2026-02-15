# Legacy URL Redirects

When mcptoolshop.com migrated from the flat-HTML site (`mcp-tool-shop-org/mcp-tool-shop.github.io`) to the Astro catalog (`mcp-tool-shop/mcp-tool-shop`), we preserved inbound links with two layers of redirects.

## Layer 1: Old `.github.io` repo (archived)

The old repo at `mcp-tool-shop-org/mcp-tool-shop.github.io` was replaced with redirect shims and archived. Anyone visiting `mcp-tool-shop-org.github.io/*.html` gets redirected to the canonical Astro site.

## Layer 2: Astro site compatibility files

Static HTML files in `site/public/` handle bookmarks from the CNAME overlap period (when `mcptoolshop.com` briefly served the old flat-HTML site).

| Old URL | Redirect Target |
|---------|----------------|
| `/brain-dev.html` | `/tools/brain-dev/` |
| `/comfy-headless.html` | `/tools/comfy-headless/` |
| `/context-window-manager.html` | `/tools/context-window-manager/` |
| `/file-compass.html` | `/tools/file-compass/` |
| `/tool-compass.html` | `/tools/tool-compass/` |
| `/voice-soundboard.html` | `/tools/voice-soundboard/` |
| `/registry.html` | `/tools/` |
| `/cid-badge.html` | `/tools/` |
| `/cid-publish.html` | `/tools/` |
| `/cid-registry.html` | `/tools/` |
| `/claude-fresh.html` | `/tools/` |
| `/context-bar.html` | `/tools/` |

Pages without a direct tool page match redirect to `/tools/`.

## Regenerating

```bash
node scripts/gen-legacy-redirects.mjs
```

## Verification

The post-deploy smoke test (`scripts/smoke-test.mjs`) checks three legacy URLs on every deploy. The full set is verified by the internal link checker in the `site-quality` CI workflow.

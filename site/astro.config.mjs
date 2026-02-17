// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'node:fs';

// Load site URL from kit config
let kitSiteUrl = 'https://mcptoolshop.com';
try {
  const kitConfig = JSON.parse(readFileSync('../kit.config.json', 'utf8'));
  if (kitConfig.site?.url) kitSiteUrl = kitConfig.site.url;
} catch { /* fail soft — use default */ }

// https://astro.build/config
export default defineConfig({
  site: kitSiteUrl,
  trailingSlash: 'always',
  integrations: [sitemap({
    filter: (page) => !page.includes('/lab/'),
  })],
});

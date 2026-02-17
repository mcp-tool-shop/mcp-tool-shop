/**
 * Generate all daily dynamic content.
 * Wrapper script for:
 * - Todays Picks
 * - Catalog Changelog
 * - Trending
 * - Screenshot Gallery
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Helper to run scripts relative to repo root
function run(script) {
  console.log(`\n Running ${script}...`);
  try {
    execSync(`node scripts/${script}`, { stdio: 'inherit', cwd: ROOT });
  } catch (e) {
    console.error(`Failed to run ${script}:`, e.message);
    process.exit(1);
  }
}

// Run sequence
run('gen-todays-picks.mjs');
run('gen-catalog-changelog.mjs');
run('gen-trending.mjs');
run('gen-screenshot-gallery.mjs');
run('gen-newsletter.mjs');
run('gen-readme-health.mjs');

console.log('\n Daily dynamic content generation complete.');

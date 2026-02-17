import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { auditImages } from './lib/image-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPORT_MD_PATH = path.join(ROOT, 'reports', 'site-images.md');
const REPORT_JSON_PATH = path.join(ROOT, 'reports', 'site-images.json');

// Ensure reports directory exists
if (!fs.existsSync(path.dirname(REPORT_MD_PATH))) {
  fs.mkdirSync(path.dirname(REPORT_MD_PATH), { recursive: true });
}

const result = auditImages(ROOT);

if (process.argv.includes('--next') || process.argv.includes('--todo')) {
  console.log('\n🎯 STOREFRONT FOUNDATION: Today\'s Focus\n');

  // 1. Featured Placeholders (Highest Priority)
  const featuredPlaceholders = result.details
    .filter(r => r.isFeatured && r.status === 'placeholder')
    .sort((a, b) => (a.repoExists === b.repoExists) ? 0 : a.repoExists ? -1 : 1) // Prioritize actionable
    .slice(0, 5);
  
  console.log(`\n📌 UPGRADE FEATURED PLACEHOLDERS (${featuredPlaceholders.length} ready):`);
  featuredPlaceholders.forEach(t => {
     console.log(`   - ${t.id} ${t.repoExists ? '✅ Repo Found' : '⚠️ Repo Missing'}`);
  });
  if(featuredPlaceholders.length === 0) console.log('   (None! Great job.)');

  // 2. Standard Missing (Actionable Backlog)
  const standardMissing = result.details
    .filter(r => !r.isFeatured && r.status === 'missing' && !r.isInternal && r.repoExists)
    .slice(0, 10);
  
  console.log(`\n📌 FILL STANDARD GAPS (Easy Wins - Repo Exists):`);
  standardMissing.forEach(t => {
     console.log(`   - ${t.id}`);
  });

   // 3. Featured Missing (Critical - Should be 0)
   const featuredMissing = result.details.filter(r => r.isFeatured && r.status === 'missing' && !r.isInternal);
   if (featuredMissing.length > 0) {
      console.log(`\n🚨 CRITICAL: FEATURED MISSING (${featuredMissing.length}) - FIX IMMEDIATELY:`);
      featuredMissing.forEach(t => console.log(`   - ${t.id}`));
   }

  console.log('\nRun "node scripts/stage-screenshot.mjs <path/to/image> <slug>" to process.');
  process.exit(0);
}

// Generate JSON report
fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(result, null, 2));
console.log(`Generated JSON report at ${REPORT_JSON_PATH}`);

// Helper to render table rows
function renderTableRows(items) {
  if (items.length === 0) return '_None_';
  let rows = '| Tool (ID) | Status | Repo? | Path |\n| :--- | :--- | :--- | :--- |\n';
  items.forEach(r => {
    const statusIcon = r.status === 'real' ? '✅' : (r.status === 'placeholder' ? '⚠️' : '❌');
    const repoIcon = r.repoExists ? '✅' : '❓';
    rows += `| **${r.id}** | ${statusIcon} ${r.status} | ${repoIcon} | \`${r.path}\` |\n`;
  });
  return rows;
}

// Group findings
const featuredMissing = result.details.filter(r => r.isFeatured && r.status === 'missing' && !r.isInternal);
const standardMissing = result.details.filter(r => !r.isFeatured && r.status === 'missing' && !r.isInternal);
const internalTools = result.details.filter(r => r.isInternal);
const featuredPlaceholders = result.details.filter(r => r.isFeatured && r.status === 'placeholder');
const standardPlaceholders = result.details.filter(r => !r.isFeatured && r.status === 'placeholder');
const real = result.details.filter(r => r.status === 'real');

// Generate Markdown report
let mdContent = `# Site Images Report

Generated on: ${new Date(result.timestamp).toLocaleString()}

## strict-mode-gate
- **Featured Missing**: ${featuredMissing.length} (Must be 0)
- **Standard Missing**: ${standardMissing.length} (Should be 0)

## Summary
- **Total Tools**: ${result.summary.total}
- **Real Screenshots**: ${result.summary.real}
- **Placeholders**: ${result.summary.placeholder}
- **Missing**: ${result.summary.missing}

## Featured Missing (High Priority)
${renderTableRows(featuredMissing)}

## Featured Placeholders (Upgrade these first!)
${renderTableRows(featuredPlaceholders)}

## Standard Placeholders
${renderTableRows(standardPlaceholders)}

## Standard Missing (Backlog)
${renderTableRows(standardMissing)}

## Real Screenshots (Done)
${renderTableRows(real)}

## Internal / Ignored
${renderTableRows(internalTools)}
`;

fs.writeFileSync(REPORT_MD_PATH, mdContent);
console.log(`Generated Markdown report at ${REPORT_MD_PATH}`);

import path from 'path';
import { fileURLToPath } from 'url';
import { auditImages } from './lib/image-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

console.log('Verifying site images...');
const result = auditImages(ROOT);

const failures = [];
const warnings = [];

for (const tool of result.details) {
  if (tool.status === 'missing') {
    if (tool.isInternal) {
      warnings.push(`[WARNING] Internal tool ${tool.id} is missing screenshot at ${tool.path}`);
    } else {
      failures.push(`[FAILURE] Front-door tool ${tool.id} is missing screenshot at ${tool.path}`);
    }
  }
}

if (warnings.length > 0) {
  console.log('\nWarnings:');
  warnings.forEach(w => console.log(w));
}

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(f));
  console.log(`\nVerification FAILED: ${failures.length} missing screenshots for front-door tools.`);
  process.exit(1);
} else {
  console.log('\nVerification PASSED: All front-door tools have screenshots.');
  process.exit(0);
}

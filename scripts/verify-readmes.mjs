import path from 'path';
import { fileURLToPath } from 'url';
import { auditReadmes } from './lib/readme-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // mcp-tool-shop root

console.log('Verifying front-door tool READMEs...');

try {
  const allIssues = auditReadmes(ROOT);
  
  // Filter only failures for exit code
  const failures = allIssues.filter(i => i.status === 'fail' || i.status === 'missing-repo' || i.status === 'missing-readme');
  const warnings = allIssues.filter(i => i.status === 'warn');

  if (failures.length > 0) {
    console.log('\n❌ Found CRITICAL issues with front-door READMEs:');
    failures.forEach(issue => {
      const type = issue.isFeatured ? '[FEATURED]' : '';
      const reason = issue.missing ? issue.missing.join(', ') : (issue.status === 'missing-repo' ? 'Repo Not Found' : 'README Not Found');
      console.log(`[${issue.id}] ${type} FAIL: ${reason}`);
      if (issue.repoPath) console.log(`  at ${issue.repoPath}`);
    });
    console.log(`\nFound ${failures.length} failing READMEs.`);
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  Found potential improvements (Warnings):');
    warnings.forEach(issue => {
      const type = issue.isFeatured ? '[FEATURED]' : '';
      const details = issue.warnings ? issue.warnings.join(', ') : 'Check README content';
      console.log(`[${issue.id}] ${type} WARN: ${details}`);
    });
  }

  if (failures.length > 0) {
    process.exit(1); 
  } else {
    if (warnings.length > 0) console.log('\nNote: Warnings do not fail the build.');
    console.log('\nAll checked front-door READMEs passed critical checks.');
    process.exit(0);
  }
} catch (error) {
  console.error('Error running README audit:', error);
  process.exit(1);
}

import fs from 'fs';
import path from 'path';
import { loadRegistry, getToolStatus, findRepoPath } from './front-door.mjs';

export function auditReadmes(shopRoot) {
    const { registry, overrides } = loadRegistry(shopRoot);
    
    // shopRoot is `c:\workspace\mcp-tool-shop`
    // workspaceRoot is usually `c:\workspace`
    const workspaceRoot = path.dirname(shopRoot); 

    const results = [];

    for (const tool of registry) {
      const id = tool.id;
      const override = overrides[id] || {};
      const { isInternal, isFeatured } = getToolStatus(id, tool, override);
      
      // Skip internal tools
      if (isInternal) continue;

      const repoPath = findRepoPath(workspaceRoot, id, shopRoot);

      if (!repoPath) {
          results.push({ id, status: 'missing-repo', path: null, isFeatured });
          continue;
      }

      const readmePath = path.join(repoPath, 'README.md');
        if (!fs.existsSync(readmePath)) {
             results.push({ id, status: 'missing-readme', path: path.relative(workspaceRoot, repoPath), isFeatured });
             continue;
        }

        const content = fs.readFileSync(readmePath, 'utf-8');
        
        // Check for specific sections
        const hasInstall = /install|npm i|pip install|yarn add|pnpm add/i.test(content);
        const hasUsage = /usage|quick start|demo|example|getting started/i.test(content);
        
        // Foundation Week: Only these are failures
        const missingCritical = [];
        if (!hasInstall && !isInternal) missingCritical.push('Install/Setup');
        if (!hasUsage && !isInternal) missingCritical.push('Usage/Example');

        // Foundation Week: These are warnings/suggestions
        const hasLicense = /license|img\.shields\.io/i.test(content);
        const hasLinks = /github\.com|issues|discussions/i.test(content);
        const hasMedia = /!\[.*\]\(.*\)|\<img/i.test(content); // Basic image check (logo/screenshot)

        const warnings = [];
        if (!hasLicense) warnings.push('License Info');
        if (!hasLinks) warnings.push('Repo Links'); 
        if (!hasMedia && isFeatured) warnings.push('Logo or Visuals'); // Only warn featured for visuals

        if (missingCritical.length > 0 || warnings.length > 0) {
            results.push({ 
                id, 
                status: missingCritical.length > 0 ? 'fail' : 'warn',
                missing: missingCritical,
                warnings: warnings,
                repoPath: path.relative(workspaceRoot, repoPath),
                isFeatured
            });
        }
    }

    // sort for determinism
    results.sort((a, b) => a.id.localeCompare(b.id));

    return results;
}

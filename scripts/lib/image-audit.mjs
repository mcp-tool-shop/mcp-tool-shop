import fs from 'fs';
import path from 'path';
import { loadRegistry, getToolStatus, findRepoPath } from './front-door.mjs';

export function auditImages(rootPath) {
    const SITE_PUBLIC = path.join(rootPath, 'site', 'public');
    const { registry, overrides } = loadRegistry(rootPath);
    const workspaceRoot = path.dirname(rootPath); // Parent of shop root

    const results = [];

    for (const tool of registry) {
      const id = tool.id;
      const override = overrides[id] || {};

      let relativePath = override.screenshot || `/screenshots/${id}.png`;
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1); // remove leading slash
      }

      const fsPath = path.join(SITE_PUBLIC, relativePath);
      const exists = fs.existsSync(fsPath);

      let status = 'missing';
      let isPlaceholder = false;

      if (exists) {
        if (override.screenshotType === 'placeholder') {
          status = 'placeholder';
          isPlaceholder = true;
        } else {
          status = 'real';
        }
      }

      const { isInternal, isFeatured } = getToolStatus(id, tool, override);
      const repoPath = findRepoPath(workspaceRoot, id, rootPath);
      const repoExists = !!repoPath;
    
      results.push({
        id,
        name: tool.name,
        status, // 'missing', 'placeholder', 'real'
        path: relativePath,
        fsPath, // Local path
        isInternal,
        isFeatured,
        isPlaceholder,
        repoExists // New flag
      });
    }
    
    // Sort results deterministically by ID to ensure consistent output order before any further processing
    results.sort((a, b) => a.id.localeCompare(b.id));

    return {
        timestamp: new Date().toISOString(),
        summary: {
            total: results.length,
            real: results.filter(r => r.status === 'real').length,
            placeholder: results.filter(r => r.status === 'placeholder').length,
            missing: results.filter(r => r.status === 'missing').length
        },
        details: results
    };
}

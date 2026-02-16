#!/usr/bin/env node

/**
 * Fix-It PR Generator
 *
 * Reads worthy.json, detects gaps (non-worthy repos or repos with missing
 * criteria), and generates deterministic boilerplate templates that can be
 * used to create fix-it PRs.
 *
 * Safety guardrails:
 *   - Allowlist only: only repos listed in worthy.json
 *   - Denylist check: skips repos in automation.ignore.json
 *   - Deterministic templates only: no AI-generated content
 *   - Dry-run mode: --dry-run prints what would happen
 *
 * Usage:
 *   node scripts/gen-fixit-prs.mjs [--dry-run]
 *
 * Reads:
 *   site/src/data/worthy.json
 *   site/src/data/automation.ignore.json
 *
 * Writes:
 *   site/public/lab/fixit/<slug>/<template-file>.md
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "site", "src", "data");
const FIXIT_DIR = join(ROOT, "site", "public", "lab", "fixit");

// ── Helpers ─────────────────────────────────────────────────

function safeParseJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// ── Template definitions ────────────────────────────────────

const YEAR = new Date().getFullYear();

const TEMPLATES = {
  "mit-license": {
    file: "LICENSE.md",
    content: `# MIT License

Copyright (c) ${YEAR} mcp-tool-shop-org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },

  "security-policy": {
    file: "SECURITY.md",
    content: `# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email security concerns to: 64996768+mcp-tool-shop@users.noreply.github.com
3. Include steps to reproduce if possible
4. Allow up to 48 hours for an initial response

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Disclosure Policy

We follow coordinated disclosure. Once a fix is available, we will
publish a security advisory and credit the reporter (unless anonymity
is requested).
`,
  },

  "readme-sections": {
    file: "README-sections.md",
    content: `# Suggested README Sections

Add these sections to your existing README.md:

## Install

\`\`\`bash
# npm
npm install <package-name>

# or from source
git clone https://github.com/mcp-tool-shop-org/<repo-name>.git
cd <repo-name>
npm install
\`\`\`

## Usage

\`\`\`javascript
import { /* exports */ } from "<package-name>";

// Basic usage example
\`\`\`

## License

MIT — see [LICENSE](./LICENSE) for details.
`,
  },
};

/**
 * Map rubric criteria to templates.
 * null means the criterion cannot be auto-fixed via template.
 */
const CRITERION_MAP = {
  "License is OSI-approved": { templateKey: "mit-license", fixable: true },
  "At least 1 release published": { templateKey: null, fixable: false, info: "Publish a release on GitHub to satisfy this criterion. Go to Releases → Draft a new release." },
  "README has install + usage": { templateKey: "readme-sections", fixable: true },
  "Activity within last 90 days": { templateKey: null, fixable: false, info: "Push a commit or merge a PR within the last 90 days to satisfy this criterion." },
  "No known security issues": { templateKey: "security-policy", fixable: true },
};

// ── Core ────────────────────────────────────────────────────

/**
 * Detect worthy gaps from worthy.json data.
 *
 * @param {object} worthy - worthy.json contents
 * @param {{ ignoreList?: string[] }} opts
 * @returns {Array<{ slug: string, missing: string[], score: number, reason: string }>}
 */
export function detectGaps(worthy, opts = {}) {
  const { ignoreList = [] } = opts;
  const ignoreSet = new Set(ignoreList);

  if (!worthy?.repos) return [];

  const gaps = [];
  for (const [slug, entry] of Object.entries(worthy.repos)) {
    if (ignoreSet.has(slug)) continue;
    if (!entry.missing || entry.missing.length === 0) continue;

    gaps.push({
      slug,
      missing: entry.missing,
      score: entry.score || 0,
      reason: entry.reason || "",
    });
  }

  return gaps;
}

/**
 * Generate a fix template for a specific criterion.
 *
 * @param {string} slug - Repository slug
 * @param {string} criterion - Criterion string from rubric
 * @returns {{ filename: string, content: string, fixable: boolean, info?: string }}
 */
export function generateFixTemplate(slug, criterion) {
  const mapping = CRITERION_MAP[criterion];

  if (!mapping) {
    return {
      filename: null,
      content: null,
      fixable: false,
      info: `Unknown criterion: "${criterion}". Manual review required.`,
    };
  }

  if (!mapping.fixable || !mapping.templateKey) {
    return {
      filename: null,
      content: null,
      fixable: false,
      info: mapping.info || `Cannot auto-fix: "${criterion}".`,
    };
  }

  const template = TEMPLATES[mapping.templateKey];
  if (!template) {
    return {
      filename: null,
      content: null,
      fixable: false,
      info: `Template "${mapping.templateKey}" not found.`,
    };
  }

  // Substitute slug into content
  const content = template.content
    .replace(/<repo-name>/g, slug)
    .replace(/<package-name>/g, slug);

  return {
    filename: template.file,
    content,
    fixable: true,
  };
}

/**
 * Full pipeline: detect gaps, generate templates, write files.
 *
 * @param {{ dataDir?: string, outDir?: string, dryRun?: boolean }} opts
 * @returns {{ gaps: number, templates: number, infos: number }}
 */
export function generateFixitPrs(opts = {}) {
  const { dataDir = DATA_DIR, outDir = FIXIT_DIR, dryRun = false } = opts;

  const worthy = safeParseJson(join(dataDir, "worthy.json"), {});
  const ignoreList = safeParseJson(join(dataDir, "automation.ignore.json"), []);

  const gaps = detectGaps(worthy, { ignoreList });

  let templateCount = 0;
  let infoCount = 0;

  for (const gap of gaps) {
    const slugDir = join(outDir, gap.slug);

    // Generate summary.md for each gap
    const summaryLines = [
      `# Fix-It: ${gap.slug}`,
      "",
      `**Score:** ${gap.score}/${worthy.rubric?.criteria?.length || "?"}`,
      `**Reason:** ${gap.reason}`,
      "",
      "## Missing Criteria",
      "",
    ];

    for (const criterion of gap.missing) {
      const result = generateFixTemplate(gap.slug, criterion);

      if (result.fixable) {
        summaryLines.push(`- **${criterion}** — Template: \`${result.filename}\``);
        templateCount++;

        if (!dryRun) {
          mkdirSync(slugDir, { recursive: true });
          writeFileSync(join(slugDir, result.filename), result.content, "utf8");
        }
      } else {
        summaryLines.push(`- **${criterion}** — ${result.info}`);
        infoCount++;
      }
    }

    summaryLines.push("");
    summaryLines.push(`*Generated: ${new Date().toISOString().slice(0, 10)}*`);
    summaryLines.push("");

    if (!dryRun) {
      mkdirSync(slugDir, { recursive: true });
      writeFileSync(join(slugDir, "summary.md"), summaryLines.join("\n"), "utf8");
    }
  }

  if (dryRun) {
    console.log(`  [dry-run] Would write fix-it templates for ${gaps.length} repos`);
    console.log(`  [dry-run] Templates: ${templateCount}, Info-only: ${infoCount}`);
  } else if (gaps.length > 0) {
    console.log(`  Wrote fix-it templates for ${gaps.length} repos (${templateCount} templates, ${infoCount} info-only)`);
  } else {
    console.log("  No worthy gaps found — no fix-it templates generated");
  }

  return { gaps: gaps.length, templates: templateCount, infos: infoCount };
}

// ── Entry point ─────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]).endsWith("gen-fixit-prs.mjs");

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  console.log("Generating fix-it PR templates...");
  if (dryRun) console.log("  Mode: DRY RUN");

  const result = generateFixitPrs({ dryRun });
  console.log(`  Gaps: ${result.gaps}, Templates: ${result.templates}, Info: ${result.infos}`);
}

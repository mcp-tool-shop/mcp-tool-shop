/**
 * Audit README quality across all projects.
 * Fetches raw README content from GitHub and checks for critical sections.
 * Output: site/src/data/readme-health.json
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "site", "src", "data");
const OUT_PATH = path.join(DATA_DIR, "readme-health.json");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");

// Ensure directory exists
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

async function main() {
  const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, "utf8"));
  
  // Filter for active, public repos
  const targets = projects.filter(p => !p.archived && !p.is_private && !p.unlisted);
  
  console.log(`Auditing READMEs for ${targets.length} projects...`);
  
  const results = [];
  const errors = [];
  
  for (const p of targets) {
    if (!p.repo) continue;
    
    // Default to main branch, but could ideally check default_branch from API
    // org name hardcoded for now or derived
    const org = "mcp-tool-shop-org"; 
    const url = `https://raw.githubusercontent.com/${org}/${p.repo}/main/README.md`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Try master if main fails
        const res2 = await fetch(url.replace("/main/", "/master/"));
        if (!res2.ok) {
          results.push({
            repo: p.repo,
            score: 0,
            status: "missing",
            missing: ["README file"]
          });
          continue;
        }
        var text = await res2.text();
      } else {
        var text = await res.text();
      }
      
      const analysis = analyzeReadme(text);
      results.push({
        repo: p.repo,
        ...analysis
      });
      
    } catch (e) {
      errors.push({ repo: p.repo, error: e.message });
    }
    
    // rudimentary rate limit protection
    await new Promise(r => setTimeout(r, 100));
  }
  
  const health = {
    updatedAt: new Date().toISOString(),
    totalChecked: targets.length,
    passedAll: results.filter(r => r.score === 100).length,
    results: results.sort((a, b) => a.score - b.score) // lowest score first
  };
  
  fs.writeFileSync(OUT_PATH, JSON.stringify(health, null, 2));
  console.log(`Generated README Health Report at ${OUT_PATH}`);
  
  const failing = results.filter(r => r.score < 50);
  if (failing.length > 0) {
    console.log(`\n⚠️  ${failing.length} repos have poor READMEs (<50/100):`);
    failing.forEach(f => console.log(`  - ${f.repo}: ${f.missing.join(", ")}`));
  }
}

function analyzeReadme(text) {
  const content = text.toLowerCase();
  const missing = [];
  let score = 100;
  
  // Critical Sections (30 pts each)
  const hasInstall = /install|setup|build|deploy/.test(content);
  if (!hasInstall) { score -= 30; missing.push("Installation"); }
  
  const hasUsage = /usage|example|quick start|how to|demo/.test(content);
  if (!hasUsage) { score -= 30; missing.push("Usage"); }
  
  // Important Sections (10 pts each)
  const hasDescription = text.length > 500; // Brief check for substance
  if (!hasDescription) { score -= 10; missing.push("Description (too short)"); }
  
  const hasConfiguration = /config|env var|environment|api key|token/.test(content);
  // Not strictly required for all tools, but good for MCP
  if (!hasConfiguration) { score -= 0; } // Optional for now
  
  const hasLicense = /license|mit|apache/.test(content);
  if (!hasLicense) { score -= 10; missing.push("License text"); }
  
  // Bonus: MCP Specifics
  const hasMCP = /mcp|model context protocol/.test(content);
  if (hasMCP) { score += 5; }
  
  return {
    score: Math.min(100, Math.max(0, score)),
    status: score >= 80 ? "great" : score >= 50 ? "needs-work" : "poor",
    missing
  };
}

main();

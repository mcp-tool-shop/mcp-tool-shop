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

// Define run parameters
const RECENT_DAYS = 7;
const RANDOM_SAMPLE_SIZE = 10;

// Ensure directory exists
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

async function main() {
  const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, "utf8"));
  
  // Load previous results if available
  let previousResults = {};
  if (fs.existsSync(OUT_PATH)) {
    try {
      const prevData = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
      // Map existing results by repo for easy lookup
      if (prevData.results) {
        prevData.results.forEach(r => previousResults[r.repo] = r);
      }
    } catch (e) {
      console.warn("Could not read previous health data, starting fresh.");
    }
  }

  // Filter for active, public repos
  const allTargets = projects.filter(p => !p.archived && !p.is_private && !p.unlisted);
  
  // Identify candidates for THIS run
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - (RECENT_DAYS * 24 * 60 * 60 * 1000));
  
  const toCheck = allTargets.filter(p => {
    // 1. Always check recently active repos
    if (p.updatedAt && new Date(p.updatedAt) > recentCutoff) return true;
    // 2. Always check featured repos (Front Door)
    if (p.featured) return true;
    // 3. Otherwise, check if we've never checked it
    if (!previousResults[p.repo]) return true;
    return false;
  });

  // 4. Add a random sample of older repos to ensure coverage over time
  // Filter out ones we're already checking
  const remaining = allTargets.filter(p => !toCheck.includes(p));
  // Shuffle and take N
  const randomSample = remaining.sort(() => 0.5 - Math.random()).slice(0, RANDOM_SAMPLE_SIZE);
  
  const finalQueue = [...toCheck, ...randomSample];
  
  console.log(`Auditing READMEs for ${finalQueue.length} projects (${toCheck.length} priority + ${randomSample.length} random sample)...`);
  
  const results = [];
  const errors = [];
  
  // We need to build the full result set: new checks + old data for unchecked
  const checkedRepos = new Set();

  for (const p of finalQueue) {
    if (!p.repo) continue;
    checkedRepos.add(p.repo);
    
    // Default to main branch, but could ideally check default_branch from API
    // org name hardcoded for now or derived
    const org = "mcp-tool-shop-org"; 
    const url = `https://raw.githubusercontent.com/${org}/${p.repo}/main/README.md`;
    
    try {
      const res = await fetch(url);
      let text = "";

      if (!res.ok) {
        // Try master if main fails
        const res2 = await fetch(url.replace("/main/", "/master/"));
        if (!res2.ok) {
          results.push({
            repo: p.repo,
            score: 0,
            status: "missing",
            missing: ["README file"],
            checkedAt: now.toISOString()
          });
          continue;
        }
        text = await res2.text();
      } else {
        text = await res.text();
      }
      
      const analysis = analyzeReadme(text);
      results.push({
        repo: p.repo,
        ...analysis,
        checkedAt: now.toISOString()
      });
      
    } catch (e) {
      errors.push({ repo: p.repo, error: e.message });
      // Keep old result if fetch fails, or add error entry
      if (previousResults[p.repo]) {
         results.push(previousResults[p.repo]);
      }
    }
    
    // rudimentary rate limit protection
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Fill in the rest from previous results
  for (const p of allTargets) {
    if (!checkedRepos.has(p.repo) && previousResults[p.repo]) {
      results.push(previousResults[p.repo]);
    }
  }
  
  const health = {
    updatedAt: now.toISOString(),
    totalChecked: results.length,
    passedAll: results.filter(r => r.score === 100).length,
    results: results.sort((a, b) => a.score - b.score) // lowest score first
  };
  
  fs.writeFileSync(OUT_PATH, JSON.stringify(health, null, 2));
  console.log(`Generated README Health Report at ${OUT_PATH}`);
  
  const failing = results.filter(r => r.score < 50);
  if (failing.length > 0) {
    console.log(`\n⚠️  ${failing.length} repos have poor READMEs (<50/100):`);
    // Pick top 3 worst to show
    failing.slice(0, 3).forEach(f => console.log(`  - ${f.repo}: ${f.missing.join(", ")}`));
  }
}

function analyzeReadme(text) {
  const content = text.toLowerCase();
  const missing = [];
  
  // Scoring Rubric
  // Base: 0
  // Criticals: Install (+20), Usage (+20) -> Max 40 if just these (FAIL)
  // Quality: Description (+10), License (+10), Docs Link (+10), Screenshot (+10) -> Max 40
  // Bonus: MCP (+5)
  // Total potential: 95? Let's adjust to hit 100.
  
  // Revised Strategy per User Request:
  // "If either critical missing -> score max 49"
  
  let criticalScore = 0;
  let qualityScore = 0;
  let isCriticalFail = false;

  // Critical Sections
  const hasInstall = /install|setup|build|deploy|npm i|pip install/.test(content);
  if (hasInstall) criticalScore += 25;
  else { missing.push("Installation"); isCriticalFail = true; }
  
  const hasUsage = /usage|example|quick start|how to|demo|```/.test(content); // added code block check as weak proxy for usage
  if (hasUsage) criticalScore += 25;
  else { missing.push("Usage Example"); isCriticalFail = true; }
  
  // Quality Sections
  const hasDescription = text.length > 200; // Relaxed from 500
  if (hasDescription) qualityScore += 15;
  else missing.push("Description (too short)");
  
  const hasDocsLink = /docs|wiki|handbook|api reference/.test(content);
  if (hasDocsLink) qualityScore += 10;
  
  const hasLicense = /license|mit|apache|copying/.test(content);
  if (hasLicense) qualityScore += 10;
  else missing.push("License info");

  const hasScreenshot = /!\[.*\]\(.*(png|jpg|gif)|<img/i.test(content);
  if (hasScreenshot) qualityScore += 15;
  
  // Calculate Final
  let totalScore = criticalScore + qualityScore;
  
  if (isCriticalFail) {
      totalScore = Math.min(totalScore, 49);
  }
  
  return {
    score: Math.min(100, Math.max(0, totalScore)),
    status: totalScore >= 80 ? "great" : totalScore >= 50 ? "needs-work" : "poor",
    missing
  };
}

main();

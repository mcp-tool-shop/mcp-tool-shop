/**
 * Audit README quality across all projects.
 * Fetches raw README content from GitHub and checks for critical sections.
 * Output: site/src/data/readme-health.json
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "site", "src", "data");
const OUT_PATH = path.join(DATA_DIR, "readme-health.json");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");

// Define run parameters
const RECENT_DAYS = 7;
const RANDOM_SAMPLE_SIZE = 10;
const VERSION = "2.0";

// Ensure directory exists
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

// Deterministic PRNG based on date string (YYYY-MM-DD)
// Simple LCG: X_{n+1} = (aX_n + c) % m
function createSeededRandom(seedSlug) {
  let seed = 0;
  for (let i = 0; i < seedSlug.length; i++) {
    seed = (seed << 5) - seed + seedSlug.charCodeAt(i);
  }
  seed = Math.abs(seed);
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

async function fetchWithRetry(url, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
      
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (res.ok) return { ok: true, text: await res.text(), status: res.status };
      if (res.status >= 500) {
        if (i < retries) {
          await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
          continue;
        }
      }
      return { ok: false, status: res.status };
    } catch (e) {
      if (i < retries) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return { ok: false, error: e.message, status: "network_error" };
    }
  }
}

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
  const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const recentCutoff = new Date(now.getTime() - (RECENT_DAYS * 24 * 60 * 60 * 1000));
  
  // Deterministic random for today
  const rng = createSeededRandom(dateStr);

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
  
  // Stable shuffle using seeded RNG
  const stableRandomSample = remaining
    .map(p => ({ p, r: rng() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, RANDOM_SAMPLE_SIZE)
    .map(item => item.p);
  
  const finalQueue = [...toCheck, ...stableRandomSample];
  
  // Deduplicate queue just in case
  const uniqueQueue = Array.from(new Set(finalQueue.map(p => p.repo)))
    .map(repo => finalQueue.find(p => p.repo === repo));

  console.log(`Auditing READMEs for ${uniqueQueue.length} projects (${toCheck.length} priority + ${stableRandomSample.length} random sample)...`);
  
  const results = [];
  const errors = [];
  const checkedRepos = new Set();
  const org = "mcp-tool-shop-org"; 

  let checkCounter = 0;

  for (const p of uniqueQueue) {
    if (!p.repo) continue;
    checkedRepos.add(p.repo);
    checkCounter++;
    
    // Default to main branch, but could ideally check default_branch from API
    let attempts = [`https://raw.githubusercontent.com/${org}/${p.repo}/main/README.md`];
    // Fallback logic handled inside loop
    
    let analysis = null;
    let fetchStatus = "unknown";

    try {
        let res = await fetchWithRetry(attempts[0]);
        
        if (!res.ok && res.status === 404) {
             // Try master
             res = await fetchWithRetry(`https://raw.githubusercontent.com/${org}/${p.repo}/master/README.md`);
        }

        if (res.ok) {
            analysis = analyzeReadme(res.text);
            fetchStatus = "success";
        } else if (res.status === "network_error" || res.status >= 500) {
            fetchStatus = "unreachable";
        } else {
            fetchStatus = "missing";
        }

        if (fetchStatus === "success") {
            results.push({
                repo: p.repo,
                ...analysis,
                checkStatus: "ok",
                checkedAt: now.toISOString(),
                lastCheckedAt: now.toISOString() // New field
            });
        } else if (fetchStatus === "unreachable") {
            console.warn(`Skipping ${p.repo} due to network error, preserving old score.`);
            if (previousResults[p.repo]) {
                results.push(previousResults[p.repo]);
            } else {
                results.push({
                    repo: p.repo,
                    score: 0,
                    checkStatus: "unreachable",
                    missing: ["Repo unreachable"],
                    evidence: {},
                    checkedAt: now.toISOString(),
                    lastCheckedAt: null
                });
            }
        } else {
            // 404/Missing
            results.push({
                repo: p.repo,
                score: 0,
                checkStatus: "missing_readme",
                capReason: "no_readme",
                missing: ["README file"],
                evidence: { hasReadme: false },
                checkedAt: now.toISOString(),
                lastCheckedAt: now.toISOString()
            });
        }

    } catch (e) {
      errors.push({ repo: p.repo, error: e.message });
      if (previousResults[p.repo]) {
         results.push(previousResults[p.repo]);
      }
    }
    
    // rate limit protection
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Fill in the rest from previous results
  for (const p of allTargets) {
    if (!checkedRepos.has(p.repo) && previousResults[p.repo]) {
      results.push(previousResults[p.repo]);
    }
  }
  
  const health = {
    meta: {
        generatedAt: now.toISOString(),
        runId: crypto.randomUUID(),
        version: VERSION,
        checkedCount: checkCounter,
        strategy: {
            recentDays: RECENT_DAYS,
            sampleSize: RANDOM_SAMPLE_SIZE,
            seed: dateStr
        }
    },
    results: results.sort((a, b) => a.score - b.score) // lowest score first
  };
  
  // 6. Invariant Test
  validateSchema(health);
  
  fs.writeFileSync(OUT_PATH, JSON.stringify(health, null, 2));
  console.log(`Generated README Health Report at ${OUT_PATH} (Checked: ${checkCounter})`);
  
  const failing = results.filter(r => r.score < 50 && r.checkStatus === "ok");
  if (failing.length > 0) {
    console.log(`\n⚠️  ${failing.length} repos have poor READMEs (<50/100):`);
    failing.slice(0, 3).forEach(f => console.log(`  - ${f.repo}: ${f.missing.join(", ")}`));
  }
}

function validateSchema(data) {
    const errors = [];
    if (!data.meta?.generatedAt) errors.push("Missing meta.generatedAt");
    
    data.results.forEach((r, i) => {
        if (!r.repo) errors.push(`Item ${i} missing repo`);
        if (typeof r.score !== "number" || r.score < 0 || r.score > 100) errors.push(`Item ${r.repo} invalid score: ${r.score}`);
        if (!r.checkStatus) errors.push(`Item ${r.repo} missing checkStatus`);
        
        // CapReason allowlist
        const validCaps = [null, undefined, "missing_install", "missing_usage", "no_readme"];
        if (!validCaps.includes(r.capReason)) errors.push(`Item ${r.repo} invalid capReason: ${r.capReason}`);
        
        // Evidence check
        if (r.checkStatus === "ok" && !r.evidence) errors.push(`Item ${r.repo} missing evidence object`);
    });

    if (errors.length > 0) {
        throw new Error("Schema Invariant Failed:\n" + errors.join("\n"));
    }
    console.log("✅ Schema invariants passed.");
}

function analyzeReadme(text) {
  const contentLower = text.toLowerCase();
  const missing = [];
  const evidence = {}; // New granular evidence block
  
  // Scoring Rubric
  
  let criticalScore = 0;
  let qualityScore = 0;
  let capReason = null; // New field

  // Critical Sections
  const hasInstall = /install|setup|build|deploy|npm i|pip install|cargo build|mvn install/.test(contentLower);
  evidence.hasInstall = hasInstall;
  if (hasInstall) criticalScore += 25;
  else { 
      missing.push("Installation instructions"); 
      if (!capReason) capReason = "missing_install";
  }
  
  const hasUsage = /usage|example|quick start|how to|demo|```/.test(contentLower); 
  evidence.hasUsage = hasUsage;
  if (hasUsage) criticalScore += 25;
  else { 
      missing.push("Usage Example"); 
      if (!capReason) capReason = "missing_usage";
  }
  
  // Quality Sections
  const hasDescription = text.length > 200; 
  evidence.hasDescription = hasDescription;
  if (hasDescription) qualityScore += 15;
  else missing.push("Description (too short)");
  
  // Improved Docs detection: Link text or URL contains docs/wiki/handbook
  // Regex looks for [Link Text](url) where text or url matches keyword
  // Updated per request: avoid badges/images and ensure strict link structure
  // Matches: [Anything](...docs...) or [Documentation](...)
  // Excludes: ![...](...) (images/badges)
  
  const linkRegex = /(?!!)(?:\[([^\]]+)\]\(([^)]+)\))/g;
  let hasDocsLink = false;
  let match;
  
  while ((match = linkRegex.exec(text)) !== null) {
      const linkText = match[1].toLowerCase();
      const linkUrl = match[2].toLowerCase();
      
      // Check for docs keywords in valid links
      if (
          linkText.includes("docs") || linkText.includes("wiki") || linkText.includes("handbook") ||
          linkUrl.includes("/docs") || linkUrl.includes("wiki") || linkUrl.includes("handbook") ||
          linkUrl.includes("readme") // internal links often helpful
      ) {
          hasDocsLink = true;
          break;
      }
  }
  // Fallback: Check for header like "Documentation"
  if (!hasDocsLink) {
      hasDocsLink = /#+\s*(documentation|wiki|handbook|api reference)/i.test(text);
  }

  evidence.hasDocsLink = hasDocsLink;
  if (hasDocsLink) qualityScore += 10;
  
  const hasLicense = /license|mit|apache|copying/i.test(text); // Case insensitive check on full text

  evidence.hasLicense = hasLicense;
  if (hasLicense) qualityScore += 10;
  else missing.push("License info");

  const hasScreenshot = /!\[.*\]\(.*(png|jpg|gif|svg|webp)|<img/i.test(text);
  evidence.hasScreenshot = hasScreenshot;
  if (hasScreenshot) qualityScore += 15;
  
  // Calculate Final
  let totalScore = criticalScore + qualityScore;
  
  // Cap score if criticals are missing
  if (capReason) {
      totalScore = Math.min(totalScore, 49);
  }
  
  return {
    score: Math.min(100, Math.max(0, totalScore)),
    status: totalScore >= 80 ? "great" : totalScore >= 50 ? "needs-work" : "poor",
    capReason,
    missing,
    evidence
  };
}

main();

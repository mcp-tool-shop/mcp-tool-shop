/**
 * Audit tool metadata and reality.
 * Generates/Updates: 
 * - site/src/data/audit/metadata-findings.json
 * - site/src/data/audit/reality-findings.json
 * - site/src/data/audit/scoreboard.json
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "site", "src", "data");
const AUDIT_DIR = path.join(DATA_DIR, "audit");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");

// Ensure directory exists
fs.mkdirSync(AUDIT_DIR, { recursive: true });

async function main() {
  const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, "utf8"));
  const metadataFindings = [];
  const realityFindings = [];
  const scoreboard = [];

  console.log(`Auditing ${projects.length} tools...`);

  const activeProjects = projects.filter(p => !p.archived);

  for (const p of activeProjects) {
    // 1. Metadata Lint
    const metaIssues = lintMetadata(p);
    if (metaIssues.length > 0) {
      metadataFindings.push({ repo: p.repo, issues: metaIssues });
    }

    // 2. Reality Checks (Lightweight - network based)
    // We already do a fetch in readme-health, here we might need specific files
    // For now, let's focus on structural reality based on what projects.json already has 
    // or fast fetches of configuration files.
    const realityIssues = await checkReality(p);
    if (realityIssues.length > 0) {
      realityFindings.push({ repo: p.repo, issues: realityIssues });
    }

    // 3. Compute Scoreboard
    const confidenceScore = calculateConfidence(p, metaIssues, realityIssues);
    const computedLabel = computeLabel(p, confidenceScore);
    
    scoreboard.push({
      repo: p.repo,
      score: confidenceScore,
      label: computedLabel,
      metaIssuesCount: metaIssues.length,
      realityIssuesCount: realityIssues.length
    });
    
    // Rate limit
    await new Promise(r => setTimeout(r, 50));
  }

  // Write artifacts
  fs.writeFileSync(path.join(AUDIT_DIR, "metadata-findings.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    findings: metadataFindings
  }, null, 2));

  fs.writeFileSync(path.join(AUDIT_DIR, "reality-findings.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    findings: realityFindings
  }, null, 2));

  fs.writeFileSync(path.join(AUDIT_DIR, "scoreboard.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    results: scoreboard.sort((a, b) => a.score - b.score) // Worst first
  }, null, 2));

  console.log("Audit complete.");
}

function lintMetadata(p) {
  const issues = [];
  const required = ["description", "tagline", "kind", "stability", "install"];
  
  required.forEach(field => {
    if (!p[field] || (typeof p[field] === "string" && p[field].trim() === "")) {
       // Allow missing install if it's a library or desktop app (maybe?)
       if (field === "install" && (p.kind === "desktop-app" || p.kind === "library")) return;
       issues.push(`Missing required field: ${field}`);
    }
  });

  if (p.description && p.description.length < 10) issues.push("Description too short (<10 chars)");
  if (p.tagline && p.tagline.length > 100) issues.push("Tagline too long (>100 chars)");
  
  const validKinds = ["mcp-server", "cli", "library", "desktop-app", "browser-extension"];
  if (p.kind && !validKinds.includes(p.kind)) issues.push(`Invalid kind: ${p.kind}`);

  const validStability = ["stable", "beta", "experimental", "deprecated"];
  if (p.stability && !validStability.includes(p.stability)) issues.push(`Invalid stability: ${p.stability}`);

  if (p.deprecated && p.stability !== "deprecated") issues.push("Contradiction: deprecated=true but stability!='deprecated'");
  
  // Tag sanity
  if (!p.tags || p.tags.length === 0) issues.push("No tags");

  return issues;
}

async function checkReality(p) {
  const issues = [];
  const org = "mcp-tool-shop-org";
  
  // Install command validation
  if (p.install) {
    const installCmd = p.install.toLowerCase();
    
    // Python checks
    if (installCmd.includes("pip") || installCmd.includes("uv")) {
        // Should have pyproject.toml
        const url = `https://raw.githubusercontent.com/${org}/${p.repo}/main/pyproject.toml`;
        try {
            const res = await fetch(url, { method: "HEAD" });
            if (!res.ok) {
                 const res2 = await fetch(url.replace("/main/", "/master/"));
                 if (!res2.ok) issues.push("Install instruction implies Python but pyproject.toml missing");
            }
        } catch {}
    }

    // Node checks
    if (installCmd.includes("npm") || installCmd.includes("npx") || installCmd.includes("yarn")) {
        const url = `https://raw.githubusercontent.com/${org}/${p.repo}/main/package.json`;
        try {
            const res = await fetch(url, { method: "HEAD" });
             if (!res.ok) {
                 const res2 = await fetch(url.replace("/main/", "/master/"));
                 if (!res2.ok) issues.push("Install instruction implies Node but package.json missing");
            }
        } catch {}
    }
  }

  // Kind validation (heuristic)
  if (p.kind === "mcp-server") {
     if (p.install && !p.install.includes("mcp")) {
         // Weak check, but maybe valuable
     }
  }

  return issues;
}

function calculateConfidence(p, metaIssues, realityIssues) {
    let score = 100;
    score -= (metaIssues.length * 10);
    score -= (realityIssues.length * 20);
    
    // Penalty for generic descriptions
    if (p.description === p.tagline) score -= 5;
    
    // Bonus for ecosystem integration
    if (p.registered) score += 5;
    
    return Math.max(0, Math.min(100, score));
}

function computeLabel(p, score) {
    if (p.deprecated || p.stability === "deprecated") return "Deprecated";
    if (score < 50) return "Needs Work";
    if (p.stability === "beta" || p.stability === "experimental") return "Prototype";
    if (p.stability === "stable") return "Stable";
    
    // Default fallback
    return "Prototype"; 
}

main().catch(console.error);

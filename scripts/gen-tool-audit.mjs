// mcp-tool-shop/scripts/gen-tool-audit.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
// We assume we are in c:\workspace\mcp-tool-shop\scripts
// REPO_ROOT should be c:\workspace
const REPO_ROOT = path.resolve(__dirname, "../..");
const SHOP_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(SHOP_ROOT, "site", "src", "data");
const AUDIT_DIR = path.join(DATA_DIR, "audit");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");
const TRUTH_MATRIX_PATH = path.join(REPO_ROOT, "audit", "truth-matrix.json");

// Ensure directory exists
if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(TRUTH_MATRIX_PATH))) fs.mkdirSync(path.dirname(TRUTH_MATRIX_PATH), { recursive: true });

function globMatch(dir, ext) {
    if (!fs.existsSync(dir)) return false;
    try {
        const files = fs.readdirSync(dir, { recursive: true });
        for (const file of files) {
             const fname = typeof file === 'string' ? file : file.name;
             if (fname.endsWith(ext)) return true;
        }
    } catch (e) {
        return false;
    }
    return false;
}

function checkCI(workspaceRoot, repoName) {
    const workflowsDir = path.join(workspaceRoot, ".github", "workflows");
    let found = false;

    // Log for debugging Trace specifically or all
    if (repoName.toLowerCase().includes("trace")) console.log(`[DEBUG] Checking CI for ${repoName} in ${workflowsDir}`);

    // 1. Check root workflows
    if (fs.existsSync(workflowsDir)) {
        try {
            const files = fs.readdirSync(workflowsDir);
            if (repoName.toLowerCase().includes("trace")) console.log(`[DEBUG] Found ${files.length} workflows: ${files.join(", ")}`);
            for (const file of files) {
                // if (repoName.toLowerCase().includes("trace")) console.log(`[DEBUG] Checking file ${file} for ${repoName}`);
                const fullPath = path.join(workflowsDir, file);
                const content = fs.readFileSync(fullPath, "utf8");
                
                // Heuristics
                if (content.includes(`paths:\n      - '${repoName}/**'`) || 
                    content.includes(`paths:\n      - "${repoName}/**"`) ||
                    content.includes(`working-directory: ${repoName}`) ||
                    content.includes(`working-directory: ./${repoName}`) ||
                    content.includes(`working-directory: '${repoName}'`)) {
                    found = true;
                    console.log(`[DEBUG] Found CI via content match in ${file} for ${repoName}`);
                    break;
                }
                
                // Matches filename like trace.yml for repo Trace
                if (file.toLowerCase().includes(repoName.toLowerCase()) && !file.includes("audit")) {
                    found = true;
                    console.log(`[DEBUG] Found CI via filename match in ${file} for ${repoName}`);
                    break;
                }
            }
        } catch (e) {
            if (repoName === "Trace") console.error(`Error reading workflows: ${e}`);
        }
    } else {
        if (repoName === "Trace") console.log(`Workflows dir not found: ${workflowsDir}`);
    }
    
    if (found) return true;

    // 2. Check local workflows
    const localWorkflows = path.join(workspaceRoot, repoName, ".github", "workflows");
    if (fs.existsSync(localWorkflows)) {
        try {
             if (fs.readdirSync(localWorkflows).length > 0) return true;
        } catch {}
    }

    return false;
}

async function main() {
  const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, "utf8"));
  
  const matrix = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    projects: []
  };

  console.log(`Auditing ${projects.length} tools for Truth Maintenance...`);

  for (const p of projects) {
    // Skip unlisted or non-repo entries if desired, but user wants audit.
    if (!p.repo) continue;

    const projectPath = path.join(REPO_ROOT, p.repo);
    if (p.repo.toLowerCase().includes("trace")) console.log(`[DEBUG] Trace path: ${projectPath}`);
    
    const audit = {
      ci: false,
      build: false,
      readme: false,
      license: false,
      proofs: []
    };

    // 1. Reality Check: Filesystem
    const exists = fs.existsSync(projectPath);
    if (exists) {
        // License
        if (fs.existsSync(path.join(projectPath, "LICENSE")) || fs.existsSync(path.join(projectPath, "LICENSE.md"))) {
            audit.license = true;
        }
        
        // README
        if (fs.existsSync(path.join(projectPath, "README.md"))) {
            audit.readme = true;
        }

        // Build System
        const hasPackageJson = fs.existsSync(path.join(projectPath, "package.json"));
        // globMatch is expensive if deep, restrict? No, allow standard depth.
        const hasCsproj = globMatch(projectPath, ".csproj") || globMatch(projectPath, ".sln");
        const hasPyProject = fs.existsSync(path.join(projectPath, "pyproject.toml")) || fs.existsSync(path.join(projectPath, "requirements.txt"));
        const hasPom = fs.existsSync(path.join(projectPath, "pom.xml"));
        const hasCargo = fs.existsSync(path.join(projectPath, "Cargo.toml"));

        if (hasPackageJson) { audit.build = true; audit.proofs.push("npm"); }
        if (hasCsproj) { audit.build = true; audit.proofs.push("dotnet"); }
        if (hasPyProject) { audit.build = true; audit.proofs.push("python"); }
        if (hasPom) { audit.build = true; audit.proofs.push("maven"); }
        if (hasCargo) { audit.build = true; audit.proofs.push("cargo"); }

        // CI Check
        if (checkCI(REPO_ROOT, p.repo)) {
            audit.ci = true;
            audit.proofs.push("ci");
        }
    }

    matrix.projects.push({
        name: p.name,
        path: p.repo,
        type: p.kind,
        status: p.stability || "experimental",
        unlisted: !!p.unlisted,
        audit: audit
    });
  }

  // Write truth matrix
  fs.writeFileSync(TRUTH_MATRIX_PATH, JSON.stringify(matrix, null, 2));
  console.log(`Wrote truth matrix to ${TRUTH_MATRIX_PATH}`);

  // Write proof pills for UI
  const proofData = matrix.projects.map(mp => ({
      repo: mp.path,
      proofs: mp.audit.proofs,
      verified: mp.audit.ci && mp.audit.build,
      // Concept if missing CI workflow (Operationalizing Truth)
      concept: !mp.audit.ci 
  }));
  
  fs.writeFileSync(path.join(AUDIT_DIR, "proofs.json"), JSON.stringify(proofData, null, 2));
  console.log(`Wrote proofs to ${path.join(AUDIT_DIR, "proofs.json")}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

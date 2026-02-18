// scripts/fix-project-status.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const PROJECTS_PATH = path.join(__dirname, "../site/src/data/projects.json");
const TRUTH_PATH = path.join(REPO_ROOT, "audit/truth-matrix.json");

const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, "utf8"));
const matrix = JSON.parse(fs.readFileSync(TRUTH_PATH, "utf8")); // Assuming matrix is up to date

let changed = false;

projects.forEach(p => {
    // Fix Registered + Unlisted
    if (p.registered && p.unlisted) {
        console.log(`Fixing registered+unlisted for ${p.name}`);
        p.registered = false;
        changed = true;
    }

    // Fix Stability vs CI
    // Find audit entry
    // Need to match by path/repo.
    // Matrix uses 'path' as property for repo.
    const auditEntry = matrix.projects.find(m => m.path === p.repo);
    
    if (auditEntry) {
         if (p.name === "Trace" || p.name === "VectorCaliper") {
             console.log(`Checking ${p.name}: status=${p.stability}, ci=${auditEntry.audit.ci}, repo=${p.repo}, path=${auditEntry.path}`);
         }
         const hasCI = auditEntry.audit.ci;
         const restricted = ["stable", "beta", "alpha", "prototype"];
         if (restricted.includes(p.stability) && !hasCI) {
              console.log(`Downgrading ${p.name} from ${p.stability} to experimental (runs without CI)`);
              p.stability = "experimental";
              changed = true;
         }
    }

    // Enforce Copy Standards
    const hasTagline = p.tagline && p.tagline.length <= 90;
    const hasGoodFor = Array.isArray(p.goodFor) && p.goodFor.length >= 3;
    const hasNotFor = Array.isArray(p.notFor) && p.notFor.length >= 2;
    
    const needsCopy = !hasTagline || !hasGoodFor || !hasNotFor;
    
    if (needsCopy) {
        if (!p.tags) p.tags = [];
        if (!p.tags.includes("needs-copy")) {
            p.tags.push("needs-copy");
            changed = true;
            console.log(`Flagging ${p.name} as needs-copy`);
        }
    } else {
        if (p.tags && p.tags.includes("needs-copy")) {
            p.tags = p.tags.filter(t => t !== "needs-copy");
            changed = true;
            console.log(`Unflagging ${p.name} (copy standards met)`);
        }
    }
});

if (changed) {
    fs.writeFileSync(PROJECTS_PATH, JSON.stringify(projects, null, 2));
    console.log("Updated projects.json");
} else {
    console.log("No changes needed.");
}

#!/usr/bin/env node
/**
 * Overlay ecosystem.json onto the current projects.json.
 * Used by `npm run sync` and as a standalone so a catalog change can land
 * without waiting for a full GitHub org fetch.
 */

import fs from "node:fs";
import path from "node:path";
import { applyEcosystem, loadEcosystem } from "./lib/ecosystem.mjs";

const DATA = path.join(process.cwd(), "site", "src", "data");
const PROJECTS = path.join(DATA, "projects.json");

const projects = JSON.parse(fs.readFileSync(PROJECTS, "utf8"));
const ecosystem = loadEcosystem(DATA);
const report = applyEcosystem(projects, ecosystem);
fs.writeFileSync(PROJECTS, JSON.stringify(projects, null, 2) + "\n");
console.log(
  `Applied catalog to ${report.applied}/${report.catalogued} projects ` +
    `(installs set ${report.installsSet}, cleared ${report.installsCleared})`
);
if (report.unknown.length) {
  console.log(
    `Not in catalog (left as-is): ${report.unknown.slice(0, 20).join(", ")}` +
      (report.unknown.length > 20 ? ` … +${report.unknown.length - 20}` : "")
  );
}

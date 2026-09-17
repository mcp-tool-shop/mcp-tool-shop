#!/usr/bin/env node
/**
 * Fetch mcp-tool-shop-org/.github docs/catalog.yaml and write site/src/data/ecosystem.json.
 *
 * The YAML is public. No token required. Regenerated on Daily Refresh so the
 * marketing site tracks the org spec instead of a second hand-maintained list.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAW_URL =
  "https://raw.githubusercontent.com/mcp-tool-shop-org/.github/main/docs/catalog.yaml";
const OUT = path.join(process.cwd(), "site", "src", "data", "ecosystem.json");

async function main() {
  const res = await fetch(RAW_URL, {
    headers: { "user-agent": "mcp-tool-shop-catalog" },
  });
  if (!res.ok) {
    throw new Error(`fetch catalog.yaml: HTTP ${res.status}`);
  }
  const yamlText = await res.text();
  const tmp = path.join(process.cwd(), ".ecosystem-catalog.yaml");
  fs.writeFileSync(tmp, yamlText);
  try {
    const jsonText = execFileSync("npx", ["--yes", "js-yaml", tmp], {
      encoding: "utf8",
      shell: true,
    });
    const data = JSON.parse(jsonText);
    if (!Array.isArray(data.repos) || data.repos.length === 0) {
      throw new Error("catalog.yaml parsed but repos[] is empty");
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
    const installable = data.repos.filter((r) => r.install).length;
    console.log(
      `Wrote ${data.repos.length} catalog entries to ${OUT} (${installable} installable, generated ${data.generated})`
    );
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

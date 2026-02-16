/**
 * Temp directory helpers for generator tests.
 * Creates isolated output dirs and cleans up after.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Create a temp directory for test output.
 * Returns { dir, cleanup } — call cleanup() when done.
 */
export function makeTempDir(prefix = "mcp-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Write a JSON fixture to a temp directory and return the path.
 */
export function writeFixture(dir, filename, data) {
  const filePath = path.join(dir, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return filePath;
}

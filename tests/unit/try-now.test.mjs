import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldShowInstall, shouldMountTryItNow } from "../../scripts/lib/try-now.mjs";

describe("shouldShowInstall", () => {
  it("shows a catalog-verified install even when the tool is not in the registry", () => {
    assert.equal(
      shouldShowInstall({ install: "npx @mcptoolshop/shipcheck", kind: "cli" }),
      true
    );
  });

  it("shows library and untyped installs, not only CLI and MCP servers", () => {
    assert.equal(shouldShowInstall({ install: "pip install comfy-headless", kind: "library" }), true);
    assert.equal(shouldShowInstall({ install: "npx @mcptoolshop/loadout-os" }), true);
  });

  it("hides the block when the catalog left install empty", () => {
    assert.equal(shouldShowInstall({ kind: "cli" }), false);
    assert.equal(shouldShowInstall({ install: null, kind: "mcp-server" }), false);
    assert.equal(shouldShowInstall({ install: "", kind: "cli" }), false);
  });
});

describe("shouldMountTryItNow", () => {
  it("mounts for an install with no proof record", () => {
    assert.equal(shouldMountTryItNow({ install: "npx @mcptoolshop/shipcheck" }, null), true);
  });

  it("still mounts a concept prototype that has no package", () => {
    assert.equal(shouldMountTryItNow({ repo: "zip-meta-map" }, { concept: true }), true);
  });

  it("does not mount an empty shell", () => {
    assert.equal(shouldMountTryItNow({}, null), false);
  });
});

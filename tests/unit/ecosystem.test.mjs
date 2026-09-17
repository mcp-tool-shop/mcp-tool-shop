import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEcosystem, siteLane, PATH_QUESTIONS } from "../../scripts/lib/ecosystem.mjs";

describe("siteLane", () => {
  it("maps catalog lanes onto the site filter vocabulary", () => {
    assert.equal(siteLane("shipped"), "shipped");
    assert.equal(siteLane("in-development"), "active_lab");
    assert.equal(siteLane("archive"), "seed_vault");
  });
});

describe("PATH_QUESTIONS", () => {
  it("covers every catalog path id", () => {
    assert.deepEqual(Object.keys(PATH_QUESTIONS).sort(), [
      "a-mcp-servers",
      "b-ai-agents",
      "c-game-tooling",
      "d-verification",
      "e-local-ai",
    ]);
  });
});

describe("applyEcosystem", () => {
  const ecosystem = {
    repos: [
      {
        name: "tool-compass",
        area: "mcp-servers",
        lane: "shipped",
        install: "npx @mcptoolshop/tool-compass",
        package: { npm: "@mcptoolshop/tool-compass" },
      },
      {
        name: "motif",
        area: "games-and-game-tooling",
        lane: "in-development",
        install: null,
        package: null,
      },
    ],
  };

  it("sets a verified install and area", () => {
    const projects = [{ repo: "tool-compass" }];
    const report = applyEcosystem(projects, ecosystem);
    assert.equal(report.applied, 1);
    assert.equal(projects[0].install, "npx @mcptoolshop/tool-compass");
    assert.equal(projects[0].area, "mcp-servers");
    assert.equal(projects[0].lane, "shipped");
    assert.equal(projects[0].catalogued, true);
  });

  it("clears a guessed install for a package we do not own", () => {
    const projects = [{ repo: "motif", install: "npm install motif" }];
    const report = applyEcosystem(projects, ecosystem);
    assert.equal(report.installsCleared, 1);
    assert.equal(projects[0].install, undefined);
    assert.equal(projects[0].lane, "active_lab");
  });

  it("leaves unknown repos alone", () => {
    const projects = [{ repo: "not-in-catalog", install: "npx whatever" }];
    applyEcosystem(projects, ecosystem);
    assert.equal(projects[0].install, "npx whatever");
    assert.equal(projects[0].catalogued, undefined);
  });
});

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "pathe";

const REPO_ROOT = resolve(__dirname, "../..");

describe("Skill body assets — budget gate", () => {
  test("assets/skill/SKILL.md is at most 1000 chars (hard gate per design §2)", () => {
    const content = readFileSync(resolve(REPO_ROOT, "assets/skill/SKILL.md"), "utf-8");
    expect(content.length, `SKILL.md is ${content.length} chars (over the 1000-char hard gate)`).toBeLessThanOrEqual(1000);
  });

  test("assets/skill/SKILL.md has the YAML frontmatter required by Claude Code", () => {
    const content = readFileSync(resolve(REPO_ROOT, "assets/skill/SKILL.md"), "utf-8");
    expect(content.startsWith("---\nname: logbook-auto-capture")).toBe(true);
    expect(content).toMatch(/^---\n[\s\S]+?\n---\n/);
  });

  test("assets/skill/reference.md exists and is reasonable size", () => {
    const content = readFileSync(resolve(REPO_ROOT, "assets/skill/reference.md"), "utf-8");
    expect(content.length).toBeGreaterThan(500);
    expect(content.length).toBeLessThanOrEqual(4000);  // reasonable on-demand ceiling
  });

  test("SKILL.md references the canonical MCP tool names", () => {
    const content = readFileSync(resolve(REPO_ROOT, "assets/skill/SKILL.md"), "utf-8");
    const requiredTools = ["logbook_decision", "logbook_error", "logbook_fix", "logbook_lesson", "logbook_milestone"];
    for (const tool of requiredTools) {
      expect(content, `SKILL.md must reference ${tool}`).toContain(tool);
    }
  });

  test("reference.md documents all 9 MCP tools", () => {
    const content = readFileSync(resolve(REPO_ROOT, "assets/skill/reference.md"), "utf-8");
    const allTools = ["logbook_decision", "logbook_error", "logbook_fix", "logbook_lesson", "logbook_resource", "logbook_milestone", "logbook_phase", "logbook_suggest", "logbook_state"];
    for (const tool of allTools) {
      expect(content, `reference.md must document ${tool}`).toContain(tool);
    }
  });
});

/**
 * subagent-body-budget.test.ts — budget gate for subagent asset bodies.
 *
 * TDD (T2.1): written BEFORE the asset files exist.
 * RED state: files absent → readFileSync throws.
 *
 * Each subagent body must be:
 *   - ≤ 800 chars (≤ 200 tokens gate — chars/4)
 *   - YAML frontmatter present with name, description, tools
 *   - description ≤ 30 chars per spec §5/design §4
 */

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "pathe";

const REPO_ROOT = resolve(__dirname, "../..");

function readSubagentBody(name: string): string {
  return readFileSync(resolve(REPO_ROOT, `assets/subagents/${name}.md`), "utf-8");
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]+?)\n---\n/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

describe("Subagent body assets — budget gate", () => {
  describe("assets/subagents/logbook-curator.md", () => {
    test("file is at most 800 chars (≤ 200 token hard gate)", () => {
      const content = readSubagentBody("logbook-curator");
      expect(
        content.length,
        `logbook-curator.md is ${content.length} chars (over the 800-char gate)`
      ).toBeLessThanOrEqual(800);
    });

    test("has valid YAML frontmatter with name, description, tools", () => {
      const content = readSubagentBody("logbook-curator");
      expect(content).toMatch(/^---\n[\s\S]+?\n---\n/);
      const fm = parseFrontmatter(content);
      expect(fm["name"], "frontmatter must have name").toBeTruthy();
      expect(fm["description"], "frontmatter must have description").toBeTruthy();
      expect(fm["tools"], "frontmatter must have tools").toBeTruthy();
    });

    test("description is ≤ 30 chars", () => {
      const content = readSubagentBody("logbook-curator");
      const fm = parseFrontmatter(content);
      const desc = fm["description"] ?? "";
      expect(
        desc.length,
        `description is ${desc.length} chars (over 30-char limit): "${desc}"`
      ).toBeLessThanOrEqual(30);
    });

    test("name matches filename (logbook-curator)", () => {
      const content = readSubagentBody("logbook-curator");
      const fm = parseFrontmatter(content);
      expect(fm["name"]).toBe("logbook-curator");
    });
  });

  describe("assets/subagents/logbook-teacher.md", () => {
    test("file is at most 800 chars (≤ 200 token hard gate)", () => {
      const content = readSubagentBody("logbook-teacher");
      expect(
        content.length,
        `logbook-teacher.md is ${content.length} chars (over the 800-char gate)`
      ).toBeLessThanOrEqual(800);
    });

    test("has valid YAML frontmatter with name, description, tools", () => {
      const content = readSubagentBody("logbook-teacher");
      expect(content).toMatch(/^---\n[\s\S]+?\n---\n/);
      const fm = parseFrontmatter(content);
      expect(fm["name"], "frontmatter must have name").toBeTruthy();
      expect(fm["description"], "frontmatter must have description").toBeTruthy();
      expect(fm["tools"], "frontmatter must have tools").toBeTruthy();
    });

    test("description is ≤ 30 chars", () => {
      const content = readSubagentBody("logbook-teacher");
      const fm = parseFrontmatter(content);
      const desc = fm["description"] ?? "";
      expect(
        desc.length,
        `description is ${desc.length} chars (over 30-char limit): "${desc}"`
      ).toBeLessThanOrEqual(30);
    });

    test("name matches filename (logbook-teacher)", () => {
      const content = readSubagentBody("logbook-teacher");
      const fm = parseFrontmatter(content);
      expect(fm["name"]).toBe("logbook-teacher");
    });
  });
});

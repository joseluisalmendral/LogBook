import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../");
const README_PATH = resolve(ROOT, "README.md");

describe("README.md presence", () => {
  it("exists at project root", () => {
    expect(existsSync(README_PATH)).toBe(true);
  });

  it("has at least 800 characters", () => {
    const content = readFileSync(README_PATH, "utf8");
    expect(content.length).toBeGreaterThanOrEqual(800);
  });

  it("contains ## Install section", () => {
    const content = readFileSync(README_PATH, "utf8");
    expect(content).toContain("## Install");
  });

  it("contains ## Quick start section", () => {
    const content = readFileSync(README_PATH, "utf8");
    expect(content).toContain("## Quick start");
  });

  it("contains ## Command reference section", () => {
    const content = readFileSync(README_PATH, "utf8");
    expect(content).toContain("## Command reference");
  });

  it("contains ## Token budget section", () => {
    const content = readFileSync(README_PATH, "utf8");
    expect(content).toContain("## Token budget");
  });

  it("contains ## Uninstall section", () => {
    const content = readFileSync(README_PATH, "utf8");
    expect(content).toContain("## Uninstall");
  });
});

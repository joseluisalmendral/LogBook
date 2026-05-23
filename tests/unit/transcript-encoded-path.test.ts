/**
 * Unit tests: pathToEncoded (W3 spec — transcript scraper encoded path invariant).
 *
 * Verifies that pathToEncoded produces the correct encoded directory name used
 * by Claude Code under ~/.claude/projects/.
 */

import { describe, it, expect } from "vitest";
import { pathToEncoded } from "../../src/connectors/claude-code/transcript.js";

describe("pathToEncoded", () => {
  it("converts the actual LogBook-repo path correctly", () => {
    const abs =
      "/Users/joseluis.fernandez/Documents/CONSTRUCCION FORMACION IA B2B/LogBook-repo";
    const encoded = pathToEncoded(abs);
    // Empirically verified: dots also become dashes (only [A-Za-z0-9] preserved).
    // joseluis.fernandez → joseluis-fernandez (dot replaced).
    expect(encoded).toBe(
      "-Users-joseluis-fernandez-Documents-CONSTRUCCION-FORMACION-IA-B2B-LogBook-repo",
    );
  });

  it("converts a simple path without spaces", () => {
    expect(pathToEncoded("/Users/me/MyProject")).toBe("-Users-me-MyProject");
  });

  it("converts a path with dots in directory names", () => {
    // Dots become dashes (only [A-Za-z0-9] is preserved).
    expect(pathToEncoded("/Users/me/project.v2")).toBe("-Users-me-project-v2");
  });

  it("collapses consecutive dashes defensively", () => {
    // Double slash would produce double dash — collapse to single.
    expect(pathToEncoded("/Users//me/project")).toBe("-Users-me-project");
  });

  it("converts Windows-style path (backslashes and colons → dashes)", () => {
    // Backslash and colon are non-alphanumeric → become dashes (collapsed).
    expect(pathToEncoded("C:\\Users\\me\\Project")).toBe("C-Users-me-Project");
  });

  it("handles path with underscores (underscores become dashes)", () => {
    // Underscores are NOT alphanumeric → become dashes.
    const result = pathToEncoded("/Users/me/my_project");
    expect(result).toBe("-Users-me-my-project");
  });

  it("leading slash becomes leading dash", () => {
    const result = pathToEncoded("/foo");
    expect(result.startsWith("-")).toBe(true);
  });
});

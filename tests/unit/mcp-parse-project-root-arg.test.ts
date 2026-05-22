/**
 * Unit tests for parseProjectRootArg — the --project-root argv parser.
 *
 * Covers: present+valid, missing flag, flag without value, non-absolute path,
 * unknown flags interspersed, and multiple unknown flags before the target.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseProjectRootArg } from "../../src/mcp/server.js";

// Capture stderr to verify warning messages without polluting test output.
let stderrOutput: string[] = [];

beforeEach(() => {
  stderrOutput = [];
  vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
    stderrOutput.push(String(msg));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseProjectRootArg", () => {
  it("returns the value when --project-root is present with a valid absolute path", () => {
    const result = parseProjectRootArg(["node", "server.cjs", "--project-root", "/abs/path/to/project"]);
    expect(result).toBe("/abs/path/to/project");
    expect(stderrOutput).toHaveLength(0);
  });

  it("returns undefined when --project-root flag is absent", () => {
    const result = parseProjectRootArg(["node", "server.cjs"]);
    expect(result).toBeUndefined();
    expect(stderrOutput).toHaveLength(0);
  });

  it("returns undefined and warns when --project-root has no following value", () => {
    const result = parseProjectRootArg(["node", "server.cjs", "--project-root"]);
    expect(result).toBeUndefined();
    expect(stderrOutput.join("")).toContain("--project-root flag present but has no value");
  });

  it("returns undefined and warns when --project-root value is another flag", () => {
    // next slot is another flag, not a path value
    const result = parseProjectRootArg(["node", "server.cjs", "--project-root", "--other-flag"]);
    // "--other-flag" is not an absolute path → triggers non-absolute warning
    expect(result).toBeUndefined();
    expect(stderrOutput.join("")).toContain("not an absolute path");
  });

  it("returns undefined and warns when --project-root value is a relative path", () => {
    const result = parseProjectRootArg(["node", "server.cjs", "--project-root", "relative/path"]);
    expect(result).toBeUndefined();
    expect(stderrOutput.join("")).toContain("not an absolute path");
  });

  it("still finds --project-root when unknown flags appear before it", () => {
    const result = parseProjectRootArg([
      "node",
      "server.cjs",
      "--log-level",
      "debug",
      "--project-root",
      "/abs/project",
    ]);
    expect(result).toBe("/abs/project");
  });

  it("still finds --project-root when unknown flags appear after it", () => {
    const result = parseProjectRootArg([
      "node",
      "server.cjs",
      "--project-root",
      "/abs/project",
      "--unknown-flag",
      "value",
    ]);
    expect(result).toBe("/abs/project");
  });

  it("handles an empty argv (just node + script)", () => {
    const result = parseProjectRootArg(["node", "server.cjs"]);
    expect(result).toBeUndefined();
  });

  it("handles argv with only node binary (no script)", () => {
    const result = parseProjectRootArg(["node"]);
    expect(result).toBeUndefined();
  });

  it("returns undefined and warns when --project-root value is an empty string", () => {
    // argv: ["node", "server.cjs", "--project-root", ""]
    const result = parseProjectRootArg(["node", "server.cjs", "--project-root", ""]);
    expect(result).toBeUndefined();
    expect(stderrOutput.join("")).toContain("--project-root flag present but has no value");
  });
});

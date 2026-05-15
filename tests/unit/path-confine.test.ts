import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assertWithinProject } from "../../src/util/path-confine.js";

let tmpRoot: string;
// Canonical (realpath-resolved) version for assertions on macOS where
// os.tmpdir() returns /var/... but realpathSync returns /private/var/...
let canonicalRoot: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lb-path-confine-"));
  canonicalRoot = fs.realpathSync(tmpRoot);
  // Create a nested directory to validate happy paths
  fs.mkdirSync(path.join(canonicalRoot, "nested", "deep"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(canonicalRoot, { recursive: true, force: true });
});

describe("assertWithinProject — rejections", () => {
  it("throws on path traversal via '..'", () => {
    expect(() => assertWithinProject("../../etc/passwd", canonicalRoot)).toThrow();
  });

  it("throws on absolute path that escapes root", () => {
    expect(() => assertWithinProject("/etc/passwd", canonicalRoot)).toThrow();
  });

  it("throws on normalized traversal that still escapes", () => {
    expect(() =>
      assertWithinProject("nested/../../outside", canonicalRoot)
    ).toThrow();
  });
});

describe("assertWithinProject — happy paths", () => {
  it("returns the canonicalized absolute path for a simple relative path", () => {
    const result = assertWithinProject("nested", canonicalRoot);
    // realpathSync resolves symlinks; on macOS /var → /private/var
    expect(result).toBe(path.join(canonicalRoot, "nested"));
  });

  it("allows deeply nested paths within the root", () => {
    const result = assertWithinProject("nested/deep", canonicalRoot);
    expect(result).toBe(path.join(canonicalRoot, "nested", "deep"));
  });

  it("allows a path that doesn't yet exist (validates parent instead)", () => {
    // The parent 'nested' exists; 'newfile.txt' doesn't yet — should not throw
    expect(() =>
      assertWithinProject("nested/newfile.txt", canonicalRoot)
    ).not.toThrow();
  });
});

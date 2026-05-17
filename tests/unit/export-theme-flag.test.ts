/**
 * Unit tests for `logbook export --theme` flag (S2.4).
 *
 * Verifies:
 * - exportHtml with themePath replaces INLINE_CSS with sanitized theme file
 * - exportInstructorPack with themePath replaces INLINE_CSS with sanitized theme file
 * - When no theme, INLINE_CSS is used unchanged
 * - Malformed / missing theme path errors gracefully
 *
 * RED phase: written before implementation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { exportHtml } from "../../src/export/html.js";
import { exportInstructorPack } from "../../src/export/instructor-pack.js";
import { INLINE_CSS } from "../../src/export/inline-css.js";
import { makePaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ProjectPaths = ReturnType<typeof makePaths>;

const tmpDirs: string[] = [];

function makeTmpProject(): { dir: string; paths: ProjectPaths } {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(tmp, `lb-theme-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(dir);

  // Required structure
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-theme", version: "0.0.0" })
  );

  // Write minimal required docs
  const stub = "# LogBook\n\nSome content.\n";
  fs.writeFileSync(path.join(dir, "logbook", "docs", "index.md"), stub);
  fs.writeFileSync(path.join(dir, "logbook", "docs", "timeline.md"), stub);
  fs.writeFileSync(
    path.join(dir, "logbook", "docs", "errors-and-lessons.md"),
    stub
  );

  const paths = makePaths(dir);
  return { dir, paths };
}

afterEach(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tmpDirs.length = 0;
});

// ---------------------------------------------------------------------------
// exportHtml --theme
// ---------------------------------------------------------------------------

describe("exportHtml — --theme flag (S2.4)", () => {
  it("uses INLINE_CSS when no themePath is provided", async () => {
    const { dir, paths } = makeTmpProject();
    const outFile = path.join(dir, "out.html");
    await exportHtml({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    // INLINE_CSS is embedded; look for a characteristic fragment
    expect(html).toContain("-apple-system");
  });

  it("replaces INLINE_CSS with theme file contents when themePath is provided", async () => {
    const { dir, paths } = makeTmpProject();
    const themePath = path.join(dir, "theme.css");
    const themeContent = `body { background: hotpink; }`;
    fs.writeFileSync(themePath, themeContent);

    const outFile = path.join(dir, "out-themed.html");
    await exportHtml({ paths, outFile, themePath });
    const html = fs.readFileSync(outFile, "utf8");

    expect(html).toContain("background: hotpink");
    // Default INLINE_CSS characteristic (-apple-system) must NOT appear
    expect(html).not.toContain("-apple-system");
  });

  it("sanitizeCss is applied to theme content (strips @import)", async () => {
    const { dir, paths } = makeTmpProject();
    const themePath = path.join(dir, "evil-theme.css");
    fs.writeFileSync(
      themePath,
      `@import url(https://evil.com/font.css);\nbody { color: red; }`
    );

    const outFile = path.join(dir, "out-evil.html");
    await exportHtml({ paths, outFile, themePath });
    const html = fs.readFileSync(outFile, "utf8");

    expect(html).not.toContain("@import");
    expect(html).not.toContain("evil.com");
    expect(html).toContain("color: red");
  });

  it("throws a clear error when themePath does not exist", async () => {
    const { paths } = makeTmpProject();
    await expect(
      exportHtml({ paths, themePath: "/nonexistent/path/to/theme.css" })
    ).rejects.toThrow(/theme/i);
  });
});

// ---------------------------------------------------------------------------
// exportInstructorPack --theme
// ---------------------------------------------------------------------------

describe("exportInstructorPack — --theme flag (S2.4)", () => {
  it("uses INLINE_CSS when no themePath is provided", async () => {
    const { dir, paths } = makeTmpProject();
    const outFile = path.join(dir, "pack.html");
    await exportInstructorPack({ paths, outFile });
    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain("-apple-system");
  });

  it("replaces INLINE_CSS with theme file when themePath is provided", async () => {
    const { dir, paths } = makeTmpProject();
    const themePath = path.join(dir, "my-theme.css");
    fs.writeFileSync(themePath, `body { font-family: Georgia; }`);

    const outFile = path.join(dir, "pack-themed.html");
    await exportInstructorPack({ paths, outFile, themePath });
    const html = fs.readFileSync(outFile, "utf8");

    expect(html).toContain("font-family: Georgia");
    expect(html).not.toContain("-apple-system");
  });
});

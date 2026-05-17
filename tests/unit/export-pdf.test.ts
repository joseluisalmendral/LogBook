/**
 * Unit tests for the PDF export pipeline (S5.1).
 *
 * Verifies:
 * - Mock mode (LOGBOOK_PUPPETEER_MOCK=1) writes a stub PDF without spawning Chrome
 * - Default output path resolves to logbook/exports/instructor-pack.pdf
 * - --out <path> writes to the specified path
 * - --safe applies sanitizeForSafeExport before rendering
 * - --theme <path> uses custom CSS (passed through to HTML pipeline)
 * - Fails fast with install instructions when Chrome is not detected (no mock, no CHROME_PATH, no puppeteer.executablePath)
 * - Failure message includes install instructions
 * - Does NOT silently fall back to HTML on PDF failure
 *
 * RED phase: written before implementation (strict TDD S5.1).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makePaths } from "../../src/core/paths.js";
import { exportPdf } from "../../src/export/pdf.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpLogbook(): Promise<{ root: string; paths: ReturnType<typeof makePaths> }> {
  const root = await mkdtemp(join(tmpdir(), "logbook-pdf-test-"));
  const paths = makePaths(root);

  // Create minimal docs so the HTML pipeline can build
  const docsDir = join(root, "logbook", "docs");
  await mkdir(docsDir, { recursive: true });
  await writeFile(join(docsDir, "index.md"), "# Index\n\nSome content.\n", "utf8");
  await writeFile(join(docsDir, "timeline.md"), "# Timeline\n\nSome timeline.\n", "utf8");
  await writeFile(
    join(docsDir, "errors-and-lessons.md"),
    "# Errors and Lessons\n\nSome lessons.\n",
    "utf8"
  );

  return { root, paths };
}

// ---------------------------------------------------------------------------
// Tests — mock mode
// ---------------------------------------------------------------------------

describe("exportPdf — mock mode (LOGBOOK_PUPPETEER_MOCK=1)", () => {
  let savedEnv: string | undefined;
  let tmpDir: string;

  beforeEach(async () => {
    savedEnv = process.env["LOGBOOK_PUPPETEER_MOCK"];
    process.env["LOGBOOK_PUPPETEER_MOCK"] = "1";
    tmpDir = await mkdtemp(join(tmpdir(), "logbook-pdf-mock-"));
  });

  afterEach(async () => {
    if (savedEnv === undefined) {
      delete process.env["LOGBOOK_PUPPETEER_MOCK"];
    } else {
      process.env["LOGBOOK_PUPPETEER_MOCK"] = savedEnv;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes stub PDF without spawning Chrome (LOGBOOK_PUPPETEER_MOCK=1)", async () => {
    const { paths, root } = await makeTmpLogbook();
    const outFile = join(tmpDir, "out.pdf");

    const report = await exportPdf({ paths, outFile });

    // File must exist
    expect(existsSync(outFile)).toBe(true);
    // Must contain PDF magic bytes
    const buf = await readFile(outFile);
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    // Report must reference correct outFile
    expect(report.outFile).toBe(outFile);
    // Cleanup root
    await rm(root, { recursive: true, force: true });
  });

  it("default output path is logbook/exports/instructor-pack.pdf", async () => {
    const { paths, root } = await makeTmpLogbook();

    const report = await exportPdf({ paths });

    const expectedPath = join(root, "logbook", "exports", "instructor-pack.pdf");
    expect(report.outFile).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it("--out <path> writes to the specified path", async () => {
    const { paths, root } = await makeTmpLogbook();
    const outFile = join(tmpDir, "custom-output.pdf");

    const report = await exportPdf({ paths, outFile });

    expect(report.outFile).toBe(outFile);
    expect(existsSync(outFile)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it("--safe applies sanitizeForSafeExport before rendering (no error thrown)", async () => {
    const { paths, root } = await makeTmpLogbook();
    // Inject a sensitive path into a doc
    const docsDir = join(root, "logbook", "docs");
    await writeFile(
      join(docsDir, "index.md"),
      "# Index\n\nPath: /Users/secret/project\nEmail: user@example.com\n",
      "utf8"
    );

    const outFile = join(tmpDir, "safe.pdf");
    // Should not throw — safe mode just sanitizes before rendering
    const report = await exportPdf({ paths, outFile, safe: true });

    expect(report.outFile).toBe(outFile);
    expect(existsSync(outFile)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it("--theme <path> uses custom CSS (no error thrown)", async () => {
    const { paths, root } = await makeTmpLogbook();
    const themeFile = join(tmpDir, "theme.css");
    await writeFile(themeFile, "body { background: #333; color: white; }", "utf8");

    const outFile = join(tmpDir, "themed.pdf");
    const report = await exportPdf({ paths, outFile, themePath: themeFile });

    expect(report.outFile).toBe(outFile);
    expect(existsSync(outFile)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it("ExportReport contains bytes and durationMs", async () => {
    const { paths, root } = await makeTmpLogbook();
    const outFile = join(tmpDir, "report-check.pdf");

    const report = await exportPdf({ paths, outFile });

    expect(typeof report.bytes).toBe("number");
    expect(report.bytes).toBeGreaterThan(0);
    expect(typeof report.durationMs).toBe("number");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    await rm(root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Tests — Chrome detection failure (no mock, no CHROME_PATH)
// ---------------------------------------------------------------------------

describe("exportPdf — Chrome detection failure (S5.1)", () => {
  let savedMock: string | undefined;
  let savedChromePath: string | undefined;
  let tmpDir: string;

  beforeEach(async () => {
    savedMock = process.env["LOGBOOK_PUPPETEER_MOCK"];
    savedChromePath = process.env["CHROME_PATH"];
    // Remove mock and CHROME_PATH to force failure path
    delete process.env["LOGBOOK_PUPPETEER_MOCK"];
    delete process.env["CHROME_PATH"];
    tmpDir = await mkdtemp(join(tmpdir(), "logbook-pdf-fail-"));
  });

  afterEach(async () => {
    if (savedMock === undefined) {
      delete process.env["LOGBOOK_PUPPETEER_MOCK"];
    } else {
      process.env["LOGBOOK_PUPPETEER_MOCK"] = savedMock;
    }
    if (savedChromePath === undefined) {
      delete process.env["CHROME_PATH"];
    } else {
      process.env["CHROME_PATH"] = savedChromePath;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("fails fast when Chrome not detected (no mock, no CHROME_PATH, no executablePath)", async () => {
    const { paths, root } = await makeTmpLogbook();
    const outFile = join(tmpDir, "should-not-exist.pdf");

    await expect(exportPdf({ paths, outFile })).rejects.toThrow(
      /Chrome|Chromium/
    );
    // Output file must NOT have been created
    expect(existsSync(outFile)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  it("failure message includes platform-specific install instructions", async () => {
    const { paths, root } = await makeTmpLogbook();
    const outFile = join(tmpDir, "should-not-exist.pdf");

    let errorMsg = "";
    try {
      await exportPdf({ paths, outFile });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    // Must mention Chrome/Chromium AND install guidance
    expect(errorMsg).toMatch(/Chrome|Chromium/);
    expect(errorMsg).toMatch(/CHROME_PATH|brew|apt|install/);
    await rm(root, { recursive: true, force: true });
  });

  it("does NOT silently fall back to HTML on PDF failure", async () => {
    const { paths, root } = await makeTmpLogbook();
    const outFile = join(tmpDir, "should-not-exist.pdf");

    // Must throw — never resolve with an HTML fallback
    await expect(exportPdf({ paths, outFile })).rejects.toThrow();
    // Ensure no HTML file was created either
    const htmlFallback = outFile.replace(/\.pdf$/, ".html");
    expect(existsSync(htmlFallback)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });
});

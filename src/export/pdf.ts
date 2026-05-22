/**
 * PDF export pipeline (S5.1).
 *
 * Renders the instructor-pack HTML to a PDF file via puppeteer-core.
 * puppeteer-core is an optionalDependency — dynamically imported at runtime
 * so that other logbook commands work even when puppeteer-core was not installed.
 *
 * Chrome detection order:
 *   1. process.env.CHROME_PATH (if set and file exists)
 *   2. puppeteer-core.executablePath() (async in v25, may throw if Chrome not installed)
 *   3. Fail-fast with platform-specific install instructions
 *
 * Mock seam:
 *   LOGBOOK_PUPPETEER_MOCK=1 — skip puppeteer entirely, write a minimal valid
 *   PDF stub to outFile. Used in CI and unit tests.
 *
 * Bundle note:
 *   The instructor-pack pipeline (unified/remark/rehype) is loaded lazily via
 *   loadInstructorPackModule() at runtime to keep the pdf.cjs bundle ≤80 KB.
 *   In tests, the module is imported directly from src/ via __TEST_EXPORT_MODULE__.
 *
 * Design: proposal D5, design §8.
 */

import { writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join as pathJoin } from "node:path";
import { join } from "pathe";
import type { ProjectPaths } from "../core/paths.js";
import type { ExportReport } from "../types/reports.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExportPdfOptions {
  /** Project paths (used to locate logbook/ directory). */
  paths: ProjectPaths;
  /** Output PDF path. Default: <dataDir>/exports/instructor-pack.pdf */
  outFile?: string;
  /** Redact paths/users/emails before rendering. Default: false. */
  safe?: boolean;
  /** Absolute path to a custom CSS theme file. */
  themePath?: string;
}

// ---------------------------------------------------------------------------
// Instructor-pack lazy-loader
// ---------------------------------------------------------------------------

/**
 * Interface for the instructor-pack export module (subset used by pdf.ts).
 * Typed here so the PDF bundle does NOT need to import instructor-pack.ts
 * (which would inline the full unified/remark/rehype chain).
 */
interface InstructorPackModule {
  exportInstructorPack: (opts: {
    paths: ProjectPaths;
    outFile?: string;
    safe?: boolean;
    themePath?: string;
  }) => Promise<ExportReport>;
}

/**
 * Override hook for test environments.
 * Tests can inject the instructor-pack module directly to avoid CJS bundle resolution.
 * Set before calling exportPdf in test setup if needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let __TEST_EXPORT_MODULE__: InstructorPackModule | undefined = undefined;

/**
 * Load the instructor-pack module.
 *
 * In the CJS bundle (production): loads from dist/export/html.cjs via a
 * non-literal require() path so that the heavy unified/remark/rehype chain
 * is NOT inlined into dist/export/pdf.cjs.
 *
 * In source/test environments: if __TEST_EXPORT_MODULE__ is set, use it.
 * Otherwise fall back to a non-literal dynamic import built at runtime.
 *
 * The key invariant: NO static or resolvable dynamic import of instructor-pack.
 * All references are via runtime-evaluated strings to prevent bundler inlining.
 */
async function loadInstructorPackModule(): Promise<InstructorPackModule> {
  // 1. Test override — allows tests to inject the module directly
  if (__TEST_EXPORT_MODULE__) {
    return __TEST_EXPORT_MODULE__;
  }

  // 2. CJS bundle / test without __TEST_EXPORT_MODULE__: non-literal require
  //    In the CJS bundle, __dirname resolves to dist/export/ at runtime.
  //    The html.cjs bundle lives at dist/export/html.cjs.
  //    In source test environments (vitest), __dirname may be defined too
  //    but html.cjs may not exist — fall through to step 3 in that case.
  const htmlCjsPath = pathJoin(__dirname, "html.cjs");
  if (typeof __dirname !== "undefined" && require("node:fs").existsSync(htmlCjsPath)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(htmlCjsPath) as InstructorPackModule;
    if (mod && typeof mod.exportInstructorPack === "function") {
      return mod;
    }
  }

  // 3. Source / test environment fallback.
  //    Build a dynamic import path at runtime so bundlers cannot resolve it.
  //    This code path is only reached in: vitest source tests, pre-build CLI.
  const srcDir = pathJoin(__dirname, "..");
  // Construct path segments at runtime to defeat bundler static analysis
  const segments = ["export", "instructor-pack.js"];
  const modulePath = pathJoin(srcDir, ...segments);
  const mod = await (Function('p', 'return import(p)')(modulePath)) as InstructorPackModule;
  return mod;
}

// ---------------------------------------------------------------------------
// Minimal valid PDF stub (for LOGBOOK_PUPPETEER_MOCK=1)
// ---------------------------------------------------------------------------

/**
 * A minimal valid PDF-1.4 document.
 * Starts with %PDF magic bytes — recognized by all PDF readers.
 */
const STUB_PDF = Buffer.from(
  "%PDF-1.4\n" +
    "%\xff\xff\xff\xff\n" +
    "1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n" +
    "2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n" +
    "3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]>>\nendobj\n" +
    "xref\n0 4\n0000000000 65535 f \n" +
    "0000000009 00000 n \n" +
    "0000000058 00000 n \n" +
    "0000000115 00000 n \n" +
    "trailer\n<</Size 4 /Root 1 0 R>>\n" +
    "startxref\n190\n%%EOF\n",
  "utf8"
);

// ---------------------------------------------------------------------------
// Chrome detection
// ---------------------------------------------------------------------------

/**
 * Detect the Chrome/Chromium executable path.
 *
 * Order:
 *   1. CHROME_PATH env var (if set and file exists at that path)
 *   2. puppeteer-core.executablePath() — async in v25, may throw/reject if
 *      no bundled Chrome is configured (ERR_INVALID_ARG_TYPE or similar)
 *   3. Throw with platform-specific install instructions
 */
async function detectChromePath(): Promise<string> {
  // 1. CHROME_PATH env
  const envPath = process.env["CHROME_PATH"];
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // 2. Try puppeteer-core.executablePath()
  // puppeteer-core v25+ has an ASYNC executablePath() that rejects with
  // ERR_INVALID_ARG_TYPE when no bundled Chrome is configured.
  // We must await and catch both sync throws and async rejections.
  let puppeteer: { executablePath?: () => Promise<string> | string } | undefined;
  try {
    // Dynamic import so the module is optional
    puppeteer = await import("puppeteer-core") as typeof puppeteer;
  } catch {
    // puppeteer-core not installed at all → fall through to fail-fast
    puppeteer = undefined;
  }

  if (puppeteer && typeof puppeteer.executablePath === "function") {
    let execPath: string | undefined;
    try {
      // executablePath may be sync or async depending on version
      const result = puppeteer.executablePath();
      // If it returns a Promise (v25+), await it
      execPath = result instanceof Promise ? await result : result;
    } catch {
      // Throws/rejects when no bundled Chrome → fall through to fail-fast
      execPath = undefined;
    }
    if (execPath && existsSync(execPath)) {
      return execPath;
    }
  }

  // 3. Fail fast with platform-specific install instructions
  throw new Error(
    "PDF export requires Chrome or Chromium.\n" +
      "Set CHROME_PATH=/path/to/chrome, or install Chrome:\n" +
      "  macOS:  brew install --cask google-chrome\n" +
      "  Linux:  apt install chromium-browser  (or equivalent)"
  );
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Export the instructor-pack HTML to a PDF file.
 *
 * Algorithm:
 * 1. Resolve output path.
 * 2. If LOGBOOK_PUPPETEER_MOCK=1 → write STUB_PDF and return early.
 * 3. Detect Chrome path (fail-fast if not found).
 * 4. Build HTML via instructor-pack pipeline to a temp HTML file.
 * 5. Launch puppeteer-core → newPage → setContent → page.pdf.
 * 6. Write PDF atomically (temp + rename).
 * 7. Return ExportReport.
 */
export async function exportPdf(opts: ExportPdfOptions): Promise<ExportReport> {
  const start = Date.now();
  const { paths } = opts;

  const outFile = opts.outFile ?? join(paths.dataDir, "exports", "instructor-pack.pdf");
  const outDir = dirname(outFile);
  await mkdir(outDir, { recursive: true });

  // ---------------------------------------------------------------------------
  // Mock mode — write stub PDF, skip puppeteer entirely
  // ---------------------------------------------------------------------------
  if (process.env["LOGBOOK_PUPPETEER_MOCK"] === "1") {
    const tmpFile = `${outFile}.tmp`;
    await writeFile(tmpFile, STUB_PDF);
    await rename(tmpFile, outFile);
    const durationMs = Date.now() - start;
    return {
      outFile,
      bytes: STUB_PDF.length,
      externalRefs: 0,
      allowedRefs: 0,
      durationMs,
    };
  }

  // ---------------------------------------------------------------------------
  // Production mode — detect Chrome, build HTML, render to PDF
  // ---------------------------------------------------------------------------

  // Step 3: Detect Chrome (may throw with install instructions)
  const executablePath = await detectChromePath();

  // Step 4: Build HTML content via the instructor-pack pipeline
  // We render to a temp HTML file that puppeteer can load.
  const htmlTmpFile = `${outFile}.html.tmp`;
  const { exportInstructorPack } = await loadInstructorPackModule();
  await exportInstructorPack({
    paths,
    outFile: htmlTmpFile,
    safe: opts.safe,
    themePath: opts.themePath,
  });

  // Step 5: Read the generated HTML (puppeteer setContent approach)
  const { readFile } = await import("node:fs/promises");
  const htmlContent = await readFile(htmlTmpFile, "utf8");

  // Step 6: Launch puppeteer, render to PDF
  // Dynamic import to keep puppeteer-core out of other bundles
  const puppeteer = await import("puppeteer-core");

  // Type the browser interface loosely to avoid pulling in puppeteer-core type defs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  try {
    browser = await (puppeteer as any).launch({
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

    // Atomic write
    const tmpFile = `${outFile}.tmp`;
    await writeFile(tmpFile, pdfBuffer as Buffer);
    await rename(tmpFile, outFile);

    // Cleanup temp HTML (best-effort)
    try {
      const { rm } = await import("node:fs/promises");
      await rm(htmlTmpFile, { force: true });
    } catch {
      // Non-fatal
    }

    const durationMs = Date.now() - start;
    return {
      outFile,
      bytes: (pdfBuffer as Buffer).length,
      externalRefs: 0,
      allowedRefs: 0,
      durationMs,
    };
  } finally {
    if (browser) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await browser.close();
      } catch {
        // Non-fatal
      }
    }
  }
}

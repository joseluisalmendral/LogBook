/**
 * logbook export pdf — Render instructor-pack HTML to PDF via puppeteer-core (S5.1).
 *
 * Lazy-loads src/export/pdf.ts at runtime (dynamic import pattern).
 * puppeteer-core is an optionalDependency — not bundled in the CLI cold-start path.
 *
 * Flags: --out <path>, --safe, --theme <path>
 *
 * Design: spec D5 (optionalDependencies), design §8 (PDF pipeline).
 */

import { defineCommand } from "citty";
import * as nodePath from "node:path";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import type { exportPdf as ExportPdfFn, ExportPdfOptions } from "../../../export/pdf.js";

/**
 * Lazy-load the PDF export module at runtime.
 * The PDF bundle lives at dist/export/pdf.cjs (separate tsup entry).
 * Non-literal require path prevents esbuild from inlining at bundle time.
 */
function loadPdfModule(): { exportPdf: typeof ExportPdfFn } {
  // Non-literal path — esbuild cannot resolve at bundle time.
  // __dirname in the CJS bundle resolves to dist/cli/ at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(join(__dirname, "../../export/pdf.cjs")) as {
    exportPdf: typeof ExportPdfFn;
  };
}

export default defineCommand({
  meta: {
    name: "pdf",
    description: "Render instructor-pack HTML to PDF via puppeteer-core (Chrome required)",
  },
  args: {
    out: {
      type: "string",
      required: false,
      description: "Output PDF path (default: logbook/exports/instructor-pack.pdf)",
    },
    safe: {
      type: "boolean",
      default: false,
      description: "Redact paths, usernames, and emails before rendering",
    },
    theme: {
      type: "string",
      required: false,
      description: "Path to a custom CSS theme file (replaces default styles)",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit ExportReport as JSON",
    },
  },
  async run({ args }) {
    let root: string;
    try {
      root = resolveProjectRoot();
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    }

    const paths = makePaths(root);

    let outArg: string | undefined;
    try {
      outArg = (await import("../../out-path.js")).resolveOutPath(
        typeof args["out"] === "string" ? args["out"] : undefined,
        paths.root,
      );
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
    const safeMode = args["safe"] === true;
    const themeArg =
      typeof args["theme"] === "string" && args["theme"]
        ? nodePath.resolve(process.cwd(), args["theme"])
        : undefined;

    // Lazy-load the PDF export module
    const t0 = Date.now();
    const { exportPdf } = loadPdfModule();
    if (process.env["LOGBOOK_DEBUG"] === "1") {
      process.stderr.write(
        `export pdf: lazy-loaded pdf module in ${Date.now() - t0}ms\n`
      );
    }

    const exportOpts: ExportPdfOptions = {
      paths,
      safe: safeMode,
      ...(outArg !== undefined && { outFile: outArg }),
      ...(themeArg !== undefined && { themePath: themeArg }),
    };

    let report: Awaited<ReturnType<typeof exportPdf>>;
    try {
      report = await exportPdf(exportOpts);
    } catch (err) {
      process.stderr.write(
        `error: PDF export failed — ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    }

    if (args["json"]) {
      process.stdout.write(JSON.stringify(report) + "\n");
      process.exit(0);
    }

    // Human-readable output
    process.stdout.write(`Exported PDF:\n`);
    process.stdout.write(`  File:          ${report.outFile}\n`);
    process.stdout.write(`  Size:          ${report.bytes} bytes\n`);
    process.stdout.write(`  Duration:      ${report.durationMs}ms\n`);
    process.exit(0);
  },
});

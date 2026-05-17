/**
 * logbook export html — Export to self-contained HTML (T12/T4).
 *
 * Reads the 3 generated docs from logbook/docs/, converts to HTML with
 * inlined CSS, writes to logbook/exports/index.html (or --out path).
 *
 * Design §3 CLI command signatures — export html row.
 * Hard contract: externalRefs must be 0 (enforced by sanitize-links).
 *
 * T4 (MONITOR-2): the exportHtml function is loaded via a runtime require()
 * on a non-literal path so that esbuild/tsup cannot inline the
 * unified/remark/rehype chain into the CLI cold-start bundle
 * (dist/cli/index.cjs). The heavy deps live only in dist/export/html.cjs
 * and are loaded on demand when this command actually runs.
 */

import { defineCommand } from "citty";
import { join } from "node:path";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import * as nodePath from "node:path";
import type { exportHtml as ExportHtmlFn, ExportOptions } from "../../../export/html.js";

/**
 * Load the export module at runtime via a non-literal require() path.
 * esbuild cannot statically resolve a path.join(__dirname, ...) argument,
 * so it leaves the require() as a runtime call — preventing the
 * unified/remark/rehype tree from being inlined into dist/cli/index.cjs.
 *
 * The export bundle (dist/export/html.cjs) is built by the 4th tsup entry
 * and lives adjacent to the CLI bundle under dist/.
 */
function loadExportModule(): { exportHtml: typeof ExportHtmlFn } {
  // Non-literal path — esbuild cannot resolve at bundle time.
  // __dirname in CJS bundle resolves to dist/cli/ at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(join(__dirname, "../export/html.cjs")) as {
    exportHtml: typeof ExportHtmlFn;
  };
}

export default defineCommand({
  meta: {
    name: "html",
    description: "Export to self-contained HTML (no external refs)",
  },
  args: {
    out: {
      type: "string",
      required: false,
      description: "Output path (default: logbook/exports/index.html)",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit ExportReport as JSON",
    },
    safe: {
      type: "boolean",
      default: false,
      description: "Redact paths, usernames, and emails before export",
    },
    theme: {
      type: "string",
      required: false,
      description: "Path to a custom CSS theme file (replaces default styles)",
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
    const outArg =
      typeof args["out"] === "string" && args["out"]
        ? args["out"]
        : undefined;

    // Lazy-load the export module — non-literal require() path means esbuild
    // skips inlining; the heavy unified/remark/rehype chain stays in
    // dist/export/html.cjs and is loaded only when this command runs.
    const t0 = Date.now();
    const { exportHtml } = loadExportModule();
    if (process.env["LOGBOOK_DEBUG"] === "1") {
      process.stderr.write(
        `export: lazy-loaded export module in ${Date.now() - t0}ms\n`
      );
    }

    const safeMode = args["safe"] === true;
    const themeArg =
      typeof args["theme"] === "string" && args["theme"]
        ? nodePath.resolve(process.cwd(), args["theme"])
        : undefined;

    const exportOpts: ExportOptions = {
      paths,
      safe: safeMode,
      ...(outArg !== undefined && { outFile: outArg }),
      ...(themeArg !== undefined && { themePath: themeArg }),
    };

    let report: Awaited<ReturnType<typeof exportHtml>>;
    try {
      report = await exportHtml(exportOpts);
    } catch (err) {
      process.stderr.write(
        `error: export failed — ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    }

    if (args["json"]) {
      process.stdout.write(JSON.stringify(report) + "\n");
      process.exit(0);
    }

    // Human-readable output
    process.stdout.write(`Exported HTML:\n`);
    process.stdout.write(`  File:          ${report.outFile}\n`);
    process.stdout.write(`  Size:          ${report.bytes} bytes\n`);
    process.stdout.write(`  External refs: ${report.externalRefs}\n`);
    process.stdout.write(`  Duration:      ${report.durationMs}ms\n`);
    process.exit(0);
  },
});

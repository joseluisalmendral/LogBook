/**
 * logbook export html — Export to self-contained HTML (T12).
 *
 * Reads the 3 generated docs from logbook/docs/, converts to HTML with
 * inlined CSS, writes to logbook/exports/index.html (or --out path).
 *
 * Design §3 CLI command signatures — export html row.
 * Hard contract: externalRefs must be 0 (enforced by sanitize-links).
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import { exportHtml } from "../../../export/html.js";

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

    let report: Awaited<ReturnType<typeof exportHtml>>;
    try {
      const exportOpts = outArg !== undefined
        ? { paths, outFile: outArg }
        : { paths };
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

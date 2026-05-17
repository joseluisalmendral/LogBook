/**
 * logbook export instructor-pack — Bundle docs + ADRs + teaching scripts
 * into a single self-contained HTML file (iter5).
 *
 * Uses the same lazy-load pattern as export/html.ts:
 * the heavy unified/remark/rehype chain stays in dist/export/html.cjs and
 * is only loaded when this subcommand actually runs (non-literal require path
 * prevents esbuild from inlining it into the CLI cold-start bundle).
 *
 * Design: spec §10 CLI signature — `logbook export instructor-pack [--safe]`.
 */

import { defineCommand } from "citty";
import { join } from "node:path";
import * as nodePath from "node:path";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import type {
  exportInstructorPack as ExportInstructorPackFn,
  InstructorPackOptions,
} from "../../../export/instructor-pack.js";

/**
 * Lazy-load the export module at runtime via a non-literal require() path.
 * __dirname in the CJS bundle resolves to dist/cli/ at runtime.
 * The export bundle lives at dist/export/html.cjs (entry: src/export/index.ts).
 */
function loadExportModule(): {
  exportInstructorPack: typeof ExportInstructorPackFn;
} {
  // Non-literal path — esbuild cannot resolve at bundle time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(join(__dirname, "../export/html.cjs")) as {
    exportInstructorPack: typeof ExportInstructorPackFn;
  };
}

export default defineCommand({
  meta: {
    name: "instructor-pack",
    description:
      "Bundle docs + ADRs + teaching scripts into a single self-contained HTML",
  },
  args: {
    out: {
      type: "string",
      required: false,
      description:
        "Output path (default: logbook/exports/instructor-pack.html)",
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

    // Lazy-load the export module.
    const t0 = Date.now();
    const { exportInstructorPack } = loadExportModule();
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

    const exportOpts: InstructorPackOptions = {
      paths,
      safe: safeMode,
      ...(outArg !== undefined && { outFile: outArg }),
      ...(themeArg !== undefined && { themePath: themeArg }),
    };

    let report: Awaited<ReturnType<typeof exportInstructorPack>>;
    try {
      report = await exportInstructorPack(exportOpts);
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
    process.stdout.write(`Exported Instructor Pack:\n`);
    process.stdout.write(`  File:          ${report.outFile}\n`);
    process.stdout.write(`  Size:          ${report.bytes} bytes\n`);
    process.stdout.write(`  External refs: ${report.externalRefs}\n`);
    process.stdout.write(`  Duration:      ${report.durationMs}ms\n`);
    process.exit(0);
  },
});

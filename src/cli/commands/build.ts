/**
 * logbook build — Generate logbook/docs/* from event JSONL (T11).
 *
 * Runs all 3 deterministic generators (index, timeline, errors-and-lessons).
 * Reads events from JSONL (primary source — SQLite is not used).
 *
 * Design §3 CLI command signatures — build row.
 * Design §7 document generation strategy.
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { runAllGenerators } from "../../generate/index.js";

export default defineCommand({
  meta: {
    name: "build",
    description: "Generate logbook/docs/* from event JSONL",
  },
  args: {
    out: {
      type: "string",
      required: false,
      description: "Output directory (default: logbook/docs)",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit BuildReport as JSON",
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
    const outArg = typeof args["out"] === "string" && args["out"]
      ? args["out"]
      : undefined;

    let report: Awaited<ReturnType<typeof runAllGenerators>>;
    try {
      const genOpts = outArg !== undefined
        ? { paths, outDir: outArg }
        : { paths };
      report = await runAllGenerators(genOpts);
    } catch (err) {
      process.stderr.write(
        `error: build failed — ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    }

    if (args["json"]) {
      process.stdout.write(JSON.stringify(report) + "\n");
      process.exit(0);
    }

    // Human-readable table output
    process.stdout.write("Generated docs:\n");
    for (const entry of report.generated) {
      process.stdout.write(
        `  ${entry.file} (${entry.bytes} bytes, sha256: ${entry.sha256.slice(0, 12)}...)\n`
      );
    }
    process.stdout.write(`Duration: ${report.durationMs}ms\n`);
    process.exit(0);
  },
});

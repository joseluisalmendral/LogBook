/**
 * generate/index.ts — Barrel and runAllGenerators orchestrator (T11).
 *
 * Exports:
 *  - readContext (from render-context)
 *  - upsertGeneratedBlock (from blocks)
 *  - runAllGenerators(opts) — runs all 3 deterministic generators
 *
 * BuildReport is defined in src/types/reports.ts.
 */

export { readContext } from "./render-context.js";
export type { RenderContext, RenderEvent } from "./render-context.js";
export { upsertGeneratedBlock } from "./blocks.js";

import { createHash } from "node:crypto";
import { join } from "pathe";
import * as fsSync from "node:fs";
import { buildIndexDoc } from "./index-doc.js";
import { buildTimelineDoc } from "./timeline-doc.js";
import { buildErrorsDoc } from "./errors-doc.js";
import { readContext } from "./render-context.js";
import { upsertGeneratedBlock } from "./blocks.js";
import type { ProjectPaths } from "../core/paths.js";
import type { BuildReport } from "../types/reports.js";

export type { BuildReport };

interface GeneratorSpec {
  filename: string;
  markerName: string;
  build: (ctx: Awaited<ReturnType<typeof readContext>>) => string;
}

const GENERATORS: GeneratorSpec[] = [
  {
    filename: "index.md",
    markerName: "logbook:doc:index",
    build: buildIndexDoc,
  },
  {
    filename: "timeline.md",
    markerName: "logbook:doc:timeline",
    build: buildTimelineDoc,
  },
  {
    filename: "errors-and-lessons.md",
    markerName: "logbook:doc:errors",
    build: buildErrorsDoc,
  },
];

/**
 * Run all 3 generators and upsert their output into logbook/docs/*.
 *
 * @param opts.paths  Project paths (from makePaths).
 * @param opts.outDir Output directory (default: <paths.dataDir>/docs).
 */
export async function runAllGenerators(opts: {
  paths: ProjectPaths;
  outDir?: string;
}): Promise<BuildReport> {
  const startMs = Date.now();
  const outDir = opts.outDir ?? join(opts.paths.dataDir, "docs");

  // Read context once — shared by all generators
  const ctx = await readContext(opts.paths);

  const generated: BuildReport["generated"] = [];
  const preserved: string[] = [];

  for (const spec of GENERATORS) {
    const file = join(outDir, spec.filename);
    const body = spec.build(ctx);

    const { written } = await upsertGeneratedBlock({
      file,
      markerName: spec.markerName,
      markerVersion: 1,
      body,
    });

    // Read back the final file for byte count and sha256
    const finalContent = fsSync.readFileSync(file, "utf8");
    const bytes = Buffer.byteLength(finalContent, "utf8");
    const sha256 = createHash("sha256").update(finalContent, "utf8").digest("hex");

    generated.push({ file, bytes, sha256 });

    if (!written) {
      preserved.push(file);
    }
  }

  return {
    generated,
    preserved,
    durationMs: Date.now() - startMs,
  };
}

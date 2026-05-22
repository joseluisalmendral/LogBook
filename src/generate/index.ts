/**
 * generate/index.ts — Barrel and runAllGenerators orchestrator (T11).
 *
 * Exports:
 *  - readContext (from render-context)
 *  - upsertGeneratedBlock (from blocks)
 *  - runAllGenerators(opts) — runs all 9 deterministic generators
 *
 * BuildReport is defined in src/types/reports.ts.
 *
 * export-rich-interactive slice: 5 new generators wired (ADR-22).
 * remoteUrl resolved once via getRemoteUrl() (ADR-21).
 */

export { readContext } from "./render-context.js";
export type { RenderContext, RenderEvent } from "./render-context.js";
export { upsertGeneratedBlock } from "./blocks.js";
export { generateTeachingScript } from "./teaching-script-doc.js";
export type { TeachingScriptInput, TeachingScriptResult } from "./teaching-script-doc.js";

import { createHash } from "node:crypto";
import { join } from "pathe";
import * as fsSync from "node:fs";
import { buildIndexDoc } from "./index-doc.js";
import { buildTimelineDoc } from "./timeline-doc.js";
import { buildErrorsDoc } from "./errors-doc.js";
import { buildCommitsDoc } from "./commits-doc.js";
import { buildSessionsDoc } from "./sessions-doc.js";
import { buildDashboardDoc } from "./dashboard-doc.js";
import { buildDecisionsDoc } from "./decisions-doc.js";
import { buildResourcesDoc } from "./resources-doc.js";
import { buildMilestonesDoc } from "./milestones-doc.js";
import { readContext } from "./render-context.js";
import { upsertGeneratedBlock } from "./blocks.js";
import { sanitizeForSafeExport } from "../export/safe.js";
import { readState } from "../core/state.js";
import { getRemoteUrl } from "../connectors/git.js";
import type { ProjectPaths } from "../core/paths.js";
import type { BuildReport } from "../types/reports.js";

export type { BuildReport };

interface GeneratorSpec {
  filename: string;
  markerName: string;
  build: (ctx: Awaited<ReturnType<typeof readContext>>, extra?: unknown) => string;
}

function makeGenerators(remoteUrl: string | undefined): GeneratorSpec[] {
  return [
    // Existing generators
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
    {
      filename: "commits.md",
      markerName: "logbook:doc:commits",
      build: (ctx) => buildCommitsDoc(ctx, remoteUrl),
    },
    // New generators — export-rich-interactive slice (ADR-22)
    {
      filename: "sessions.md",
      markerName: "logbook:doc:sessions",
      build: buildSessionsDoc,
    },
    {
      filename: "dashboard.md",
      markerName: "logbook:doc:dashboard",
      build: buildDashboardDoc,
    },
    {
      filename: "decisions.md",
      markerName: "logbook:doc:decisions",
      build: buildDecisionsDoc,
    },
    {
      filename: "resources.md",
      markerName: "logbook:doc:resources",
      build: buildResourcesDoc,
    },
    {
      filename: "milestones.md",
      markerName: "logbook:doc:milestones",
      build: buildMilestonesDoc,
    },
  ];
}

/**
 * Run all generators (index, timeline, errors, commits) and upsert their
 * output into logbook/docs/*.
 *
 * @param opts.paths    Project paths (from makePaths).
 * @param opts.outDir   Output directory (default: <paths.dataDir>/docs).
 * @param opts.safe     When true, run sanitizeForSafeExport on each generated body
 *                      before upserting into the block marker. Default: false.
 * @param opts.remoteUrl Override remote URL for commits.md link generation.
 *                      When not provided, the cached remoteUrl from state.json
 *                      is used (set via the `logbook start` or future commands).
 *                      Falls back to undefined (plain SHA, no links).
 */
export async function runAllGenerators(opts: {
  paths: ProjectPaths;
  outDir?: string;
  safe?: boolean;
  remoteUrl?: string;
}): Promise<BuildReport> {
  const startMs = Date.now();
  const outDir = opts.outDir ?? join(opts.paths.dataDir, "docs");

  // Read context once — shared by all generators
  const ctx = await readContext(opts.paths);

  // Resolve remoteUrl: prefer explicit override, then getRemoteUrl() (ADR-21).
  // getRemoteUrl() reads git origin once per build; result is used by commits-doc
  // to generate clickable SHA links for allowlisted hosts (github/gitlab/bitbucket).
  let remoteUrl = opts.remoteUrl;
  if (remoteUrl === undefined) {
    try {
      const state = readState(opts.paths.statePath);
      // remoteUrl is not in state yet — use undefined as fallback.
      // State only has gitSha for now; a future slice may cache remoteUrl.
      void state; // acknowledged: no remoteUrl in state yet
    } catch {
      // ignore
    }
  }
  if (remoteUrl === undefined) {
    try {
      remoteUrl = await getRemoteUrl(opts.paths.root);
    } catch {
      // Non-fatal: getRemoteUrl returns undefined on failure; commits-doc falls
      // back to plain SHA text when remoteUrl is undefined.
    }
  }

  const generators = makeGenerators(remoteUrl);

  const generated: BuildReport["generated"] = [];
  const preserved: string[] = [];

  for (const spec of generators) {
    const file = join(outDir, spec.filename);
    let body = spec.build(ctx);

    // Safe-export pass: redact before block upsert.
    if (opts.safe) {
      body = sanitizeForSafeExport(body);
    }

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

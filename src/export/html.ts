/**
 * HTML export pipeline (export-replan P5 — gutted per R-41).
 *
 * Algorithm (≤ 80 LoC body):
 *   1. readContext(paths) — load all docs/events/sessions into a RenderContext.
 *   2. buildExportPayload(ctx, paths) — produce the ExportPayloadV2 + sidecar
 *      decision (5 MB cap detection per R-14 / INV-12).
 *   3. Mermaid pre-render: scan events for mermaid sources and pre-render to
 *      sanitized SVG via existing src/export/mermaid.ts (R-15, AG-13).
 *   4. Sidecar emission: if payload.oversize, write <name>.events.jsonl and
 *      flag the payload so <CourseShell> renders the "Large project" banner.
 *   5. Inject the JSON payload into the vendored <script id="lb-data"> tag
 *      of UI_BUNDLE. The </script> sequence is escaped per R-43.
 *   6. assertNoExternalRefs gate — throws if any non-allowlisted external ref
 *      slipped through. Extended in sanitize-links.ts for data: + svelte.dev/e/*.
 *   7. Atomic write (temp file + rename) so a crash never leaves a half file.
 *
 * Spec: R-5, R-41, R-42, R-43, R-44, R-45, INV-2, INV-3, INV-12, S-13.
 */

import { writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "pathe";
import { UI_BUNDLE } from "./ui-bundle.js";
import { assertNoExternalRefs } from "./sanitize-links.js";
import { buildExportPayload } from "../generate/build-export-payload.js";
import { readContext } from "../generate/render-context.js";
import { preprocessMermaidPlaceholders } from "./mermaid.js";
import { getRemoteUrl } from "../connectors/git.js";
import type { ProjectPaths } from "../core/paths.js";
import type { ExportReport } from "../types/reports.js";

export interface ExportOptions {
  paths: ProjectPaths;
  /** Output path. Default: <projectRoot>/logbook/exports/index.html */
  outFile?: string;
  /** Reserved for parity with the legacy API. Currently unused by the new shell. */
  safe?: boolean;
  /** Reserved for parity with the legacy API. Currently unused — the UI ships its own tokens. */
  themePath?: string;
  /** Reserved for parity with the legacy API. Currently unused. */
  speakerMode?: boolean;
}

/** Placeholder script tag inside the vendored UI bundle that receives the payload. */
const LB_DATA_TAG_RE = /<script id="lb-data" type="application\/json">[\s\S]*?<\/script>/;

/**
 * Escape `</script>` sequences inside a JSON string so the payload cannot
 * break out of the surrounding <script> tag. Per R-43, the only safe way to
 * inject JSON into a script tag is to escape the closing-tag forward slash.
 * Browsers parse `<\/script>` as the seven characters, NOT as a script end.
 */
function escapeJsonForScriptTag(json: string): string {
  return json.replace(/<\/script/gi, "<\\/script");
}

/**
 * Pre-render mermaid diagrams found in event bodies. Mutates the payload's
 * mermaid map. We reuse the existing preprocessMermaidPlaceholders engine
 * (transparent background, ADR-D6 themed) — it returns the SVG array; we key
 * each SVG by `evtId-N` so the UI can look it up via the same convention used
 * by the body sanitizer.
 *
 * Best-effort: if mmdc is unavailable, leave the map empty rather than abort.
 */
async function attachMermaidSvgs(
  payload: { mermaid: Record<string, string>; bodies: Record<string, string> },
): Promise<void> {
  for (const [eventId, body] of Object.entries(payload.bodies)) {
    if (!body.includes("```mermaid")) continue;
    try {
      const { svgs } = await preprocessMermaidPlaceholders(body);
      svgs.forEach((svg, i) => {
        payload.mermaid[`${eventId}-${i}`] = svg;
      });
    } catch {
      // silent best-effort — UI shows the empty diagram fallback
    }
  }
}

export async function exportHtml(opts: ExportOptions): Promise<ExportReport> {
  const start = Date.now();
  const { paths } = opts;

  const outFile =
    opts.outFile ?? join(paths.dataDir, "exports", "index.html");

  // 1-2. Load context + build payload (also detects 5 MB cap).
  const ctx = await readContext(paths);

  // Slice-12 P3 (R-60 / ADR-SC-C1): resolve remoteUrl ONCE per export so the
  // payload builder can populate `commit.payload.commitUrl` for github /
  // gitlab / bitbucket. If git is unavailable or no origin is configured the
  // call returns undefined; commit links degrade to plain SHA in the UI.
  let remoteUrl: string | undefined;
  try {
    remoteUrl = await getRemoteUrl(paths.root);
  } catch {
    // Non-fatal: missing remote is normal for fresh repos.
  }

  const { payload, oversize } = await buildExportPayload(ctx, paths, {
    remoteUrl,
  });

  // 3. Pre-render mermaid diagrams (best-effort).
  await attachMermaidSvgs(payload);

  // 4. Sidecar emission for oversize payloads (R-14, INV-12, S-12).
  let sidecarPath: string | null = null;
  if (oversize) {
    sidecarPath = outFile.replace(/\.html$/, ".events.jsonl");
    const jsonl = ctx.all.map((e) => JSON.stringify(e)).join("\n");
    await mkdir(dirname(sidecarPath), { recursive: true });
    await writeFile(sidecarPath, jsonl, "utf8");
    (payload as unknown as Record<string, unknown>)["sidecar"] = {
      path: sidecarPath.split("/").pop(),
      bytes: Buffer.byteLength(jsonl, "utf8"),
    };
  }

  // 5. Inject the payload into the vendored bundle (R-43 </script> escape).
  const jsonPayload = escapeJsonForScriptTag(JSON.stringify(payload));
  const injected = `<script id="lb-data" type="application/json">${jsonPayload}</script>`;
  const html = UI_BUNDLE.replace(LB_DATA_TAG_RE, injected);

  if (html === UI_BUNDLE) {
    throw new Error(
      "exportHtml: UI bundle is missing the <script id=\"lb-data\"> placeholder. " +
        "Re-run `pnpm sync:export-ui` after a fresh `pnpm --filter export-ui build`.",
    );
  }

  // 6. Final gate — throws on any external ref outside the allowlist.
  const sanitizeResult = assertNoExternalRefs(html);

  // 7. Atomic write (temp file + rename).
  const outDir = dirname(outFile);
  await mkdir(outDir, { recursive: true });
  const tmpFile = `${outFile}.tmp`;
  await writeFile(tmpFile, html, "utf8");
  await rename(tmpFile, outFile);

  const bytes = Buffer.byteLength(html, "utf8");
  return {
    outFile,
    bytes,
    externalRefs: sanitizeResult.externalRefs,
    allowedRefs: sanitizeResult.allowedRefs,
    durationMs: Date.now() - start,
  };
}

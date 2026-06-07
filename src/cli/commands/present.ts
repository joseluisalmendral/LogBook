/**
 * logbook present — single-shot, repo-untouched HTML presentation builder.
 *
 * Use case: showing already-executed Claude Code conversations as a
 * self-contained HTML page in class. It replaces the manual
 * `init + build + export` flow for the DISPLAY-ONLY scenario.
 *
 * Contract:
 *   - Scrapes the project's Claude Code transcripts, builds the export HTML,
 *     and writes it in ONE command.
 *   - Writes NOTHING into the project repo except `<out>/<name>/index.html`.
 *     Specifically it MUST NOT create or mutate logbook/evidence/events.jsonl,
 *     .logbook/state.json, logbook/docs/*, or logbook/exports/.
 *   - All intermediate scrape/event/state data is EPHEMERAL: it lands in a
 *     temp dir under os.tmpdir() that is deleted in a finally block.
 *
 * Strategy (A — ephemeral temp workspace):
 *   The transcript scraper resolves ~/.claude/projects/<encoded>/... from
 *   `paths.root`, but writes events to `paths.eventsJsonl` and cursors to
 *   `paths.statePath`. We build a ProjectPaths whose `root` stays the REAL
 *   project root (so transcripts resolve correctly) while every WRITE-bearing
 *   path (evidenceDir, eventsJsonl, statePath, dataDir, logbookDir, ...) is
 *   redirected into the temp workspace. The same backfill loop and the same
 *   `exportHtml` pipeline run unchanged against that workspace; only the final
 *   HTML is written to the user-chosen output folder.
 *
 * Reuses existing code paths verbatim — no shared function is mutated.
 */

import { defineCommand } from "citty";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { resolveProjectRoot, makePaths, type ProjectPaths } from "../../core/paths.js";
import {
  runTranscriptScraper,
  pathToEncoded,
} from "../../connectors/claude-code/transcript.js";
import type { exportHtml as ExportHtmlFn } from "../../export/html.js";

/**
 * Load the export module at runtime via a non-literal require() path.
 *
 * Identical pattern to src/cli/commands/export/html.ts:loadExportModule().
 * The whole CLI is bundled into dist/cli/index.cjs, so __dirname resolves to
 * dist/cli/ at runtime and dist/export/html.cjs is a sibling under dist/.
 * The non-literal join() argument prevents esbuild from inlining the heavy
 * unified/remark/rehype chain into the CLI cold-start bundle.
 */
function loadExportModule(): { exportHtml: typeof ExportHtmlFn } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(join(__dirname, "../export/html.cjs")) as {
    exportHtml: typeof ExportHtmlFn;
  };
}

/**
 * Build a ProjectPaths whose `root` is the REAL project root (transcript reads
 * depend on it) but whose every write-bearing path is redirected under
 * `workspace`. This is the linchpin of the ephemeral strategy: the scraper and
 * the export pipeline are unchanged, yet none of their writes can reach the
 * real repo.
 */
function makeEphemeralPaths(realRoot: string, workspace: string): ProjectPaths {
  // makePaths derives all sub-paths from a single root. Deriving from the
  // workspace gives us a fully self-contained, throwaway path set...
  const ws = makePaths(workspace);
  // ...except `root`, which MUST stay the real project root so the transcript
  // scraper computes the correct ~/.claude/projects/<encoded> directory.
  return { ...ws, root: realRoot };
}

export default defineCommand({
  meta: {
    name: "present",
    description:
      "Build a self-contained HTML presentation from transcripts without touching the repo",
  },
  args: {
    name: {
      type: "positional",
      required: false,
      description:
        "Identifier for the output folder (produces <out>/<name>/index.html). " +
        "Defaults to the source directory name.",
    },
    out: {
      type: "string",
      required: false,
      description: "Parent directory for the <name>/ folder (default: project root)",
    },
    safe: {
      type: "boolean",
      default: false,
      description: "Redact paths, usernames, and emails before export",
    },
    "no-transcripts": {
      type: "boolean",
      default: false,
      description: "Skip embedding raw Claude Code transcripts",
    },
  },
  async run({ args }) {
    let realRoot: string;
    try {
      realRoot = resolveProjectRoot();
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // <name> is OPTIONAL — default to the source directory's basename so the
    // output folder + presentation title are immediately recognizable
    // (e.g. "tendr-landing"). The path-traversal guard below still applies.
    const explicitName = typeof args["name"] === "string" ? args["name"].trim() : "";
    const name = explicitName || path.basename(realRoot);
    if (!name) {
      process.stderr.write("error: could not derive a presentation name\n");
      process.exit(1);
    }
    // Guard against path traversal / nested folders in the name argument.
    if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      process.stderr.write(
        `error: <name> must be a single folder segment (got "${name}")\n`,
      );
      process.exit(1);
    }

    // Parent output dir: explicit --out (absolute or relative to cwd) or the
    // real project root by default. We do NOT use resolveOutPath here: the
    // whole point of `present` is to write OUTSIDE the repo on demand, and the
    // default (project root) holds only the produced folder, never logbook/*.
    const outParent =
      typeof args["out"] === "string" && args["out"]
        ? path.resolve(process.cwd(), args["out"])
        : realRoot;
    const outFile = join(outParent, name, "index.html");

    const safe = args["safe"] === true;
    const noTranscripts = args["no-transcripts"] === true;

    // `present` is an offline, one-shot command with NO latency budget (unlike
    // the Stop hook). Raise the transcript delta cap so large sessions (6-12 MB
    // transcripts) are parsed in full — otherwise their `/rename` titles, user
    // prompts, and messages are silently skipped by the hook-time 5 MB guard.
    // Honor an explicit caller override if one is already set.
    if (!process.env["LOGBOOK_MAX_DELTA_BYTES"]) {
      process.env["LOGBOOK_MAX_DELTA_BYTES"] = String(256 * 1024 * 1024);
    }

    // Ephemeral workspace under os.tmpdir() — deleted in finally.
    const workspace = await fs.mkdtemp(join(os.tmpdir(), "logbook-present-"));
    const paths = makeEphemeralPaths(realRoot, workspace);

    let cleanupError: unknown;
    try {
      // Pre-create the workspace dirs the scraper / export expect to write to.
      // - evidenceDir holds the ephemeral events.jsonl
      // - logbookDir holds the ephemeral state.json (transcript cursors)
      // - dataDir/docs satisfies the export pre-flight WITHOUT writing docs
      //   into the real repo (it only checks the directory EXISTS).
      await fs.mkdir(paths.evidenceDir, { recursive: true });
      await fs.mkdir(paths.logbookDir, { recursive: true });
      await fs.mkdir(join(paths.dataDir, "docs"), { recursive: true });

      // 1. Backfill events from every Claude Code transcript for this project.
      //    Same loop as `logbook build`, but writing into the temp workspace.
      let scrapedSessions = 0;
      let scrapedEvents = 0;
      try {
        const encoded = pathToEncoded(realRoot);
        const claudeDir = join(os.homedir(), ".claude", "projects", encoded);
        let entries: string[] = [];
        try {
          entries = await fs.readdir(claudeDir);
        } catch {
          // No Claude transcripts for this project — nothing to scrape.
        }
        for (const entry of entries) {
          if (!entry.endsWith(".jsonl")) continue;
          const sessionId = entry.slice(0, -".jsonl".length);
          if (!/^[0-9a-f-]{32,40}$/i.test(sessionId)) continue;
          try {
            const result = await runTranscriptScraper({ paths, sessionId });
            if (result.written > 0) {
              scrapedSessions++;
              scrapedEvents += result.written;
            }
          } catch {
            // Per-session failure: skip and continue.
          }
        }
      } catch {
        // Top-level safety net — never block on backfill.
      }

      if (scrapedEvents === 0) {
        process.stderr.write(
          "error: no transcript events found for this project — nothing to present.\n" +
            `       Looked under ~/.claude/projects/${pathToEncoded(realRoot)}/\n`,
        );
        process.exit(1);
      }

      // 2-3. Build the self-contained HTML straight to the output folder.
      //      exportHtml reads events via readContext(paths) — i.e. from the
      //      ephemeral events.jsonl — and writes ONLY to outFile.
      //
      // `present`'s contract is a single self-contained index.html in the
      // output folder — nothing else. Two settings enforce that:
      //   - noTranscripts: true — never embed raw transcripts, so the payload
      //     never carries the ~100 MB of raw conversation that trips the 5 MB
      //     budget gate. This is the SAME HTML the oversize fallback already
      //     produced (it stripped transcripts too), just reached up front.
      //   - noSidecar: true — even if a large project still trips the cap on
      //     bodies/chapters alone, never write the `<name>.events.jsonl`
      //     sidecar next to the HTML. The folder must contain only index.html.
      // The `--no-transcripts` flag is now redundant for output (transcripts
      // are always off here) but kept for backward-compat / explicitness.
      void noTranscripts;
      const { exportHtml } = loadExportModule();
      const report = await exportHtml({
        paths,
        outFile,
        safe,
        noTranscripts: true,
        noSidecar: true,
        // Make the hero <h1> + tab title match the folder the user named
        // (default = source directory basename).
        projectNameOverride: name,
      });

      const absOut = path.resolve(report.outFile);
      process.stdout.write("Presentation ready:\n");
      process.stdout.write(`  File:          ${absOut}\n`);
      process.stdout.write(`  Size:          ${report.bytes} bytes\n`);
      process.stdout.write(`  External refs: ${report.externalRefs}\n`);
      process.stdout.write(
        `  Sessions:      ${scrapedSessions} (${scrapedEvents} events scraped)\n`,
      );
      process.stdout.write(`  Duration:      ${report.durationMs}ms\n`);
      process.stdout.write(
        "The project repo was left untouched — all scrape/state data was ephemeral.\n",
      );
    } catch (err) {
      process.stderr.write(
        `error: present failed — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    } finally {
      // Always remove the ephemeral workspace.
      try {
        await fs.rm(workspace, { recursive: true, force: true });
      } catch (err) {
        cleanupError = err;
      }
    }

    if (cleanupError !== undefined) {
      process.stderr.write(
        `warning: failed to clean up temp workspace ${workspace}: ` +
          `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
      );
    }
    process.exit(0);
  },
});

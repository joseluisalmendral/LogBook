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
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { runAllGenerators } from "../../generate/index.js";
import {
  runTranscriptScraper,
  pathToEncoded,
} from "../../connectors/claude-code/transcript.js";

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
    safe: {
      type: "boolean",
      default: false,
      description: "Redact absolute paths, usernames, and emails before writing docs",
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
    const safeArg = args["safe"] === true;

    // Slice-23: pre-build transcript backfill.
    //
    // Run the transcript scraper for every Claude Code session known to this
    // project BEFORE generating docs. This is a safety net for when the Stop
    // / UserPromptSubmit / PostToolUse hooks miss events (real regression:
    // Claude closed before the hook flushed → 1 user_prompt + 3 claude_messages
    // lost in a 78-line transcript). The transcript file itself is always
    // complete because Claude Code persists it before hooks fire.
    //
    // Failure-safe: any error here degrades silently — build continues with
    // whatever events.jsonl already has.
    try {
      const encoded = pathToEncoded(root);
      const claudeDir = path.join(os.homedir(), ".claude", "projects", encoded);
      let entries: string[] = [];
      try {
        entries = await fs.readdir(claudeDir);
      } catch {
        // No Claude transcripts for this project — nothing to backfill.
      }
      let backfilledSessions = 0;
      let backfilledWritten = 0;
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;
        const sessionId = entry.slice(0, -".jsonl".length);
        // Basic shape check: Claude Code session ids are UUIDs.
        if (!/^[0-9a-f-]{32,40}$/i.test(sessionId)) continue;
        try {
          const result = await runTranscriptScraper({ paths, sessionId });
          if (result.written > 0) {
            backfilledSessions++;
            backfilledWritten += result.written;
          }
        } catch {
          // Per-session failure: skip and continue.
        }
      }
      if (backfilledWritten > 0) {
        process.stdout.write(
          `Backfilled ${backfilledWritten} events from transcripts across ${backfilledSessions} sessions.\n`,
        );
      }
    } catch {
      // Top-level safety net — never block build on backfill.
    }

    let report: Awaited<ReturnType<typeof runAllGenerators>>;
    try {
      const genOpts = outArg !== undefined
        ? { paths, outDir: outArg, safe: safeArg }
        : { paths, safe: safeArg };
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

/**
 * logbook decision — Record an architectural decision (writes ADR file).
 *
 * Side effects:
 *  1. Calls writeAdrFile() (T9) which atomically increments state.adrCounter
 *     under proper-lockfile and writes logbook/decisions/NNNN-<slug>.md.
 *  2. Appends a `user_entry` event (entryType: "decision") to events.jsonl via
 *     appendEvent — redaction is automatic at the chokepoint.
 *  3. Best-effort SQLite row in the `decisions` table.
 *  4. Prints JSON: { id, counter, adrPath }.
 *
 * Design §3 CLI command signatures — decision row.
 */

import * as nodePath from "node:path";
import * as fs from "node:fs";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState } from "../../core/state.js";
import { appendEvent } from "../../store/index.js";
import { openIndex, closeIndex } from "../../store/sqlite.js";
import { generateUlid } from "../../util/ulid.js";
import { writeAdrFile } from "../../generate/adr.js";
import { getGitSha, getDiffStat, getRemoteUrl, buildCommitLink } from "../../connectors/git.js";

/** Defensive comma-split: handles empty strings, single values, whitespace. */
function splitComma(s: string | undefined): string[] {
  if (!s || !s.trim()) return [];
  return s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export default defineCommand({
  meta: {
    name: "decision",
    description: "Record an architectural decision (writes ADR file)",
  },
  args: {
    title: {
      type: "string",
      required: true,
      description: "Decision title",
    },
    status: {
      type: "string",
      required: false,
      default: "Proposed",
      description: "Decision status",
    },
    context: {
      type: "string",
      required: false,
      description: "Context for the decision",
    },
    options: {
      type: "string",
      required: false,
      description: "Comma-separated options considered",
    },
    chosen: {
      type: "string",
      required: true,
      description: "The chosen option",
    },
    consequences: {
      type: "string",
      required: false,
      description: "Consequences of the decision",
    },
    supersedes: {
      type: "string",
      required: false,
      description: "ULID of a prior decision this supersedes",
    },
    tags: {
      type: "string",
      required: false,
      description: "Comma-separated tags",
    },
    "with-diff": {
      type: "boolean",
      required: false,
      default: false,
      description: "Capture git diff stat (file list) and append to ADR as Implementation section",
    },
  },
  async run({ args }) {
    let root: string;
    try {
      root = resolveProjectRoot();
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    const paths = makePaths(root);

    // Ensure evidence directory exists.
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    const title = args["title"] as string;
    const status = (args["status"] as string | undefined) ?? "Proposed";
    const context = args["context"] as string | undefined;
    const options = args["options"] as string | undefined;
    const chosen = args["chosen"] as string;
    const consequences = args["consequences"] as string | undefined;
    const supersedes = args["supersedes"] as string | undefined;
    const tags = splitComma(args["tags"] as string | undefined);
    const withDiff = args["with-diff"] === true;

    // S2.2 — capture diff stat when --with-diff flag is set.
    let implementation: import("../../generate/adr.js").AdrImplementation | undefined;
    if (withDiff) {
      const [sha, diffStats, remoteUrl] = await Promise.all([
        getGitSha(root).catch(() => undefined),
        getDiffStat(root).catch(() => undefined),
        getRemoteUrl(root).catch(() => undefined),
      ]);

      if (sha !== undefined && diffStats !== undefined) {
        const commitUrl = buildCommitLink(remoteUrl, sha);
        implementation = {
          sha,
          stats: diffStats,
          ...(commitUrl !== undefined && { commitUrl }),
        };
      } else {
        // Warn but do not fail — ADR is still written without implementation section.
        process.stderr.write(
          `warning: --with-diff: could not capture git diff stat (not a git repo or no commits)\n`,
        );
      }
    }

    // Build AdrInput without spreading undefined optional fields (exactOptionalPropertyTypes).
    const adrInput = {
      title,
      status,
      ...(context !== undefined && context !== "" && { context }),
      ...(chosen !== undefined && chosen !== "" && { chosen }),
      ...(consequences !== undefined &&
        consequences !== "" && { consequences }),
      ...(options !== undefined && options !== "" && { alternatives: options }),
      ...(implementation !== undefined && { implementation }),
    };

    let adrResult: Awaited<ReturnType<typeof writeAdrFile>>;
    try {
      adrResult = await writeAdrFile(paths, adrInput);
    } catch (err) {
      process.stderr.write(
        `error: failed to write ADR file — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    const id = generateUlid();
    const adrPath = nodePath.relative(root, adrResult.filepath);

    // Best-effort gitSha (v1.1 S2.3): fresh subprocess for manual commands.
    let gitSha: string | undefined;
    try {
      gitSha = await getGitSha(root);
    } catch {
      // Degrade silently — git unavailable or not a repo is fine.
    }

    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // Append via appendEvent — redaction is automatic at the chokepoint.
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId,
        payload: {
          entryType: "decision",
          title,
          status,
          chosen,
          adrCounter: adrResult.counter,
          adrPath,
          tags,
          ...(gitSha !== undefined && { gitSha }),
          ...(context !== undefined && context !== "" && { context }),
          ...(consequences !== undefined && consequences !== "" && { consequences }),
          ...(options !== undefined && options !== "" && { options }),
          ...(supersedes !== undefined && supersedes !== "" && { supersedes }),
        },
        id,
        provider: "logbook-cli",
      });
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Best-effort SQLite index row.
    let db: ReturnType<typeof openIndex> | undefined;
    try {
      db = openIndex(paths.indexDbPath);
      db.prepare(
        `INSERT INTO decisions (id, session_id, timestamp, title, status, chosen, supersedes, tags_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        sessionId || null,
        new Date().toISOString(),
        title,
        status,
        chosen,
        supersedes ?? null,
        tags.length > 0 ? JSON.stringify(tags) : null,
      );
    } catch (err) {
      process.stderr.write(
        `warning: SQLite index failed (non-fatal) — ${err instanceof Error ? err.message : String(err)}\n`,
      );
    } finally {
      if (db) closeIndex(db);
    }

    process.stdout.write(
      JSON.stringify({ id, counter: adrResult.counter, adrPath }) + "\n",
    );
    process.exit(0);
  },
});

/**
 * logbook snapshot [--note <s>] — Capture a manual snapshot event.
 *
 * Side effects:
 *  1. Best-effort git context capture (HEAD sha + dirty file count).
 *     Uses getGitSha() from src/connectors/git.ts — NO shell execution.
 *     On any failure (git not installed, not a repo) both sha and dirty
 *     are undefined; the command still exits 0.
 *  2. Appends a `user_entry` event (entryType: "snapshot") to events.jsonl via
 *     appendEvent — redaction is automatic at the chokepoint.
 *  3. Prints JSON: { sha?, dirty?, note? }.
 *
 * Design §3 CLI command signatures — snapshot row.
 */

import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readState } from "../../core/state.js";
import { appendEvent } from "../../store/index.js";
import { generateUlid } from "../../util/ulid.js";
import { getGitSha } from "../../connectors/git.js";

/**
 * Attempt to count the number of dirty (modified/untracked) files.
 * Returns undefined if git is unavailable or the directory is not a git repo.
 */
function getGitDirtyCount(cwd: string): number | undefined {
  try {
    const output = execFileSync(
      "git",
      ["status", "--porcelain"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      },
    );
    // Count non-empty lines.
    return output.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return undefined;
  }
}

export default defineCommand({
  meta: {
    name: "snapshot",
    description: "Capture a manual snapshot event",
  },
  args: {
    note: {
      type: "string",
      required: false,
      description: "Optional note describing the snapshot",
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
    const note = args["note"] as string | undefined;

    // Ensure evidence directory exists.
    fs.mkdirSync(paths.evidenceDir, { recursive: true });

    // Best-effort git context (both undefined is fine for non-git projects).
    const sha = await getGitSha(root);
    const dirty = sha !== undefined ? getGitDirtyCount(root) : undefined;

    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // Append via appendEvent — redaction is automatic at the chokepoint.
    // gitSha (v1.1 S2.3): attach the captured SHA for the commits-doc cross-index.
    try {
      await appendEvent(paths, {
        kind: "user_entry",
        sessionId,
        payload: {
          entryType: "snapshot",
          ...(sha !== undefined && { sha }),
          ...(sha !== undefined && { gitSha: sha }),
          ...(dirty !== undefined && { dirty }),
          ...(note !== undefined && note !== "" && { note }),
        },
        id: generateUlid(),
        provider: "logbook-cli",
      });
    } catch (err) {
      process.stderr.write(
        `error: failed to write event — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    // Output: include only defined fields.
    const output: Record<string, unknown> = {
      sha: sha ?? null,
      dirty: dirty ?? null,
    };
    if (note !== undefined && note !== "") output["note"] = note;

    process.stdout.write(JSON.stringify(output) + "\n");
    process.exit(0);
  },
});

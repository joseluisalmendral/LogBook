/**
 * git.ts — Build-time git utilities.
 *
 * Provides getCommitSha(): retrieves the current HEAD commit SHA
 * truncated to 7 characters. Used by the export pipeline to embed
 * a short SHA in the footer (ADR-D8, S5-R6).
 *
 * Failure contract: returns "-" on any error (git absent, not a git repo,
 * subprocess failure). This matches the p95 < 200ms hook contract — never throws.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Shell `git rev-parse HEAD`, truncate to 7 characters.
 *
 * Returns "-" on any failure:
 *  - git binary not found
 *  - not inside a git repository
 *  - subprocess timeout
 *  - any other error
 */
export async function getCommitSha(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      timeout: 3000,
      encoding: "utf8",
    });
    const sha = stdout.trim();
    if (sha.length >= 7) {
      return sha.slice(0, 7);
    }
    return sha || "-";
  } catch {
    return "-";
  }
}

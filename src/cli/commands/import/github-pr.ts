/**
 * logbook import github-pr <url> — Import claude-code-action PR runs (B2).
 *
 * Auth priority (B2-R2, B2-R3):
 *   1. gh CLI (if on PATH)
 *   2. GITHUB_TOKEN env var → REST API
 *   3. Both absent → non-zero exit with descriptive stderr
 *
 * Parses claude-code-action bot comments and persists one gh_agent_run event
 * per distinct agent run found (B2-R4). Events pass through valibot validation
 * and the redaction layer (B2-R5, INV-8).
 *
 * Output: JSON { imported: N, skipped: M } on stdout.
 */

import { execSync } from "node:child_process";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import { readState } from "../../../core/state.js";
import { appendEvent } from "../../../store/index.js";
import { GhAgentRunPayloadSchema } from "../../../events/schemas.js";
import * as v from "valibot";

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

interface ParsedPrUrl {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Parse a GitHub PR URL into its component parts.
 * Accepts: https://github.com/owner/repo/pull/N
 * Returns null if the URL is malformed (B2-R7).
 */
// Exported for unit testing (B2-R7).
export function parsePrUrl(url: string): { owner: string; repo: string; prNumber: number } | null {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, prNumber: parseInt(m[3]!, 10) };
}

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

interface GitHubComment {
  id: number;
  body: string;
  created_at: string;
  user: { login: string; type: string };
}

// ---------------------------------------------------------------------------
// Auth: gh CLI vs GITHUB_TOKEN
// ---------------------------------------------------------------------------

/**
 * Check if the gh CLI is available on PATH.
 * Exported for unit testing (B2-R2).
 */
export function isGhAvailable(): boolean {
  try {
    execSync("gh --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch PR comments using the gh CLI (primary auth path).
 * Returns raw JSON string or null on failure.
 */
function fetchCommentsViaGh(owner: string, repo: string, prNumber: number): string | null {
  try {
    const result = execSync(
      `gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`,
      { stdio: "pipe" },
    );
    return result.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Fetch PR comments using GITHUB_TOKEN REST API (fallback auth path).
 * Returns raw JSON string or null on failure.
 */
async function fetchCommentsViaToken(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`;
  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// claude-code-action comment detection
// ---------------------------------------------------------------------------

/**
 * Detect if a comment body is from claude-code-action.
 * Heuristics: bot user type, or body contains known claude-code-action markers.
 * Exported for unit testing (B2-R4).
 */
export function isClaudeCodeActionComment(comment: { user: { login: string; type?: string }; body: string }): boolean {
  const c = comment as GitHubComment;
  // Content markers from claude-code-action PR comment format — required check.
  const hasClaudeBody =
    c.body.includes("claude-code") ||
    c.body.includes("Claude Code") ||
    (c.body.includes("Claude") &&
      (c.body.includes("completed") || c.body.includes("agent run") || c.body.includes("files changed")));

  if (hasClaudeBody) return true;

  // Bot user + Claude-related login (not just any [bot]).
  if (
    (c.user.type === "Bot" || c.user.login.endsWith("[bot]")) &&
    (c.user.login.toLowerCase().includes("claude") || c.user.login.toLowerCase().includes("github-actions"))
  ) {
    return true;
  }

  return false;
}

/**
 * Extract a run ID from a claude-code-action comment.
 * Uses comment ID as stable unique identifier within the PR.
 */
function extractRunId(comment: GitHubComment, prUrl: string): string {
  // Use the GitHub comment ID for a stable, unique run identifier.
  return `gh-comment-${comment.id}`;
}

/**
 * Extract a summary from the comment body (first meaningful line).
 * Exported for unit testing (B2-R6).
 */
export function extractSummary(body: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  return first.slice(0, 500);
}

/**
 * Extract files changed count from the comment body.
 * claude-code-action often mentions file counts in its summary.
 * Exported for unit testing (B2-R6).
 * Returns 0 when no count can be extracted.
 */
export function extractFilesChanged(body: string): number {
  // Match patterns like "5 files", "changed 3 files", "N files changed".
  const m = /(\d+)\s+files?(?:\s+changed)?|changed\s+(\d+)\s+files?/i.exec(body);
  if (m) {
    return parseInt(m[1] ?? m[2] ?? "0", 10);
  }
  return 0;
}

/**
 * Extract list of changed file paths from the comment body.
 * Internal helper used by the command handler.
 */
function extractFilePaths(body: string): string[] {
  const files: string[] = [];
  // Match lines that look like file paths (heuristic).
  const fileRe = /(?:^|\s)([\w./\-]+\.\w+)(?:\s|$)/gm;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(body)) !== null) {
    const f = m[1]!;
    if (f.includes("/") || f.includes(".")) {
      files.push(f);
    }
  }
  // Deduplicate and cap.
  return [...new Set(files)].slice(0, 50);
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export default defineCommand({
  meta: {
    name: "github-pr",
    description: "Import claude-code-action runs from a GitHub PR",
  },
  args: {
    url: {
      type: "positional",
      description: "GitHub PR URL (https://github.com/owner/repo/pull/N)",
      required: true,
    },
  },
  async run({ args }) {
    const prUrl = args["url"] as string;

    // Parse PR URL (B2-R7).
    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      process.stderr.write(
        `error: malformed GitHub PR URL: "${prUrl}"\n` +
        `Expected format: https://github.com/owner/repo/pull/N\n`,
      );
      process.exit(1);
    }

    const { owner, repo, prNumber } = parsed;

    // Auth: gh CLI → GITHUB_TOKEN → error (B2-R2, B2-R3).
    const ghAvailable = isGhAvailable();
    const githubToken = process.env["GITHUB_TOKEN"];

    let commentsJson: string | null = null;

    if (ghAvailable) {
      commentsJson = fetchCommentsViaGh(owner, repo, prNumber);
    } else if (githubToken) {
      commentsJson = await fetchCommentsViaToken(owner, repo, prNumber, githubToken);
    } else {
      // B2-R2: both auth methods missing.
      process.stderr.write(
        `error: neither gh CLI nor GITHUB_TOKEN is available.\n` +
        `Install the gh CLI (https://cli.github.com) or set GITHUB_TOKEN env var.\n`,
      );
      process.exit(1);
    }

    if (commentsJson === null) {
      process.stderr.write(
        `error: failed to fetch comments for ${prUrl}\n`,
      );
      process.exit(1);
    }

    let comments: GitHubComment[];
    try {
      const raw = JSON.parse(commentsJson) as unknown;
      // gh --paginate may return an array or a concatenated-JSON result.
      comments = Array.isArray(raw) ? (raw as GitHubComment[]) : [];
    } catch {
      process.stderr.write(`error: failed to parse GitHub API response\n`);
      process.exit(1);
    }

    // Filter to claude-code-action comments (B2-R7).
    const agentComments = comments.filter(isClaudeCodeActionComment);
    if (agentComments.length === 0) {
      process.stderr.write(
        `error: no claude-code-action comments found in ${prUrl}\n`,
      );
      process.exit(1);
    }

    // Resolve project paths.
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
    const state = readState(paths.statePath);
    const sessionId = state.session ?? "";

    // Persist one gh_agent_run event per agent comment (B2-R4).
    let imported = 0;
    let skipped = 0;

    for (const comment of agentComments) {
      const runId = extractRunId(comment, prUrl);
      const runSummary = extractSummary(comment.body);
      const filesChanged = extractFilesChanged(comment.body);

      const payload = {
        entryType: "gh_agent_run" as const,
        prUrl,
        runId,
        runSummary,
        filesChanged,
        prNumber,
      };

      // B2-R5: validate with valibot before persistence (INV-7).
      let validated: v.InferOutput<typeof GhAgentRunPayloadSchema>;
      try {
        validated = v.parse(GhAgentRunPayloadSchema, payload);
      } catch {
        skipped++;
        continue;
      }

      try {
        // INV-8: appendEvent applies redaction automatically.
        await appendEvent(paths, {
          kind: "gh_agent_run",
          sessionId,
          provider: "github",
          payload: validated as Record<string, unknown>,
          timestamp: comment.created_at,
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    if (imported === 0) {
      process.stderr.write(
        `error: no valid gh_agent_run events could be imported from ${prUrl}\n`,
      );
      process.exit(1);
    }

    process.stdout.write(
      JSON.stringify({ imported, skipped }) + "\n",
    );
    process.exit(0);
  },
});

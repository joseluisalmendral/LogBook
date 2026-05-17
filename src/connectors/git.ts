/**
 * src/connectors/git.ts — Git context helpers.
 *
 * Pure, isolated subprocess helpers for git metadata.
 * All I/O is isolated in these functions; callers decide when to call
 * them (e.g., once per session in SessionStart; fresh on manual commands).
 *
 * Design §12 (v1.1 S2.3):
 *   - getGitSha: resolves current HEAD SHA (40-char hex) or undefined.
 *   - getRemoteUrl: resolves origin remote URL or undefined.
 *   - buildCommitLink: pure function — builds a commit URL from remote+sha
 *     for github.com, gitlab.com, bitbucket.org; returns undefined otherwise.
 *
 * All subprocess calls use execFileSync with explicit args-as-array —
 * NO shell execution, NO glob expansion. Timeout 5s. stdin ignored.
 *
 * Caching strategy: no internal cache — callers manage caching via
 * state.json (gitSha + gitShaCapturedAt fields). SessionStart captures
 * once; subsequent hook events read from cached state.
 */

import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Execute a git command and return trimmed stdout.
 * Returns undefined on any failure (git not installed, not a repo, etc.).
 */
function runGit(args: string[], cwd: string): string | undefined {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    const trimmed = typeof output === "string" ? output.trim() : "";
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current git HEAD SHA (40-char hex).
 * Returns undefined if git is unavailable or cwd is not inside a repo.
 */
export async function getGitSha(cwd: string): Promise<string | undefined> {
  return runGit(["rev-parse", "HEAD"], cwd);
}

/**
 * Get the URL of the 'origin' remote.
 * Returns undefined if git is unavailable, not a repo, or no remote configured.
 */
export async function getRemoteUrl(cwd: string): Promise<string | undefined> {
  return runGit(["remote", "get-url", "origin"], cwd);
}

// ---------------------------------------------------------------------------
// buildCommitLink
// ---------------------------------------------------------------------------

/**
 * Pattern table for known git hosting providers.
 *
 * Each entry has:
 *   - hostPattern: regex to match the hostname in an HTTPS or SSH remote URL.
 *   - extractPath: function that returns the "org/repo" portion from the remote.
 *   - commitPath: function that builds the provider-specific commit path.
 */
interface HostEntry {
  hostPattern: RegExp;
  commitPath: (orgRepo: string, sha: string) => string;
}

/** Strip .git suffix from a repository name component. */
function stripGitSuffix(s: string): string {
  return s.endsWith(".git") ? s.slice(0, -4) : s;
}

/**
 * Extract "org/repo" from an HTTPS or SSH git remote URL.
 *
 * Handles:
 *   - HTTPS: https://github.com/org/repo.git
 *   - SSH:   git@github.com:org/repo.git
 *
 * Returns undefined if the URL cannot be parsed.
 */
function extractOrgRepo(remote: string): string | undefined {
  // HTTPS form: https://host/org/repo[.git]
  const httpsMatch = /^https?:\/\/[^/]+\/(.+\/[^/]+)$/.exec(remote);
  if (httpsMatch) {
    const [, path] = httpsMatch;
    return path !== undefined ? stripGitSuffix(path) : undefined;
  }

  // SSH form: git@host:org/repo[.git]
  const sshMatch = /^git@[^:]+:(.+\/[^/]+)$/.exec(remote);
  if (sshMatch) {
    const [, path] = sshMatch;
    return path !== undefined ? stripGitSuffix(path) : undefined;
  }

  return undefined;
}

const HOST_ENTRIES: HostEntry[] = [
  {
    // github.com — HTTPS and SSH
    hostPattern: /github\.com/,
    commitPath: (orgRepo, sha) =>
      `https://github.com/${orgRepo}/commit/${sha}`,
  },
  {
    // gitlab.com — HTTPS and SSH
    hostPattern: /gitlab\.com/,
    commitPath: (orgRepo, sha) =>
      `https://gitlab.com/${orgRepo}/-/commit/${sha}`,
  },
  {
    // bitbucket.org — HTTPS and SSH
    hostPattern: /bitbucket\.org/,
    commitPath: (orgRepo, sha) =>
      `https://bitbucket.org/${orgRepo}/commits/${sha}`,
  },
];

/**
 * Build a web URL pointing to a specific commit, given the remote URL and SHA.
 *
 * Detects github.com, gitlab.com, bitbucket.org from the remote URL (both
 * HTTPS and SSH forms). Returns undefined for unknown hosts or unparseable URLs.
 *
 * @param remote - The git remote URL (e.g. from getRemoteUrl), or undefined.
 * @param sha    - The full 40-char git SHA.
 */
export function buildCommitLink(
  remote: string | undefined,
  sha: string,
): string | undefined {
  if (!remote) return undefined;

  const orgRepo = extractOrgRepo(remote);
  if (!orgRepo) return undefined;

  for (const entry of HOST_ENTRIES) {
    if (entry.hostPattern.test(remote)) {
      return entry.commitPath(orgRepo, sha);
    }
  }

  return undefined;
}

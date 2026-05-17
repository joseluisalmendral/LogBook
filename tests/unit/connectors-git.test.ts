/**
 * connectors-git.test.ts — Unit tests for src/connectors/git.ts
 *
 * RED phase: all tests fail because src/connectors/git.ts does not exist yet.
 *
 * Strategy:
 *   - getGitSha / getRemoteUrl are I/O functions — tested by mocking execFileSync.
 *   - buildCommitLink is a pure function — tested directly with known inputs.
 *   - Caching is done at the CALLER level (state.json), not inside getGitSha.
 *     So git.ts itself is always "live" (no internal cache to test).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as childProcess from "node:child_process";

// We mock the entire child_process module so execFileSync is intercepted.
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

// Import AFTER mocking so the module picks up the mock.
import {
  getGitSha,
  getRemoteUrl,
  buildCommitLink,
} from "../../src/connectors/git.js";

const mockedExecFileSync = vi.mocked(childProcess.execFileSync);

beforeEach(() => {
  mockedExecFileSync.mockReset();
});

// ---------------------------------------------------------------------------
// getGitSha
// ---------------------------------------------------------------------------

describe("getGitSha", () => {
  it("returns a 40-char hex string when inside a git repo", async () => {
    const sha = "a".repeat(40);
    mockedExecFileSync.mockReturnValueOnce(`${sha}\n` as unknown as Buffer);
    const result = await getGitSha("/some/repo");
    expect(result).toBe(sha);
    expect(result).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns undefined when not inside a git repo (execFileSync throws)", async () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error("fatal: not a git repository");
    });
    const result = await getGitSha("/not/a/repo");
    expect(result).toBeUndefined();
  });

  it("returns undefined when git returns empty output", async () => {
    mockedExecFileSync.mockReturnValueOnce("" as unknown as Buffer);
    const result = await getGitSha("/some/repo");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getRemoteUrl
// ---------------------------------------------------------------------------

describe("getRemoteUrl", () => {
  it("returns origin URL when remote is configured (HTTPS)", async () => {
    const url = "https://github.com/acme/logbook.git";
    mockedExecFileSync.mockReturnValueOnce(`${url}\n` as unknown as Buffer);
    const result = await getRemoteUrl("/some/repo");
    expect(result).toBe(url);
  });

  it("returns origin URL when remote is configured (SSH)", async () => {
    const url = "git@github.com:acme/logbook.git";
    mockedExecFileSync.mockReturnValueOnce(`${url}\n` as unknown as Buffer);
    const result = await getRemoteUrl("/some/repo");
    expect(result).toBe(url);
  });

  it("returns undefined when no remote is configured (execFileSync throws)", async () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error("fatal: No such remote 'origin'");
    });
    const result = await getRemoteUrl("/some/repo");
    expect(result).toBeUndefined();
  });

  it("returns undefined when remote URL is empty", async () => {
    mockedExecFileSync.mockReturnValueOnce("" as unknown as Buffer);
    const result = await getRemoteUrl("/some/repo");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildCommitLink (pure function — no mocks needed)
// ---------------------------------------------------------------------------

describe("buildCommitLink", () => {
  it("detects github.com HTTPS remote and returns commit URL", () => {
    const url = buildCommitLink(
      "https://github.com/acme/logbook.git",
      "abc1234def5678901234567890123456789012345",
    );
    expect(url).toBe(
      "https://github.com/acme/logbook/commit/abc1234def5678901234567890123456789012345",
    );
  });

  it("detects github.com SSH remote (git@github.com:org/repo.git) and returns commit URL", () => {
    const url = buildCommitLink(
      "git@github.com:acme/logbook.git",
      "abc1234def5678901234567890123456789012345",
    );
    expect(url).toBe(
      "https://github.com/acme/logbook/commit/abc1234def5678901234567890123456789012345",
    );
  });

  it("detects gitlab.com HTTPS remote and returns commit URL", () => {
    const url = buildCommitLink(
      "https://gitlab.com/acme/logbook.git",
      "abc1234def5678901234567890123456789012345",
    );
    expect(url).toBe(
      "https://gitlab.com/acme/logbook/-/commit/abc1234def5678901234567890123456789012345",
    );
  });

  it("detects gitlab.com SSH remote and returns commit URL", () => {
    const url = buildCommitLink(
      "git@gitlab.com:acme/logbook.git",
      "abc1234def5678901234567890123456789012345",
    );
    expect(url).toBe(
      "https://gitlab.com/acme/logbook/-/commit/abc1234def5678901234567890123456789012345",
    );
  });

  it("detects bitbucket.org HTTPS remote and returns commit URL", () => {
    const url = buildCommitLink(
      "https://bitbucket.org/acme/logbook.git",
      "abc1234def5678901234567890123456789012345",
    );
    expect(url).toBe(
      "https://bitbucket.org/acme/logbook/commits/abc1234def5678901234567890123456789012345",
    );
  });

  it("returns undefined for unknown host (e.g. internal Gitea)", () => {
    const url = buildCommitLink(
      "https://git.internal.company.com/acme/logbook.git",
      "abc1234def5678901234567890123456789012345",
    );
    expect(url).toBeUndefined();
  });

  it("returns undefined when remote is undefined", () => {
    const url = buildCommitLink(
      undefined,
      "abc1234def5678901234567890123456789012345",
    );
    expect(url).toBeUndefined();
  });
});

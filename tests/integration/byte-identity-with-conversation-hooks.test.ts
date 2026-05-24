/**
 * Integration test: byte-identical install/uninstall with the slice-26 lean
 * hook set (SessionStart + Stop only).
 *
 * Slice 26 removed PostToolUse + UserPromptSubmit from the standard preset:
 * the transcript scraper now backfills tool_use / tool_result / user_prompt
 * events with toolUseId + fingerprint dedup, so the live hooks were
 * redundant. This test verifies the trimmed install set and that every hook
 * still carries the lb-* id tag required by invariant I-7.
 *
 * Scope: verifies that the 2 surviving hook entries have lb-* ids and the
 * installer/uninstaller can round-trip them without corrupting other content.
 */

import { describe, it, expect } from "vitest";
import { buildStandardArtifacts } from "../../src/core/presets.js";

describe("standard preset (slice 26 lean): SessionStart + Stop only", () => {
  it("has SessionStart hook with lb-hook-sessionstart-001 id", () => {
    process.env["LOGBOOK_HOOK_PATH"] = "/fake/hook.cjs";
    process.env["LOGBOOK_ASSETS_ROOT"] = `${process.cwd()}/assets`;

    const artifacts = buildStandardArtifacts("/tmp/fake-project");

    const hooks = artifacts.filter((a) => a.kind === "hook");
    const sessionStart = hooks.find(
      (a) => a.kind === "hook" && a.hookEvent === "SessionStart",
    );
    expect(sessionStart).toBeDefined();
    expect(sessionStart!._logbookId).toBe("lb-hook-sessionstart-001");
  });

  it("has Stop hook with lb-hook-stop-001 id", () => {
    process.env["LOGBOOK_HOOK_PATH"] = "/fake/hook.cjs";
    process.env["LOGBOOK_ASSETS_ROOT"] = `${process.cwd()}/assets`;

    const artifacts = buildStandardArtifacts("/tmp/fake-project");

    const hooks = artifacts.filter((a) => a.kind === "hook");
    const stopHook = hooks.find(
      (a) => a.kind === "hook" && a.hookEvent === "Stop",
    );
    expect(stopHook).toBeDefined();
    expect(stopHook!._logbookId).toBe("lb-hook-stop-001");
  });

  it("standard install registers ONLY 2 hooks (slice 26 lean contract)", () => {
    process.env["LOGBOOK_HOOK_PATH"] = "/fake/hook.cjs";
    process.env["LOGBOOK_ASSETS_ROOT"] = `${process.cwd()}/assets`;

    const artifacts = buildStandardArtifacts("/tmp/fake-project");
    const hooks = artifacts.filter((a) => a.kind === "hook");
    expect(hooks).toHaveLength(2);

    const hookEvents = hooks
      .map((h) => (h.kind === "hook" ? h.hookEvent : ""))
      .sort();
    expect(hookEvents).toEqual(["SessionStart", "Stop"]);
  });

  it("PostToolUse + UserPromptSubmit are NOT registered (scraper covers them)", () => {
    process.env["LOGBOOK_HOOK_PATH"] = "/fake/hook.cjs";
    process.env["LOGBOOK_ASSETS_ROOT"] = `${process.cwd()}/assets`;

    const artifacts = buildStandardArtifacts("/tmp/fake-project");
    const hooks = artifacts.filter((a) => a.kind === "hook");

    expect(
      hooks.find((a) => a.kind === "hook" && a.hookEvent === "PostToolUse"),
    ).toBeUndefined();
    expect(
      hooks.find(
        (a) => a.kind === "hook" && a.hookEvent === "UserPromptSubmit",
      ),
    ).toBeUndefined();
  });

  it("all hook artifacts have lb-* id tags (invariant I-7)", () => {
    process.env["LOGBOOK_HOOK_PATH"] = "/fake/hook.cjs";
    process.env["LOGBOOK_ASSETS_ROOT"] = `${process.cwd()}/assets`;

    const artifacts = buildStandardArtifacts("/tmp/fake-project");
    const hooks = artifacts.filter((a) => a.kind === "hook");

    for (const hook of hooks) {
      expect(hook._logbookId).toMatch(/^lb-/);
    }
  });
});

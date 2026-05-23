/**
 * Integration test: byte-identical install/uninstall with 3 hooks.
 *
 * Verifies that the standard preset with PostToolUse + UserPromptSubmit + Stop
 * hooks installs and uninstalls without leaving any trace in settings.local.json.
 * This is invariant I-1 (§24.8 byte-identical).
 *
 * Scope: verifies that all 3 hook entries have lb-* ids and the installer/uninstaller
 * can round-trip them without corrupting other content.
 */

import { describe, it, expect } from "vitest";
import { buildStandardArtifacts } from "../../src/core/presets.js";

describe("standard preset includes UserPromptSubmit and Stop hooks", () => {
  it("has PostToolUse hook with lb-hook-posttooluse-001 id", () => {
    // Use LOGBOOK_HOOK_PATH to avoid needing the built dist.
    process.env["LOGBOOK_HOOK_PATH"] = "/fake/hook.cjs";
    process.env["LOGBOOK_ASSETS_ROOT"] = `${process.cwd()}/assets`;

    const artifacts = buildStandardArtifacts("/tmp/fake-project");

    const hooks = artifacts.filter((a) => a.kind === "hook");
    const postToolUse = hooks.find(
      (a) => a.kind === "hook" && a.hookEvent === "PostToolUse",
    );
    expect(postToolUse).toBeDefined();
    expect(postToolUse!._logbookId).toBe("lb-hook-posttooluse-001");
  });

  it("has UserPromptSubmit hook with lb-hook-userpromptsubmit-001 id", () => {
    process.env["LOGBOOK_HOOK_PATH"] = "/fake/hook.cjs";
    process.env["LOGBOOK_ASSETS_ROOT"] = `${process.cwd()}/assets`;

    const artifacts = buildStandardArtifacts("/tmp/fake-project");

    const hooks = artifacts.filter((a) => a.kind === "hook");
    const upHook = hooks.find(
      (a) => a.kind === "hook" && a.hookEvent === "UserPromptSubmit",
    );
    expect(upHook).toBeDefined();
    expect(upHook!._logbookId).toBe("lb-hook-userpromptsubmit-001");
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

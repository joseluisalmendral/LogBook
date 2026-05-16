/**
 * installers-crlf-roundtrip.test.ts — CRLF byte-identity contract for hook + gitignore installers.
 *
 * TDD (T3): written BEFORE the retro-touches to hook.ts + gitignore.ts.
 * RED state: `detectedLineEnding` missing from ManifestArtifact; post-install file
 * produces mixed newlines instead of all-CRLF.
 *
 * Contract: for CRLF fixture files, install then uninstall must be byte-identical
 * to the original CRLF bytes. The post-install file must also remain all-CRLF
 * (no mixed-newline contamination).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { clearRegistry } from "../../src/connectors/claude-code/artifacts/registry.js";
import {
  bootstrapClaudeCodeInstallers,
  _resetBootstrapFlag,
} from "../../src/connectors/claude-code/artifacts/index.js";
import { getInstaller } from "../../src/connectors/claude-code/artifacts/registry.js";
import type { InstallContext } from "../../src/connectors/claude-code/artifacts/installer.js";
import type { Artifact } from "../../src/types/artifact.js";
import { emptyManifest } from "../../src/core/manifest.js";
import { makePaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CRLF_FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "../fixtures/crlf"
);

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function hasCRLF(content: string): boolean {
  return /\r\n/.test(content);
}

function hasLoneLF(content: string): boolean {
  // lone LF = \n NOT preceded by \r
  return /(?<!\r)\n/.test(content);
}

function isMixedEndings(content: string): boolean {
  return hasCRLF(content) && hasLoneLF(content);
}

// ---------------------------------------------------------------------------
// Test project setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let projectRoot: string;

beforeEach(() => {
  clearRegistry();
  _resetBootstrapFlag();
  bootstrapClaudeCodeInstallers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-crlf-rt-"));
  projectRoot = fs.realpathSync(tmpDir);
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".claude"), { recursive: true });
});

afterEach(() => {
  clearRegistry();
  _resetBootstrapFlag();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<InstallContext> = {}): InstallContext {
  const paths = makePaths(projectRoot);
  return {
    projectRoot,
    preset: "minimal",
    manifest: emptyManifest("minimal"),
    backups: new Map(),
    dryRun: false,
    now: () => "2026-01-01T00:00:00.000Z",
    ulid: () => "01TEST00000000000000000000",
    paths,
    ...overrides,
  };
}

function makeHookArtifact(
  id = "lb-hook-posttooluse-001"
): Extract<Artifact, { kind: "hook" }> {
  return {
    kind: "hook",
    hookEvent: "PostToolUse",
    command: "/abs/dist/connectors/claude-code/hook.cjs",
    _logbookId: id,
  };
}

function makeGitignoreArtifact(
  id = "lb-gitignore-001"
): Extract<Artifact, { kind: "gitignore_entry" }> {
  return {
    kind: "gitignore_entry",
    file_path: ".gitignore",
    lines: [".logbook/", "logbook/", `# ${id}`],
  };
}

// ---------------------------------------------------------------------------
// Hook installer — CRLF roundtrip
// ---------------------------------------------------------------------------

describe("HookInstaller — CRLF fixture byte-identity roundtrip", () => {
  it("install + uninstall is byte-identical for CRLF settings.local.json", async () => {
    const fixtureContent = fs.readFileSync(
      path.join(CRLF_FIXTURES_DIR, "settings.local.json"),
      "utf8"
    );
    const originalHash = sha256(fixtureContent);

    // Confirm fixture is CRLF
    expect(hasCRLF(fixtureContent)).toBe(true);

    const settingsPath = path.join(projectRoot, ".claude", "settings.local.json");
    // Preserve CRLF: use copyFileSync
    fs.copyFileSync(path.join(CRLF_FIXTURES_DIR, "settings.local.json"), settingsPath);

    const installer = getInstaller("hook");
    const artifact = makeHookArtifact();
    const ctx = makeCtx();

    // Install
    const entry = await installer.install(artifact, ctx);

    // The manifest entry must record detectedLineEnding
    expect(entry.detectedLineEnding).toBe("crlf");

    // Post-install: file must still be CRLF (no mixed-newline contamination)
    const afterInstall = fs.readFileSync(settingsPath, "utf8");
    expect(hasCRLF(afterInstall)).toBe(true);
    expect(isMixedEndings(afterInstall)).toBe(false);
    // Logbook entry must be present
    expect(afterInstall).toContain('"_logbookId"');

    // Uninstall
    await installer.uninstall(entry, ctx);

    // After uninstall: must be byte-identical to original CRLF fixture
    const afterUninstall = fs.readFileSync(settingsPath, "utf8");
    expect(sha256(afterUninstall)).toBe(originalHash);
    expect(afterUninstall).toBe(fixtureContent);
  });

  it("LF fixture still works byte-identically after retro-touch (no regression)", async () => {
    const SETTINGS_FIXTURES_DIR = path.resolve(
      import.meta.dirname,
      "../fixtures/settings-local-json"
    );
    const fixtureContent = fs.readFileSync(
      path.join(SETTINGS_FIXTURES_DIR, "two-other-plugins.json"),
      "utf8"
    );
    const originalHash = sha256(fixtureContent);

    // Confirm fixture is LF-only
    expect(hasCRLF(fixtureContent)).toBe(false);

    const settingsPath = path.join(projectRoot, ".claude", "settings.local.json");
    fs.copyFileSync(path.join(SETTINGS_FIXTURES_DIR, "two-other-plugins.json"), settingsPath);

    const installer = getInstaller("hook");
    const artifact = makeHookArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);

    // LF fixture: detectedLineEnding should be "lf"
    expect(entry.detectedLineEnding).toBe("lf");

    await installer.uninstall(entry, ctx);

    const afterUninstall = fs.readFileSync(settingsPath, "utf8");
    expect(sha256(afterUninstall)).toBe(originalHash);
    expect(afterUninstall).toBe(fixtureContent);
  });
});

// ---------------------------------------------------------------------------
// GitignoreInstaller — CRLF roundtrip
// ---------------------------------------------------------------------------

describe("GitignoreInstaller — CRLF fixture byte-identity roundtrip", () => {
  it("install + uninstall is byte-identical for CRLF .gitignore", async () => {
    const fixtureContent = fs.readFileSync(
      path.join(CRLF_FIXTURES_DIR, ".gitignore"),
      "utf8"
    );
    const originalHash = sha256(fixtureContent);

    // Confirm fixture is CRLF
    expect(hasCRLF(fixtureContent)).toBe(true);

    const gitignorePath = path.join(projectRoot, ".gitignore");
    fs.copyFileSync(path.join(CRLF_FIXTURES_DIR, ".gitignore"), gitignorePath);

    const installer = getInstaller("gitignore_entry");
    const artifact = makeGitignoreArtifact();
    const ctx = makeCtx();

    // Install
    const entry = await installer.install(artifact, ctx);

    // The manifest entry must record detectedLineEnding
    expect(entry.detectedLineEnding).toBe("crlf");

    // Post-install: file must still be CRLF (no mixed-newline contamination)
    const afterInstall = fs.readFileSync(gitignorePath, "utf8");
    expect(hasCRLF(afterInstall)).toBe(true);
    expect(isMixedEndings(afterInstall)).toBe(false);
    // Logbook lines must be present
    expect(afterInstall).toContain(".logbook/");
    expect(afterInstall).toContain("logbook/");

    // Uninstall
    await installer.uninstall(entry, ctx);

    // After uninstall: must be byte-identical to original CRLF fixture
    const afterUninstall = fs.readFileSync(gitignorePath, "utf8");
    expect(sha256(afterUninstall)).toBe(originalHash);
    expect(afterUninstall).toBe(fixtureContent);
  });

  it("LF fixture still works byte-identically after retro-touch (no regression)", async () => {
    const GITIGNORE_FIXTURES_DIR = path.resolve(
      import.meta.dirname,
      "../fixtures/gitignore"
    );
    const fixtureContent = fs.readFileSync(
      path.join(GITIGNORE_FIXTURES_DIR, "with-trailing-newline"),
      "utf8"
    );
    const originalHash = sha256(fixtureContent);

    // Confirm fixture is LF-only
    expect(hasCRLF(fixtureContent)).toBe(false);

    const gitignorePath = path.join(projectRoot, ".gitignore");
    fs.copyFileSync(path.join(GITIGNORE_FIXTURES_DIR, "with-trailing-newline"), gitignorePath);

    const installer = getInstaller("gitignore_entry");
    const artifact = makeGitignoreArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);

    // LF fixture: detectedLineEnding should be "lf"
    expect(entry.detectedLineEnding).toBe("lf");

    await installer.uninstall(entry, ctx);

    const afterUninstall = fs.readFileSync(gitignorePath, "utf8");
    expect(sha256(afterUninstall)).toBe(originalHash);
    expect(afterUninstall).toBe(fixtureContent);
  });
});

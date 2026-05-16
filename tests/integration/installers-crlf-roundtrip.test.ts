/**
 * installers-crlf-roundtrip.test.ts — CRLF byte-identity contract for all installers.
 *
 * Covers: hook, gitignore, subagent, and statusline installers.
 *
 * TDD (T3 iter3): original hook + gitignore CRLF tests written BEFORE the retro-touches.
 * TDD (T9 iter4): subagent + statusline CRLF tests added to close iter3 W-MONITOR-3.
 *
 * Contract: for CRLF fixture files, install then uninstall must be byte-identical
 * to the original CRLF bytes. The post-install file must also remain all-CRLF
 * (no mixed-newline contamination). Subagent files are owned by LogBook and are
 * always written in LF — the CRLF concern applies only to surrounding shared files.
 *
 * Closes: iter3 W-MONITOR-3 (no .gitattributes for CRLF fixtures — test coverage
 * extended to subagent and statusline installers so the contract is verified end-to-end).
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

function makeSubagentArtifact(
  id = "lb-agent-curator"
): Extract<Artifact, { kind: "subagent" }> {
  return {
    kind: "subagent",
    name: "logbook-curator",
    file_path: ".claude/subagents/logbook-curator.md",
    body: "---\nname: logbook-curator\ndescription: Curate events into decisions\n---\n\nTest subagent body.\n",
    _logbookId: id,
  };
}

function makeStatuslineArtifact(
  id = "lb-statusline-001"
): Extract<Artifact, { kind: "statusline" }> {
  return {
    kind: "statusline",
    command: "node /dist/cli/index.cjs state --inline",
    _logbookId: id,
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

// ---------------------------------------------------------------------------
// SubagentInstaller — CRLF surrounding files stay CRLF (W-MONITOR-3 closure)
// ---------------------------------------------------------------------------

describe("SubagentInstaller — surrounding CRLF shared files remain CRLF after install/uninstall", () => {
  it(
    "CRLF settings.local.json and CRLF CLAUDE.md are untouched by subagent install + uninstall",
    async () => {
      // Subagent files are owned by LogBook and always written in LF.
      // The CRLF concern here is that subagent install/uninstall must NOT corrupt
      // surrounding shared files that happen to be CRLF-encoded.

      const crlfSettingsFixture = fs.readFileSync(
        path.join(CRLF_FIXTURES_DIR, "settings.local.json"),
        "utf8"
      );
      const crlfClaudemdFixture = fs.readFileSync(
        path.join(CRLF_FIXTURES_DIR, "CLAUDE.md"),
        "utf8"
      );

      expect(hasCRLF(crlfSettingsFixture)).toBe(true);
      expect(hasCRLF(crlfClaudemdFixture)).toBe(true);

      const settingsPath = path.join(projectRoot, ".claude", "settings.local.json");
      const claudemdPath = path.join(projectRoot, "CLAUDE.md");

      fs.copyFileSync(path.join(CRLF_FIXTURES_DIR, "settings.local.json"), settingsPath);
      fs.copyFileSync(path.join(CRLF_FIXTURES_DIR, "CLAUDE.md"), claudemdPath);

      const settingsHashBefore = sha256(crlfSettingsFixture);
      const claudemdHashBefore = sha256(crlfClaudemdFixture);

      const installer = getInstaller("subagent");
      const artifact = makeSubagentArtifact();
      const ctx = makeCtx();

      // Install the subagent — writes .claude/subagents/logbook-curator.md in LF.
      const entry = await installer.install(artifact, ctx);

      // Surrounding CRLF files must be completely untouched.
      const settingsAfterInstall = fs.readFileSync(settingsPath, "utf8");
      const claudemdAfterInstall = fs.readFileSync(claudemdPath, "utf8");

      expect(sha256(settingsAfterInstall)).toBe(settingsHashBefore);
      expect(sha256(claudemdAfterInstall)).toBe(claudemdHashBefore);
      expect(isMixedEndings(settingsAfterInstall)).toBe(false);
      expect(isMixedEndings(claudemdAfterInstall)).toBe(false);

      // The subagent file itself is LF (owned file — we write it).
      const subagentPath = path.join(projectRoot, ".claude", "subagents", "logbook-curator.md");
      const subagentContent = fs.readFileSync(subagentPath, "utf8");
      expect(hasCRLF(subagentContent)).toBe(false);

      // Uninstall — removes subagent file; shared files still untouched.
      await installer.uninstall(entry, ctx);

      const settingsAfterUninstall = fs.readFileSync(settingsPath, "utf8");
      const claudemdAfterUninstall = fs.readFileSync(claudemdPath, "utf8");

      expect(sha256(settingsAfterUninstall)).toBe(settingsHashBefore);
      expect(sha256(claudemdAfterUninstall)).toBe(claudemdHashBefore);

      // Subagent file should be removed (hash matched expected_sha256).
      expect(fs.existsSync(subagentPath)).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// StatuslineInstaller — CRLF roundtrip (W-MONITOR-3 closure)
// ---------------------------------------------------------------------------

describe("StatuslineInstaller — CRLF fixture byte-identity roundtrip", () => {
  it("install + uninstall is byte-identical for CRLF settings.local.json", async () => {
    const fixturePath = path.join(
      import.meta.dirname,
      "../fixtures/statusline/crlf-settings.json"
    );
    const fixtureContent = fs.readFileSync(fixturePath, "utf8");
    const originalHash = sha256(fixtureContent);

    // Confirm fixture is CRLF-encoded.
    expect(hasCRLF(fixtureContent)).toBe(true);

    const settingsPath = path.join(projectRoot, ".claude", "settings.local.json");
    // Preserve CRLF bytes: use copyFileSync (not readFile + writeFile which normalises on some platforms).
    fs.copyFileSync(fixturePath, settingsPath);

    const installer = getInstaller("statusline");
    const artifact = makeStatuslineArtifact();
    const ctx = makeCtx();

    // Install: sets the statusLine scalar in settings.local.json.
    const entry = await installer.install(artifact, ctx);

    // The manifest entry must record detectedLineEnding = "crlf".
    expect(entry.detectedLineEnding).toBe("crlf");

    // Post-install: file must remain all-CRLF (toLF → edit → fromLF round-trip must restore CRLF).
    const afterInstall = fs.readFileSync(settingsPath, "utf8");
    expect(hasCRLF(afterInstall)).toBe(true);
    expect(isMixedEndings(afterInstall)).toBe(false);

    // The statusLine key must be present.
    const parsed = JSON.parse(afterInstall.replace(/\r\n/g, "\n")) as Record<string, unknown>;
    expect(typeof parsed["statusLine"]).toBe("string");
    expect(parsed["statusLine"]).toBe(artifact.command);

    // Uninstall: removes statusLine key; file must be byte-identical to original CRLF fixture.
    await installer.uninstall(entry, ctx);

    const afterUninstall = fs.readFileSync(settingsPath, "utf8");
    expect(sha256(afterUninstall)).toBe(originalHash);
    expect(afterUninstall).toBe(fixtureContent);
  });

  it("LF fixture still works byte-identically (no regression)", async () => {
    const fixturePath = path.join(
      import.meta.dirname,
      "../fixtures/statusline/empty-settings.json"
    );
    const fixtureContent = fs.readFileSync(fixturePath, "utf8");
    const originalHash = sha256(fixtureContent);

    // Confirm fixture is LF-only.
    expect(hasCRLF(fixtureContent)).toBe(false);

    const settingsPath = path.join(projectRoot, ".claude", "settings.local.json");
    fs.copyFileSync(fixturePath, settingsPath);

    const installer = getInstaller("statusline");
    const artifact = makeStatuslineArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);

    expect(entry.detectedLineEnding).toBe("lf");

    await installer.uninstall(entry, ctx);

    const afterUninstall = fs.readFileSync(settingsPath, "utf8");
    expect(sha256(afterUninstall)).toBe(originalHash);
    expect(afterUninstall).toBe(fixtureContent);
  });
});

/**
 * installers-via-engine.test.ts — End-to-end integration for concrete S7
 * installers running through the install/uninstall engine.
 *
 * Not the full S10 byte-identity gate, but a dress rehearsal: verifies that
 * both artifacts are installed, the manifest has 2 entries, and uninstall
 * restores files byte-identically.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { clearRegistry } from "../../src/connectors/claude-code/artifacts/registry.js";
import {
  bootstrapClaudeCodeInstallers,
  _resetBootstrapFlag,
} from "../../src/connectors/claude-code/artifacts/index.js";
import { runInstall } from "../../src/core/install-engine.js";
import { runUninstall } from "../../src/core/uninstall-engine.js";
import { makePaths } from "../../src/core/paths.js";
import { readManifest } from "../../src/core/manifest.js";
import type { Artifact } from "../../src/types/artifact.js";

// ---------------------------------------------------------------------------
// Test project setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let projectRoot: string;

beforeEach(() => {
  clearRegistry();
  _resetBootstrapFlag();
  bootstrapClaudeCodeInstallers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-engine-s7-"));
  projectRoot = fs.realpathSync(tmpDir);
  // Minimal project layout
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".logbook", "backups"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".claude"), { recursive: true });
  // Start with an empty settings.local.json and an empty .gitignore
  fs.writeFileSync(path.join(projectRoot, ".claude", "settings.local.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, ".gitignore"), "", "utf8");
});

afterEach(() => {
  clearRegistry();
  _resetBootstrapFlag();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Artifacts under test
// ---------------------------------------------------------------------------

function makeArtifacts(): Artifact[] {
  return [
    {
      kind: "hook",
      hookEvent: "PostToolUse",
      command: path.join(projectRoot, "dist/connectors/claude-code/hook.cjs"),
      _logbookId: "lb-hook-posttooluse-001",
    } as Artifact,
    {
      kind: "gitignore_entry",
      file_path: ".gitignore",
      lines: [".logbook/", "logbook/", "# lb-gitignore-001"],
    } as Artifact,
  ];
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("S7 installers via runInstall + runUninstall", () => {
  it("installs both artifacts and records 2 manifest entries", async () => {
    const paths = makePaths(projectRoot);
    const result = await runInstall({
      paths,
      preset: "minimal",
      artifacts: makeArtifacts(),
      dryRun: false,
      now: () => "2026-01-01T00:00:00.000Z",
    });

    expect(result.installed).toHaveLength(2);
    expect(result.manifest.artifacts).toHaveLength(2);

    // hook artifact
    const hookEntry = result.manifest.artifacts.find((a) => a.kind === "hook");
    expect(hookEntry).toBeDefined();
    expect(hookEntry!.id).toBe("lb-hook-posttooluse-001");
    expect(hookEntry!.file_path).toBe(".claude/settings.local.json");

    // gitignore_entry artifact
    const gitignoreEntry = result.manifest.artifacts.find(
      (a) => a.kind === "gitignore_entry"
    );
    expect(gitignoreEntry).toBeDefined();
    expect(gitignoreEntry!.id).toBe("lb-gitignore-001");
    expect(gitignoreEntry!.file_path).toBe(".gitignore");
  });

  it("modifies settings.local.json and .gitignore on install", async () => {
    const paths = makePaths(projectRoot);
    await runInstall({
      paths,
      preset: "minimal",
      artifacts: makeArtifacts(),
      dryRun: false,
      now: () => "2026-01-01T00:00:00.000Z",
    });

    const settings = fs.readFileSync(
      path.join(projectRoot, ".claude", "settings.local.json"),
      "utf8"
    );
    expect(settings).toContain('"_logbookId"');
    expect(settings).toContain('"PostToolUse"');

    const gitignore = fs.readFileSync(
      path.join(projectRoot, ".gitignore"),
      "utf8"
    );
    expect(gitignore).toContain(".logbook/");
    expect(gitignore).toContain("logbook/");
  });

  it("restores both files byte-identically on uninstall", async () => {
    const settingsOriginal = fs.readFileSync(
      path.join(projectRoot, ".claude", "settings.local.json"),
      "utf8"
    );
    const gitignoreOriginal = fs.readFileSync(
      path.join(projectRoot, ".gitignore"),
      "utf8"
    );

    const paths = makePaths(projectRoot);
    await runInstall({
      paths,
      preset: "minimal",
      artifacts: makeArtifacts(),
      dryRun: false,
      now: () => "2026-01-01T00:00:00.000Z",
    });

    // Uninstall
    const uninstallResult = await runUninstall({
      paths,
      dryRun: false,
      now: () => "2026-01-01T01:00:00.000Z",
    });

    expect(uninstallResult.removed).toHaveLength(2);
    expect(uninstallResult.issues).toHaveLength(0);

    // Byte-identity check
    const settingsAfter = fs.readFileSync(
      path.join(projectRoot, ".claude", "settings.local.json"),
      "utf8"
    );
    const gitignoreAfter = fs.readFileSync(
      path.join(projectRoot, ".gitignore"),
      "utf8"
    );

    expect(settingsAfter).toBe(settingsOriginal);
    expect(gitignoreAfter).toBe(gitignoreOriginal);
  });

  it("manifest is empty of artifacts after uninstall", async () => {
    const paths = makePaths(projectRoot);
    await runInstall({
      paths,
      preset: "minimal",
      artifacts: makeArtifacts(),
      dryRun: false,
      now: () => "2026-01-01T00:00:00.000Z",
    });

    await runUninstall({
      paths,
      dryRun: false,
      now: () => "2026-01-01T01:00:00.000Z",
    });

    const manifest = readManifest(paths.manifestPath);
    // After uninstall, manifest still exists but has no artifacts
    if (manifest !== null) {
      expect(manifest.artifacts).toHaveLength(0);
    }
    // (If manifest was deleted by CLI in future, that is also acceptable)
  });
});

/**
 * subagent-via-engine.test.ts — SubagentInstaller through the install + uninstall engines.
 *
 * TDD (T2): written BEFORE the SubagentInstaller was registered in bootstrapClaudeCodeInstallers.
 * GREEN state: SubagentInstaller registered → tests pass.
 *
 * Validates:
 * - runInstall with two subagent artifacts (curator + teacher) writes both files.
 * - Manifest has exactly 2 entries, both kind="subagent".
 * - runUninstall removes both files and cleans up .claude/subagents/ dir.
 * - Byte-identity roundtrip: file-system state before install === after uninstall.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  bootstrapClaudeCodeInstallers,
  _resetBootstrapFlag,
} from "../../src/connectors/claude-code/artifacts/index.js";
import { clearRegistry } from "../../src/connectors/claude-code/artifacts/registry.js";
import { runInstall } from "../../src/core/install-engine.js";
import { runUninstall } from "../../src/core/uninstall-engine.js";
import { makePaths } from "../../src/core/paths.js";
import type { Artifact } from "../../src/types/artifact.js";

// ---------------------------------------------------------------------------
// Asset bodies
// ---------------------------------------------------------------------------

const ASSETS_SUBAGENTS = path.resolve(import.meta.dirname, "../../assets/subagents");

function readCuratorBody(): string {
  return fs.readFileSync(path.join(ASSETS_SUBAGENTS, "logbook-curator.md"), "utf8");
}

function readTeacherBody(): string {
  return fs.readFileSync(path.join(ASSETS_SUBAGENTS, "logbook-teacher.md"), "utf8");
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCuratorArtifact(): Extract<Artifact, { kind: "subagent" }> {
  return {
    kind: "subagent",
    name: "logbook-curator",
    file_path: ".claude/subagents/logbook-curator.md",
    body: readCuratorBody(),
    _logbookId: "lb-agent-curator",
  };
}

function makeTeacherArtifact(): Extract<Artifact, { kind: "subagent" }> {
  return {
    kind: "subagent",
    name: "logbook-teacher",
    file_path: ".claude/subagents/logbook-teacher.md",
    body: readTeacherBody(),
    _logbookId: "lb-agent-teacher",
  };
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;
let projectRoot: string;

beforeEach(() => {
  clearRegistry();
  _resetBootstrapFlag();
  bootstrapClaudeCodeInstallers();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-subagent-engine-"));
  projectRoot = fs.realpathSync(tmpDir);

  // Minimal project structure for the engine
  fs.mkdirSync(path.join(projectRoot, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
});

afterEach(() => {
  clearRegistry();
  _resetBootstrapFlag();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SubagentInstaller via engine — install + uninstall", () => {
  it("runInstall with 2 subagent artifacts writes both files and produces 2 manifest entries", async () => {
    const paths = makePaths(projectRoot);
    const artifacts: Artifact[] = [makeCuratorArtifact(), makeTeacherArtifact()];

    const result = await runInstall({
      paths,
      preset: "standard",
      artifacts,
      dryRun: false,
    });

    // Both installed (no skipped)
    expect(result.installed).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    // Manifest has both entries
    expect(result.manifest.artifacts).toHaveLength(2);
    for (const entry of result.manifest.artifacts) {
      expect(entry.kind).toBe("subagent");
      expect(entry.anchor.type).toBe("owned_file");
    }

    // Both files exist on disk
    const subagentsDir = path.join(projectRoot, ".claude", "subagents");
    expect(fs.existsSync(path.join(subagentsDir, "logbook-curator.md"))).toBe(true);
    expect(fs.existsSync(path.join(subagentsDir, "logbook-teacher.md"))).toBe(true);

    // Content byte-identical
    expect(fs.readFileSync(path.join(subagentsDir, "logbook-curator.md"), "utf8")).toBe(readCuratorBody());
    expect(fs.readFileSync(path.join(subagentsDir, "logbook-teacher.md"), "utf8")).toBe(readTeacherBody());
  });

  it("runUninstall removes both files and cleans .claude/subagents/; byte-identity roundtrip", async () => {
    const paths = makePaths(projectRoot);
    const artifacts: Artifact[] = [makeCuratorArtifact(), makeTeacherArtifact()];

    // Capture state before install: .claude/subagents/ must not exist
    const subagentsDir = path.join(projectRoot, ".claude", "subagents");
    expect(fs.existsSync(subagentsDir)).toBe(false);

    // Install
    await runInstall({
      paths,
      preset: "standard",
      artifacts,
      dryRun: false,
    });

    // Verify files present
    expect(fs.existsSync(path.join(subagentsDir, "logbook-curator.md"))).toBe(true);
    expect(fs.existsSync(path.join(subagentsDir, "logbook-teacher.md"))).toBe(true);

    // Uninstall
    const uninstallResult = await runUninstall({
      paths,
      dryRun: false,
    });

    // No issues
    expect(uninstallResult.issues).toHaveLength(0);
    expect(uninstallResult.removed).toHaveLength(2);

    // Both files gone
    expect(fs.existsSync(path.join(subagentsDir, "logbook-curator.md"))).toBe(false);
    expect(fs.existsSync(path.join(subagentsDir, "logbook-teacher.md"))).toBe(false);

    // Dir cleaned (we created it)
    expect(fs.existsSync(subagentsDir)).toBe(false);

    // Byte-identity: .claude/subagents/ did not exist before → must not exist after
    expect(fs.existsSync(subagentsDir)).toBe(false);
  });

  it("manifest entries have expected ids and sha256 anchors", async () => {
    const paths = makePaths(projectRoot);
    const artifacts: Artifact[] = [makeCuratorArtifact(), makeTeacherArtifact()];

    const result = await runInstall({
      paths,
      preset: "standard",
      artifacts,
      dryRun: false,
    });

    const curatorEntry = result.manifest.artifacts[0];
    const teacherEntry = result.manifest.artifacts[1];

    expect(curatorEntry).toBeDefined();
    expect(teacherEntry).toBeDefined();

    expect(curatorEntry!.id).toBe("lb-agent-curator");
    expect(curatorEntry!.file_path).toBe(".claude/subagents/logbook-curator.md");
    if (curatorEntry!.anchor.type === "owned_file") {
      expect(curatorEntry!.anchor.expected_sha256).toHaveLength(64);
    }

    expect(teacherEntry!.id).toBe("lb-agent-teacher");
    expect(teacherEntry!.file_path).toBe(".claude/subagents/logbook-teacher.md");
    if (teacherEntry!.anchor.type === "owned_file") {
      expect(teacherEntry!.anchor.expected_sha256).toHaveLength(64);
    }
  });
});

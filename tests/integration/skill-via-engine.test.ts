/**
 * skill-via-engine.test.ts — SkillInstaller through the install + uninstall engines.
 *
 * TDD (T2): written BEFORE the SkillInstaller implementation.
 * RED state: SkillInstaller not registered → runInstall throws "No installer registered for kind 'skill'".
 *
 * Validates:
 * - runInstall with two Skill artifacts (SKILL.md + reference.md) writes both files.
 * - Manifest has exactly 2 entries, both kind="skill".
 * - runUninstall removes both files and cleans up parent dirs.
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

const ASSETS_SKILL = path.resolve(import.meta.dirname, "../../assets/skill");

function readSkillBody(): string {
  return fs.readFileSync(path.join(ASSETS_SKILL, "SKILL.md"), "utf8");
}

function readReferenceBody(): string {
  return fs.readFileSync(path.join(ASSETS_SKILL, "reference.md"), "utf8");
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSkillArtifact(
  file: "SKILL.md" | "reference.md",
  name = "logbook-auto-capture"
): Extract<Artifact, { kind: "skill" }> {
  const body = file === "SKILL.md" ? readSkillBody() : readReferenceBody();
  const suffix = file === "SKILL.md" ? "main" : "ref";
  return {
    kind: "skill",
    name,
    file_path: `.claude/skills/${name}/${file}`,
    body,
    _logbookId: `lb-skill-auto-capture-${suffix}`,
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

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-skill-engine-"));
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

describe("SkillInstaller via engine — install + uninstall", () => {
  it("runInstall with 2 Skill artifacts writes both files and produces 2 manifest entries", async () => {
    const paths = makePaths(projectRoot);
    const artifacts: Artifact[] = [
      makeSkillArtifact("SKILL.md"),
      makeSkillArtifact("reference.md"),
    ];

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
      expect(entry.kind).toBe("skill");
      expect(entry.anchor.type).toBe("owned_file");
    }

    // Both files exist on disk
    const skillsBase = path.join(projectRoot, ".claude", "skills", "logbook-auto-capture");
    expect(fs.existsSync(path.join(skillsBase, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillsBase, "reference.md"))).toBe(true);

    // Content byte-identical
    expect(fs.readFileSync(path.join(skillsBase, "SKILL.md"), "utf8")).toBe(readSkillBody());
    expect(fs.readFileSync(path.join(skillsBase, "reference.md"), "utf8")).toBe(readReferenceBody());
  });

  it("runUninstall removes both files and cleans parent dirs; byte-identity roundtrip", async () => {
    const paths = makePaths(projectRoot);
    const artifacts: Artifact[] = [
      makeSkillArtifact("SKILL.md"),
      makeSkillArtifact("reference.md"),
    ];

    // Capture state before install: .claude/skills/ must not exist
    const skillsDir = path.join(projectRoot, ".claude", "skills");
    expect(fs.existsSync(skillsDir)).toBe(false);

    // Install
    await runInstall({
      paths,
      preset: "standard",
      artifacts,
      dryRun: false,
    });

    // Verify files present
    const skillsBase = path.join(skillsDir, "logbook-auto-capture");
    expect(fs.existsSync(path.join(skillsBase, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillsBase, "reference.md"))).toBe(true);

    // Uninstall
    const uninstallResult = await runUninstall({
      paths,
      dryRun: false,
    });

    // No issues
    expect(uninstallResult.issues).toHaveLength(0);
    expect(uninstallResult.removed).toHaveLength(2);

    // Both files gone
    expect(fs.existsSync(path.join(skillsBase, "SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(skillsBase, "reference.md"))).toBe(false);

    // Both parent dirs cleaned (we created them)
    expect(fs.existsSync(skillsBase)).toBe(false);
    expect(fs.existsSync(skillsDir)).toBe(false);

    // Byte-identity: .claude/skills/ did not exist before → must not exist after
    expect(fs.existsSync(skillsDir)).toBe(false);
  });

  it("manifest entries have expected ids and sha256 anchors", async () => {
    const paths = makePaths(projectRoot);
    const artifacts: Artifact[] = [
      makeSkillArtifact("SKILL.md"),
      makeSkillArtifact("reference.md"),
    ];

    const result = await runInstall({
      paths,
      preset: "standard",
      artifacts,
      dryRun: false,
    });

    const mainEntry = result.manifest.artifacts[0];
    const refEntry = result.manifest.artifacts[1];

    expect(mainEntry).toBeDefined();
    expect(refEntry).toBeDefined();

    expect(mainEntry!.id).toBe("lb-skill-auto-capture-main");
    expect(mainEntry!.file_path).toBe(".claude/skills/logbook-auto-capture/SKILL.md");
    if (mainEntry!.anchor.type === "owned_file") {
      expect(mainEntry!.anchor.expected_sha256).toHaveLength(64);
    }

    expect(refEntry!.id).toBe("lb-skill-auto-capture-ref");
    expect(refEntry!.file_path).toBe(".claude/skills/logbook-auto-capture/reference.md");
    if (refEntry!.anchor.type === "owned_file") {
      expect(refEntry!.anchor.expected_sha256).toHaveLength(64);
    }
  });
});

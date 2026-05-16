/**
 * Tests for SkillInstaller — detect / install / uninstall / verify.
 *
 * Strict TDD — this file was written BEFORE the implementation.
 * All tests must fail (RED) until skill.ts is implemented (GREEN).
 *
 * Key invariants:
 * - Install single SKILL.md: file written, sha256 captured, parent dirs recorded.
 * - Install BOTH files in sequence (SKILL.md then reference.md): first entry records
 *   created dirs; second entry records [] (dirs pre-existed after first install).
 * - Uninstall in REVERSE: reference.md removed first (dirs remain because SKILL.md
 *   still there); then SKILL.md removed (dirs cleaned because now empty).
 * - Pre-existing .claude/skills/ with other plugin: install adds our Skill only to
 *   our subdir; uninstall cleans our subdir but NOT the shared .claude/skills/ dir.
 * - Hash mismatch post-install: verify reports hash_mismatch; uninstall skips deletion.
 * - Pre-existing file with different content: detect returns occupied-by-other;
 *   install throws ConflictError.
 * - Detect with manifest entry: occupied-by-logbook.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  bootstrapClaudeCodeInstallers,
  _resetBootstrapFlag,
} from "../../src/connectors/claude-code/artifacts/index.js";
import {
  clearRegistry,
  getInstaller,
} from "../../src/connectors/claude-code/artifacts/registry.js";
import type { ArtifactInstaller, InstallContext } from "../../src/connectors/claude-code/artifacts/installer.js";
import type { Manifest, ManifestArtifact } from "../../src/types/manifest.js";
import type { Artifact } from "../../src/types/artifact.js";
import type { ProjectPaths } from "../../src/core/paths.js";
import { ConflictError } from "../../src/core/errors.js";

// ---------------------------------------------------------------------------
// Asset bodies (read from T1-produced assets)
// ---------------------------------------------------------------------------

const ASSETS_SKILL = resolve(import.meta.dirname, "../../assets/skill");

function readSkillBody(): string {
  return readFileSync(resolve(ASSETS_SKILL, "SKILL.md"), "utf8");
}

function readReferenceBody(): string {
  return readFileSync(resolve(ASSETS_SKILL, "reference.md"), "utf8");
}

// ---------------------------------------------------------------------------
// Test context helpers
// ---------------------------------------------------------------------------

function makeManifest(artifacts: ManifestArtifact[] = []): Manifest {
  return {
    version: 1,
    installed_at: "2026-01-01T00:00:00.000Z",
    preset: "standard",
    artifacts,
    backups: [],
  };
}

function makeSkillArtifact(
  file: "SKILL.md" | "reference.md",
  opts?: { logbookId?: string; name?: string }
): Extract<Artifact, { kind: "skill" }> {
  const name = opts?.name ?? "logbook-auto-capture";
  const body = file === "SKILL.md" ? readSkillBody() : readReferenceBody();
  const suffix = file === "SKILL.md" ? "main" : "ref";
  return {
    kind: "skill",
    name,
    file_path: `.claude/skills/${name}/${file}`,
    body,
    _logbookId: opts?.logbookId ?? `lb-skill-auto-capture-${suffix}`,
  };
}

function makeCtx(projectRoot: string, manifest: Manifest = makeManifest()): InstallContext {
  return {
    projectRoot,
    preset: "standard",
    manifest,
    backups: new Map(),
    dryRun: false,
    now: () => "2026-01-01T00:00:00.000Z",
    ulid: () => "01JFAKEULID00000000000001",
    paths: {
      projectRoot,
      dotLogbook: join(projectRoot, ".logbook"),
      state: join(projectRoot, ".logbook", "state.json"),
      manifest: join(projectRoot, ".logbook", "manifest.json"),
      backups: join(projectRoot, ".logbook", "backups"),
      events: join(projectRoot, "logbook", "events.jsonl"),
      sessions: join(projectRoot, "logbook", "sessions.jsonl"),
      decisions: join(projectRoot, "logbook", "decisions"),
    } as unknown as ProjectPaths,
  };
}

// ---------------------------------------------------------------------------
// Tmp dir helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(() => {
  clearRegistry();
  _resetBootstrapFlag();
  bootstrapClaudeCodeInstallers();
  tmpRoot = resolve(
    tmpdir(),
    `skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function getSkillInstaller(): ArtifactInstaller<Extract<Artifact, { kind: "skill" }>> {
  return getInstaller("skill") as ArtifactInstaller<Extract<Artifact, { kind: "skill" }>>;
}

// ---------------------------------------------------------------------------
// Install single Skill file (SKILL.md)
// ---------------------------------------------------------------------------

describe("SkillInstaller — single file lifecycle (SKILL.md only)", () => {
  it("install creates .claude/skills/<name>/ dir and SKILL.md with correct body", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot);

    const skillsDir = join(tmpRoot, ".claude", "skills");
    const skillSubdir = join(skillsDir, "logbook-auto-capture");
    const targetFile = join(skillSubdir, "SKILL.md");

    // Pre-condition: neither dir exists
    expect(existsSync(skillsDir)).toBe(false);

    const entry = await installer.install(artifact, ctx);

    // File must exist with correct body (byte-identical)
    expect(existsSync(targetFile)).toBe(true);
    const written = readFileSync(targetFile, "utf8");
    expect(written).toBe(artifact.body);

    // ManifestArtifact must record owned_file anchor with sha256
    expect(entry.anchor.type).toBe("owned_file");
    if (entry.anchor.type === "owned_file") {
      expect(entry.anchor.expected_sha256).toBeTruthy();
      expect(entry.anchor.expected_sha256.length).toBe(64); // hex sha256
    }

    // createdParentDirs must include both created dirs (shallowest first)
    expect(entry.createdParentDirs).toBeDefined();
    expect(entry.createdParentDirs).toContain(".claude/skills");
    expect(entry.createdParentDirs).toContain(".claude/skills/logbook-auto-capture");
  });

  it("uninstall removes SKILL.md AND both parent dirs (we created them)", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot);

    const skillsDir = join(tmpRoot, ".claude", "skills");
    const skillSubdir = join(skillsDir, "logbook-auto-capture");
    const targetFile = join(skillSubdir, "SKILL.md");

    const entry = await installer.install(artifact, ctx);
    expect(existsSync(targetFile)).toBe(true);

    const manifestWithEntry = makeManifest([entry]);
    const ctxWithEntry = makeCtx(tmpRoot, manifestWithEntry);

    await installer.uninstall(entry, ctxWithEntry);

    // File must be gone
    expect(existsSync(targetFile)).toBe(false);
    // Both parent dirs must be gone (we created them, they are now empty)
    expect(existsSync(skillSubdir)).toBe(false);
    expect(existsSync(skillsDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Install BOTH Skill files in sequence
// ---------------------------------------------------------------------------

describe("SkillInstaller — two files in sequence", () => {
  it("first install (SKILL.md) records both parent dirs; second install (reference.md) records no new dirs", async () => {
    const installer = getSkillInstaller();
    const artifactMain = makeSkillArtifact("SKILL.md");
    const artifactRef = makeSkillArtifact("reference.md");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    const entryMain = await installer.install(artifactMain, ctx);
    manifest.artifacts.push(entryMain);

    const entryRef = await installer.install(artifactRef, ctx);
    manifest.artifacts.push(entryRef);

    // First entry: both dirs recorded
    expect(entryMain.createdParentDirs).toContain(".claude/skills");
    expect(entryMain.createdParentDirs).toContain(".claude/skills/logbook-auto-capture");

    // Second entry: dirs pre-existed → no new dirs recorded
    expect(entryRef.createdParentDirs).toEqual([]);
  });

  it("uninstall BOTH in reverse: reference first (dirs remain), then SKILL.md (dirs cleaned)", async () => {
    const installer = getSkillInstaller();
    const artifactMain = makeSkillArtifact("SKILL.md");
    const artifactRef = makeSkillArtifact("reference.md");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    const entryMain = await installer.install(artifactMain, ctx);
    manifest.artifacts.push(entryMain);
    const entryRef = await installer.install(artifactRef, ctx);
    manifest.artifacts.push(entryRef);

    const skillsDir = join(tmpRoot, ".claude", "skills");
    const skillSubdir = join(skillsDir, "logbook-auto-capture");
    const mainFile = join(skillSubdir, "SKILL.md");
    const refFile = join(skillSubdir, "reference.md");

    // Uninstall reference first (reverse order)
    await installer.uninstall(entryRef, ctx);

    // reference.md gone, but SKILL.md still there → dirs remain
    expect(existsSync(refFile)).toBe(false);
    expect(existsSync(mainFile)).toBe(true);
    expect(existsSync(skillSubdir)).toBe(true);
    expect(existsSync(skillsDir)).toBe(true);

    // Uninstall SKILL.md
    await installer.uninstall(entryMain, ctx);

    // SKILL.md gone AND both dirs gone (now empty + we created them)
    expect(existsSync(mainFile)).toBe(false);
    expect(existsSync(skillSubdir)).toBe(false);
    expect(existsSync(skillsDir)).toBe(false);
  });

  it("byte-identity roundtrip: project state before install === project state after uninstall both files", async () => {
    const installer = getSkillInstaller();
    const artifactMain = makeSkillArtifact("SKILL.md");
    const artifactRef = makeSkillArtifact("reference.md");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    const skillsDir = join(tmpRoot, ".claude", "skills");

    // Capture pre-install state: .claude/skills/ must not exist
    expect(existsSync(skillsDir)).toBe(false);

    const entryMain = await installer.install(artifactMain, ctx);
    manifest.artifacts.push(entryMain);
    const entryRef = await installer.install(artifactRef, ctx);
    manifest.artifacts.push(entryRef);

    // Uninstall in reverse
    await installer.uninstall(entryRef, ctx);
    await installer.uninstall(entryMain, ctx);

    // Post-uninstall state must be byte-identical to pre-install (nothing left)
    expect(existsSync(skillsDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pre-existing .claude/skills/ with another plugin — coexistence
// ---------------------------------------------------------------------------

describe("SkillInstaller — coexistence with pre-existing .claude/skills/", () => {
  it("installs our Skill without touching other plugin; createdParentDirs excludes pre-existing .claude/skills/", async () => {
    const installer = getSkillInstaller();
    const artifactMain = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot);

    // Setup: pre-existing .claude/skills/ with another plugin
    const skillsDir = join(tmpRoot, ".claude", "skills");
    const otherPluginDir = join(skillsDir, "other-plugin");
    mkdirSync(otherPluginDir, { recursive: true });
    const otherFile = join(otherPluginDir, "SKILL.md");
    const otherContent = "---\nname: other-plugin\n---\nDoes other things.\n";
    writeFileSync(otherFile, otherContent, "utf8");

    const entry = await installer.install(artifactMain, ctx);

    // Our file must appear
    const ourFile = join(skillsDir, "logbook-auto-capture", "SKILL.md");
    expect(existsSync(ourFile)).toBe(true);
    expect(readFileSync(ourFile, "utf8")).toBe(artifactMain.body);

    // Other plugin file must be byte-identical
    expect(readFileSync(otherFile, "utf8")).toBe(otherContent);

    // createdParentDirs: .claude/skills/ pre-existed → NOT included;
    // only .claude/skills/logbook-auto-capture is newly created → included
    expect(entry.createdParentDirs).not.toContain(".claude/skills");
    expect(entry.createdParentDirs).toContain(".claude/skills/logbook-auto-capture");
  });

  it("uninstall: our files gone, our subdir removed, .claude/skills/ remains (other plugin still there)", async () => {
    const installer = getSkillInstaller();
    const artifactMain = makeSkillArtifact("SKILL.md");
    const artifactRef = makeSkillArtifact("reference.md");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    // Setup: pre-existing .claude/skills/ with another plugin
    const skillsDir = join(tmpRoot, ".claude", "skills");
    const otherPluginDir = join(skillsDir, "other-plugin");
    mkdirSync(otherPluginDir, { recursive: true });
    const otherFile = join(otherPluginDir, "SKILL.md");
    const otherContent = "---\nname: other-plugin\n---\nDoes other things.\n";
    writeFileSync(otherFile, otherContent, "utf8");

    const entryMain = await installer.install(artifactMain, ctx);
    manifest.artifacts.push(entryMain);
    const entryRef = await installer.install(artifactRef, ctx);
    manifest.artifacts.push(entryRef);

    // Uninstall in reverse
    await installer.uninstall(entryRef, ctx);
    await installer.uninstall(entryMain, ctx);

    // Our subdir removed
    const ourSubdir = join(skillsDir, "logbook-auto-capture");
    expect(existsSync(ourSubdir)).toBe(false);

    // .claude/skills/ REMAINS (other plugin still there)
    expect(existsSync(skillsDir)).toBe(true);

    // Other plugin untouched
    expect(readFileSync(otherFile, "utf8")).toBe(otherContent);
  });
});

// ---------------------------------------------------------------------------
// Hash mismatch: user modified SKILL.md post-install
// ---------------------------------------------------------------------------

describe("SkillInstaller — tamper detection (hash mismatch)", () => {
  it("verify returns hash_mismatch after the file is modified post-install", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);

    // Tamper: overwrite the file
    const targetFile = join(tmpRoot, ".claude", "skills", "logbook-auto-capture", "SKILL.md");
    writeFileSync(targetFile, "user modified this content\n", "utf8");

    const result = await installer.verify(entry, makeCtx(tmpRoot));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("uninstall skips deletion when sha256 does not match; file survives", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);
    const manifestWithEntry = makeManifest([entry]);

    // Tamper: overwrite the file
    const targetFile = join(tmpRoot, ".claude", "skills", "logbook-auto-capture", "SKILL.md");
    const tamperedContent = "user modified this content\n";
    writeFileSync(targetFile, tamperedContent, "utf8");

    // Uninstall must NOT throw — skips deletion silently
    const ctxWithEntry = makeCtx(tmpRoot, manifestWithEntry);
    await expect(installer.uninstall(entry, ctxWithEntry)).resolves.toBeUndefined();

    // File must still exist (not deleted)
    expect(existsSync(targetFile)).toBe(true);
    expect(readFileSync(targetFile, "utf8")).toBe(tamperedContent);
  });
});

// ---------------------------------------------------------------------------
// Pre-existing file with different content → occupied-by-other; install aborts
// ---------------------------------------------------------------------------

describe("SkillInstaller — conflict on occupied-by-other slot", () => {
  it("detect returns occupied-by-other when a file with different content exists at target path", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot); // empty manifest

    // Place a file with different content at the target path
    const skillSubdir = join(tmpRoot, ".claude", "skills", "logbook-auto-capture");
    mkdirSync(skillSubdir, { recursive: true });
    writeFileSync(join(skillSubdir, "SKILL.md"), "different content\n", "utf8");

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("occupied-by-other");
  });

  it("install throws ConflictError when another file occupies the target path", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot);

    // Place a file with different content
    const skillSubdir = join(tmpRoot, ".claude", "skills", "logbook-auto-capture");
    mkdirSync(skillSubdir, { recursive: true });
    writeFileSync(join(skillSubdir, "SKILL.md"), "different content\n", "utf8");

    await expect(installer.install(artifact, ctx)).rejects.toThrow(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// detect — occupied-by-logbook when manifest has matching entry
// ---------------------------------------------------------------------------

describe("SkillInstaller — detect", () => {
  it("detect returns occupied-by-logbook when manifest has matching entry", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");

    const fakeEntry: ManifestArtifact = {
      id: "lb-skill-auto-capture-main",
      kind: "skill",
      file_path: ".claude/skills/logbook-auto-capture/SKILL.md",
      anchor: { type: "owned_file", expected_sha256: "a".repeat(64) },
      content_hash: "b".repeat(64),
      installed_at: "2026-01-01T00:00:00.000Z",
    };
    const manifest = makeManifest([fakeEntry]);
    const ctx = makeCtx(tmpRoot, manifest);

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("occupied-by-logbook");
  });

  it("detect returns empty when manifest has no matching entry and file is absent", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot); // empty manifest, no file on disk

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("empty");
  });

  it("detect returns occupied-by-logbook after clean install", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    const entry = await installer.install(artifact, ctx);
    manifest.artifacts.push(entry);

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("occupied-by-logbook");
  });
});

// ---------------------------------------------------------------------------
// verify — ok after clean install
// ---------------------------------------------------------------------------

describe("SkillInstaller — verify", () => {
  it("verify returns ok after clean install", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);
    const result = await installer.verify(entry, makeCtx(tmpRoot));
    expect(result.ok).toBe(true);
  });

  it("verify returns file_missing when file is deleted", async () => {
    const installer = getSkillInstaller();
    const artifact = makeSkillArtifact("SKILL.md");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);
    await fs.unlink(join(tmpRoot, ".claude", "skills", "logbook-auto-capture", "SKILL.md"));

    const result = await installer.verify(entry, makeCtx(tmpRoot));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("file_missing");
  });
});

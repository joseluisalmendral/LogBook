/**
 * subagent-installer.test.ts — SubagentInstaller detect / install / uninstall / verify.
 *
 * Strict TDD (T2.5): written BEFORE the implementation.
 * RED state: SubagentInstaller not yet implemented → tests fail.
 *
 * Key invariants mirroring skill-installer.test.ts:
 * - Install single subagent → file exists, sha256 recorded, createdParentDirs tracks .claude/subagents/
 * - Uninstall → file gone + dir gone (if we created it)
 * - Pre-existing .claude/subagents/ with other plugin → install ours, uninstall leaves other intact
 * - File modified post-install → verify reports hash_mismatch; uninstall does NOT delete
 * - File at our path with different content → ConflictError on install
 * - Install BOTH subagents (curator + teacher) → 2 entries, byte-identity roundtrip
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
// Asset bodies
// ---------------------------------------------------------------------------

const ASSETS_SUBAGENTS = resolve(import.meta.dirname, "../../assets/subagents");

function readCuratorBody(): string {
  return readFileSync(resolve(ASSETS_SUBAGENTS, "logbook-curator.md"), "utf8");
}

function readTeacherBody(): string {
  return readFileSync(resolve(ASSETS_SUBAGENTS, "logbook-teacher.md"), "utf8");
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

type SubagentArtifact = Extract<Artifact, { kind: "subagent" }>;

function makeSubagentArtifact(
  name: "logbook-curator" | "logbook-teacher",
  opts?: { logbookId?: string }
): SubagentArtifact {
  const body = name === "logbook-curator" ? readCuratorBody() : readTeacherBody();
  const shortName = name === "logbook-curator" ? "curator" : "teacher";
  return {
    kind: "subagent",
    name,
    file_path: `.claude/subagents/${name}.md`,
    body,
    _logbookId: opts?.logbookId ?? `lb-agent-${shortName}`,
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
    `subagent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function getSubagentInstaller(): ArtifactInstaller<SubagentArtifact> {
  return getInstaller("subagent") as ArtifactInstaller<SubagentArtifact>;
}

// ---------------------------------------------------------------------------
// Install single subagent (curator)
// ---------------------------------------------------------------------------

describe("SubagentInstaller — single file lifecycle (curator)", () => {
  it("install creates .claude/subagents/ dir and logbook-curator.md with correct body", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    const subagentsDir = join(tmpRoot, ".claude", "subagents");
    const targetFile = join(subagentsDir, "logbook-curator.md");

    expect(existsSync(subagentsDir)).toBe(false);

    const entry = await installer.install(artifact, ctx);

    expect(existsSync(targetFile)).toBe(true);
    const written = readFileSync(targetFile, "utf8");
    expect(written).toBe(artifact.body);

    expect(entry.anchor.type).toBe("owned_file");
    if (entry.anchor.type === "owned_file") {
      expect(entry.anchor.expected_sha256).toBeTruthy();
      expect(entry.anchor.expected_sha256.length).toBe(64);
    }

    expect(entry.createdParentDirs).toBeDefined();
    expect(entry.createdParentDirs).toContain(".claude/subagents");
  });

  it("uninstall removes logbook-curator.md AND .claude/subagents/ dir (we created it)", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    const subagentsDir = join(tmpRoot, ".claude", "subagents");
    const targetFile = join(subagentsDir, "logbook-curator.md");

    const entry = await installer.install(artifact, ctx);
    expect(existsSync(targetFile)).toBe(true);

    const manifestWithEntry = makeManifest([entry]);
    const ctxWithEntry = makeCtx(tmpRoot, manifestWithEntry);

    await installer.uninstall(entry, ctxWithEntry);

    expect(existsSync(targetFile)).toBe(false);
    expect(existsSync(subagentsDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Install BOTH subagents
// ---------------------------------------------------------------------------

describe("SubagentInstaller — two files in sequence", () => {
  it("first install (curator) records .claude/subagents/ in createdParentDirs; second (teacher) records no new dirs", async () => {
    const installer = getSubagentInstaller();
    const artifactCurator = makeSubagentArtifact("logbook-curator");
    const artifactTeacher = makeSubagentArtifact("logbook-teacher");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    const entryCurator = await installer.install(artifactCurator, ctx);
    manifest.artifacts.push(entryCurator);

    const entryTeacher = await installer.install(artifactTeacher, ctx);
    manifest.artifacts.push(entryTeacher);

    expect(entryCurator.createdParentDirs).toContain(".claude/subagents");
    expect(entryTeacher.createdParentDirs).toEqual([]);
  });

  it("byte-identity roundtrip: uninstall both restores to pre-install state", async () => {
    const installer = getSubagentInstaller();
    const artifactCurator = makeSubagentArtifact("logbook-curator");
    const artifactTeacher = makeSubagentArtifact("logbook-teacher");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    const subagentsDir = join(tmpRoot, ".claude", "subagents");
    expect(existsSync(subagentsDir)).toBe(false);

    const entryCurator = await installer.install(artifactCurator, ctx);
    manifest.artifacts.push(entryCurator);
    const entryTeacher = await installer.install(artifactTeacher, ctx);
    manifest.artifacts.push(entryTeacher);

    // Uninstall in reverse order
    await installer.uninstall(entryTeacher, ctx);
    await installer.uninstall(entryCurator, ctx);

    expect(existsSync(subagentsDir)).toBe(false);
  });

  it("install curator records id lb-agent-curator; teacher records lb-agent-teacher", async () => {
    const installer = getSubagentInstaller();
    const artifactCurator = makeSubagentArtifact("logbook-curator");
    const artifactTeacher = makeSubagentArtifact("logbook-teacher");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    const entryCurator = await installer.install(artifactCurator, ctx);
    const entryTeacher = await installer.install(artifactTeacher, ctx);

    expect(entryCurator.id).toBe("lb-agent-curator");
    expect(entryCurator.file_path).toBe(".claude/subagents/logbook-curator.md");

    expect(entryTeacher.id).toBe("lb-agent-teacher");
    expect(entryTeacher.file_path).toBe(".claude/subagents/logbook-teacher.md");
  });
});

// ---------------------------------------------------------------------------
// Coexistence: pre-existing .claude/subagents/ with another plugin
// ---------------------------------------------------------------------------

describe("SubagentInstaller — coexistence with pre-existing .claude/subagents/", () => {
  it("installs our subagent without touching other plugin; createdParentDirs excludes pre-existing dir", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    // Pre-existing .claude/subagents/ with another plugin file
    const subagentsDir = join(tmpRoot, ".claude", "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    const otherFile = join(subagentsDir, "other-agent.md");
    const otherContent = "---\nname: other-agent\ndescription: Other plugin\ntools: other_tool\n---\nDoes other things.\n";
    writeFileSync(otherFile, otherContent, "utf8");

    const entry = await installer.install(artifact, ctx);

    // Our file must appear
    const ourFile = join(subagentsDir, "logbook-curator.md");
    expect(existsSync(ourFile)).toBe(true);
    expect(readFileSync(ourFile, "utf8")).toBe(artifact.body);

    // Other plugin file must be byte-identical
    expect(readFileSync(otherFile, "utf8")).toBe(otherContent);

    // .claude/subagents/ pre-existed → NOT in createdParentDirs
    expect(entry.createdParentDirs).not.toContain(".claude/subagents");
    expect(entry.createdParentDirs).toEqual([]);
  });

  it("uninstall: our file gone, .claude/subagents/ remains (other plugin still there)", async () => {
    const installer = getSubagentInstaller();
    const artifactCurator = makeSubagentArtifact("logbook-curator");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    // Pre-existing .claude/subagents/ with another plugin
    const subagentsDir = join(tmpRoot, ".claude", "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    const otherFile = join(subagentsDir, "other-agent.md");
    const otherContent = "---\nname: other-agent\ndescription: Other plugin\ntools: other_tool\n---\nDoes other things.\n";
    writeFileSync(otherFile, otherContent, "utf8");

    const entryCurator = await installer.install(artifactCurator, ctx);
    manifest.artifacts.push(entryCurator);

    await installer.uninstall(entryCurator, ctx);

    const ourFile = join(subagentsDir, "logbook-curator.md");
    expect(existsSync(ourFile)).toBe(false);

    // .claude/subagents/ REMAINS (other plugin still there)
    expect(existsSync(subagentsDir)).toBe(true);
    expect(readFileSync(otherFile, "utf8")).toBe(otherContent);
  });
});

// ---------------------------------------------------------------------------
// Hash mismatch: user modified file post-install
// ---------------------------------------------------------------------------

describe("SubagentInstaller — tamper detection (hash mismatch)", () => {
  it("verify returns hash_mismatch after the file is modified post-install", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);

    const targetFile = join(tmpRoot, ".claude", "subagents", "logbook-curator.md");
    writeFileSync(targetFile, "user modified this content\n", "utf8");

    const result = await installer.verify(entry, makeCtx(tmpRoot));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("uninstall skips deletion when sha256 does not match; file survives", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);

    const targetFile = join(tmpRoot, ".claude", "subagents", "logbook-curator.md");
    const tamperedContent = "user modified this content\n";
    writeFileSync(targetFile, tamperedContent, "utf8");

    const ctxWithEntry = makeCtx(tmpRoot, makeManifest([entry]));
    await expect(installer.uninstall(entry, ctxWithEntry)).resolves.toBeUndefined();

    expect(existsSync(targetFile)).toBe(true);
    expect(readFileSync(targetFile, "utf8")).toBe(tamperedContent);
  });
});

// ---------------------------------------------------------------------------
// Conflict: pre-existing file with different content
// ---------------------------------------------------------------------------

describe("SubagentInstaller — conflict on occupied-by-other slot", () => {
  it("detect returns occupied-by-other when a file with different content exists at target path", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    const subagentsDir = join(tmpRoot, ".claude", "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    const fixturePath = resolve(
      import.meta.dirname,
      "../fixtures/subagents/pre-existing-different.md"
    );
    writeFileSync(
      join(subagentsDir, "logbook-curator.md"),
      readFileSync(fixturePath, "utf8"),
      "utf8"
    );

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("occupied-by-other");
  });

  it("install throws ConflictError when another file occupies the target path", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    const subagentsDir = join(tmpRoot, ".claude", "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(join(subagentsDir, "logbook-curator.md"), "different content\n", "utf8");

    await expect(installer.install(artifact, ctx)).rejects.toThrow(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// detect — occupied-by-logbook when manifest has matching entry
// ---------------------------------------------------------------------------

describe("SubagentInstaller — detect", () => {
  it("detect returns occupied-by-logbook when manifest has matching entry", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");

    const fakeEntry: ManifestArtifact = {
      id: "lb-agent-curator",
      kind: "subagent",
      file_path: ".claude/subagents/logbook-curator.md",
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
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("empty");
  });

  it("detect returns occupied-by-logbook after clean install", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
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

describe("SubagentInstaller — verify", () => {
  it("verify returns ok after clean install", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);
    const result = await installer.verify(entry, makeCtx(tmpRoot));
    expect(result.ok).toBe(true);
  });

  it("verify returns file_missing when file is deleted", async () => {
    const installer = getSubagentInstaller();
    const artifact = makeSubagentArtifact("logbook-curator");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);
    await fs.unlink(join(tmpRoot, ".claude", "subagents", "logbook-curator.md"));

    const result = await installer.verify(entry, makeCtx(tmpRoot));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("file_missing");
  });
});

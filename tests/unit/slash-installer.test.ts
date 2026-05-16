/**
 * Tests for SlashCommandInstaller — detect / install / uninstall / verify.
 *
 * Strict TDD — this file was written BEFORE the implementation.
 * All tests must fail (RED) until slash.ts is implemented (GREEN).
 *
 * Invariants tested:
 * - Asset byte-length: all 8 slash files ≤ 120 bytes.
 * - Frontmatter presence: each file starts with "---\ndescription:" header.
 * - Lifecycle: empty dir → install creates dir + file; uninstall removes file + dir.
 * - Coexistence: pre-existing .claude/commands/ with other file → install adds ours;
 *     uninstall removes ours but leaves dir + other file intact.
 * - Conflict: file at our path with different content → detect returns occupied-by-other;
 *     install() throws ConflictError.
 * - Tamper: post-install edit → verify reports hash_mismatch; uninstall skips deletion.
 * - Bulk: install all 8 + uninstall all 8 → byte-identical to pre-install state.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
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
// Asset paths
// ---------------------------------------------------------------------------

const ASSETS_SLASH = resolve(import.meta.dirname, "../../assets/slash");

const SLASH_NAMES = [
  "lb-decision",
  "lb-error",
  "lb-fix",
  "lb-lesson",
  "lb-milestone",
  "lb-phase",
  "lb-review",
  "lb-status",
] as const;

type SlashName = (typeof SLASH_NAMES)[number];

function readSlashBody(name: SlashName): string {
  return readFileSync(resolve(ASSETS_SLASH, `${name}.md`), "utf8");
}

// ---------------------------------------------------------------------------
// Asset budget and format assertions
// ---------------------------------------------------------------------------

describe("T6 asset byte-length budget", () => {
  for (const name of SLASH_NAMES) {
    it(`${name}.md is ≤ 120 bytes`, () => {
      const content = readSlashBody(name);
      // length in JS is UTF-16 code units; for ASCII content this equals byte length.
      // We use Buffer.byteLength for correctness.
      expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(120);
    });
  }
});

describe("T6 asset frontmatter format", () => {
  for (const name of SLASH_NAMES) {
    it(`${name}.md has valid frontmatter with description`, () => {
      const content = readSlashBody(name);
      // Must start with --- and have a description field before the closing ---
      expect(content.startsWith("---\ndescription:")).toBe(true);
      // Must have closing --- after the description
      const lines = content.split("\n");
      expect(lines[0]).toBe("---");
      expect(lines[1]).toMatch(/^description: .+/);
      // Find the closing ---
      const closingIdx = lines.findIndex((l, i) => i > 0 && l === "---");
      expect(closingIdx).toBeGreaterThan(1);
      // Body after closing --- must not be empty
      const bodyLines = lines.slice(closingIdx + 1).filter((l) => l.trim().length > 0);
      expect(bodyLines.length).toBeGreaterThan(0);
    });
  }
});

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

function makeSlashArtifact(
  name: SlashName,
  opts?: { logbookId?: string }
): Extract<Artifact, { kind: "slash_command" }> {
  const body = readSlashBody(name);
  return {
    kind: "slash_command",
    name,
    file_path: `.claude/commands/${name}.md`,
    body,
    _logbookId: opts?.logbookId ?? `lb-cmd-${name}`,
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
  // Create a fresh tmp project root for each test
  tmpRoot = resolve(tmpdir(), `slash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  // Clean up tmp dir after each test
  rmSync(tmpRoot, { recursive: true, force: true });
});

function getSlashInstaller(): ArtifactInstaller<Extract<Artifact, { kind: "slash_command" }>> {
  return getInstaller("slash_command") as ArtifactInstaller<
    Extract<Artifact, { kind: "slash_command" }>
  >;
}

// ---------------------------------------------------------------------------
// Empty .claude/commands/ → install creates dir + file; uninstall removes both
// ---------------------------------------------------------------------------

describe("SlashCommandInstaller — empty dir lifecycle", () => {
  it("install creates .claude/commands/ dir and the slash file", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    const commandsDir = join(tmpRoot, ".claude", "commands");
    const targetFile = join(tmpRoot, ".claude", "commands", "lb-decision.md");

    // Pre-condition: dir does not exist
    expect(existsSync(commandsDir)).toBe(false);

    const entry = await installer.install(artifact, ctx);

    // File must exist with the expected body
    expect(existsSync(targetFile)).toBe(true);
    const written = readFileSync(targetFile, "utf8");
    expect(written).toBe(artifact.body);

    // ManifestArtifact must record the owned_file anchor with expected_sha256
    expect(entry.anchor.type).toBe("owned_file");
    if (entry.anchor.type === "owned_file") {
      expect(entry.anchor.expected_sha256).toBeTruthy();
      expect(entry.anchor.expected_sha256.length).toBe(64); // hex sha256
    }

    // createdParentDirs must record ".claude/commands"
    expect(entry.createdParentDirs).toBeDefined();
    expect(entry.createdParentDirs).toContain(".claude/commands");
  });

  it("uninstall removes the file and the created .claude/commands/ dir", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    const commandsDir = join(tmpRoot, ".claude", "commands");

    const entry = await installer.install(artifact, ctx);
    // Ensure the dir was created
    expect(existsSync(commandsDir)).toBe(true);

    // Add entry to manifest for uninstall context
    const manifestWithEntry = makeManifest([entry]);
    const ctxWithEntry = makeCtx(tmpRoot, manifestWithEntry);

    await installer.uninstall(entry, ctxWithEntry);

    // File must be gone
    expect(existsSync(join(tmpRoot, ".claude", "commands", "lb-decision.md"))).toBe(false);
    // Dir must be gone (we created it, now it's empty)
    expect(existsSync(commandsDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pre-existing .claude/commands/ with another file → install adds ours; uninstall leaves dir
// ---------------------------------------------------------------------------

describe("SlashCommandInstaller — coexistence with pre-existing dir", () => {
  it("install adds our file without removing the other file; createdParentDirs is empty", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    // Setup: create .claude/commands/ with a pre-existing file
    const commandsDir = join(tmpRoot, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    const otherFile = join(commandsDir, "other-plugin.md");
    const otherContent = "---\ndescription: Other plugin\n---\nDo other things.\n";
    writeFileSync(otherFile, otherContent, "utf8");

    const entry = await installer.install(artifact, ctx);

    // Our file must appear
    const targetFile = join(commandsDir, "lb-decision.md");
    expect(existsSync(targetFile)).toBe(true);
    expect(readFileSync(targetFile, "utf8")).toBe(artifact.body);

    // Other file must be byte-identical
    expect(readFileSync(otherFile, "utf8")).toBe(otherContent);

    // createdParentDirs must be empty (dir already existed)
    expect(entry.createdParentDirs).toEqual([]);
  });

  it("uninstall removes our file but leaves dir and other file intact", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    const commandsDir = join(tmpRoot, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    const otherFile = join(commandsDir, "other-plugin.md");
    const otherContent = "---\ndescription: Other plugin\n---\nDo other things.\n";
    writeFileSync(otherFile, otherContent, "utf8");

    const entry = await installer.install(artifact, ctx);
    const manifestWithEntry = makeManifest([entry]);
    const ctxWithEntry = makeCtx(tmpRoot, manifestWithEntry);

    await installer.uninstall(entry, ctxWithEntry);

    // Our file gone
    expect(existsSync(join(commandsDir, "lb-decision.md"))).toBe(false);
    // Dir must survive (other file still there)
    expect(existsSync(commandsDir)).toBe(true);
    // Other file must be byte-identical
    expect(readFileSync(otherFile, "utf8")).toBe(otherContent);
  });
});

// ---------------------------------------------------------------------------
// detect — occupied-by-logbook when manifest has matching entry
// ---------------------------------------------------------------------------

describe("SlashCommandInstaller — detect", () => {
  it("detect returns occupied-by-logbook when manifest has matching entry", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");

    // Simulate a pre-installed entry in the manifest
    const fakeEntry: ManifestArtifact = {
      id: "lb-cmd-lb-decision",
      kind: "slash_command",
      file_path: ".claude/commands/lb-decision.md",
      anchor: { type: "owned_file", expected_sha256: "a".repeat(64) },
      content_hash: "b".repeat(64),
      installed_at: "2026-01-01T00:00:00.000Z",
    };
    const manifest = makeManifest([fakeEntry]);
    const ctx = makeCtx(tmpRoot, manifest);

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("occupied-by-logbook");
  });

  it("detect returns empty when manifest has no matching entry and file absent", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("empty");
  });

  it("detect returns occupied-by-other when file exists at path with different content", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot); // empty manifest

    // Place a file with different content at the target path
    const commandsDir = join(tmpRoot, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, "lb-decision.md"),
      "different content not ours\n",
      "utf8"
    );

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("occupied-by-other");
  });

  it("detect returns occupied-by-logbook when file exists with matching sha256 and manifest entry matches", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot); // empty manifest — install first

    // Install to get the real entry
    const entry = await installer.install(artifact, ctx);

    // Now build a manifest containing that entry
    const manifest = makeManifest([entry]);
    const ctx2 = makeCtx(tmpRoot, manifest);

    const result = await installer.detect(artifact, ctx2);
    expect(result.status).toBe("occupied-by-logbook");
  });
});

// ---------------------------------------------------------------------------
// Conflict: file at our path with different content → install throws ConflictError
// ---------------------------------------------------------------------------

describe("SlashCommandInstaller — conflict on occupied-by-other slot", () => {
  it("install throws ConflictError when another file occupies the target path", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    // Place a file with different content
    const commandsDir = join(tmpRoot, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, "lb-decision.md"),
      "different content not ours\n",
      "utf8"
    );

    await expect(installer.install(artifact, ctx)).rejects.toThrow(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// Tamper: user modifies file post-install → verify hash_mismatch; uninstall skips
// ---------------------------------------------------------------------------

describe("SlashCommandInstaller — tamper detection", () => {
  it("verify returns hash_mismatch after the file is modified post-install", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);

    // Tamper: overwrite the file
    const targetFile = join(tmpRoot, ".claude", "commands", "lb-decision.md");
    writeFileSync(targetFile, "user modified this\n", "utf8");

    const result = await installer.verify(entry, makeCtx(tmpRoot));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("verify returns file_missing when the file is deleted", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);

    // Remove the file
    await fs.unlink(join(tmpRoot, ".claude", "commands", "lb-decision.md"));

    const result = await installer.verify(entry, makeCtx(tmpRoot));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("file_missing");
  });

  it("uninstall skips deletion when sha256 does not match (hash_mismatch); file survives", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);
    const manifestWithEntry = makeManifest([entry]);

    // Tamper: overwrite the file
    const targetFile = join(tmpRoot, ".claude", "commands", "lb-decision.md");
    const tamperedContent = "user modified this\n";
    writeFileSync(targetFile, tamperedContent, "utf8");

    // Uninstall should NOT throw — it should skip deletion silently
    const ctxWithEntry = makeCtx(tmpRoot, manifestWithEntry);
    await expect(installer.uninstall(entry, ctxWithEntry)).resolves.toBeUndefined();

    // File must still exist (we did not delete it)
    expect(existsSync(targetFile)).toBe(true);
    expect(readFileSync(targetFile, "utf8")).toBe(tamperedContent);
  });
});

// ---------------------------------------------------------------------------
// verify — ok after clean install
// ---------------------------------------------------------------------------

describe("SlashCommandInstaller — verify", () => {
  it("verify returns ok after clean install", async () => {
    const installer = getSlashInstaller();
    const artifact = makeSlashArtifact("lb-decision");
    const ctx = makeCtx(tmpRoot);

    const entry = await installer.install(artifact, ctx);
    const result = await installer.verify(entry, makeCtx(tmpRoot));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bulk install + uninstall of all 8 slash commands
// ---------------------------------------------------------------------------

describe("SlashCommandInstaller — bulk install/uninstall all 8", () => {
  it("installs all 8 slash files; manifest has 8 entries; .claude/commands/ created once", async () => {
    const installer = getSlashInstaller();
    const commandsDir = join(tmpRoot, ".claude", "commands");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    const entries: ManifestArtifact[] = [];
    for (const name of SLASH_NAMES) {
      const artifact = makeSlashArtifact(name);
      const entry = await installer.install(artifact, ctx);
      manifest.artifacts.push(entry);
      entries.push(entry);
    }

    expect(entries.length).toBe(8);
    expect(existsSync(commandsDir)).toBe(true);

    for (const name of SLASH_NAMES) {
      expect(existsSync(join(commandsDir, `${name}.md`))).toBe(true);
    }
  });

  it("uninstalls all 8 in reverse; all files gone; .claude/commands/ gone (we created it)", async () => {
    const installer = getSlashInstaller();
    const commandsDir = join(tmpRoot, ".claude", "commands");
    const manifest = makeManifest();
    const ctx = makeCtx(tmpRoot, manifest);

    const entries: ManifestArtifact[] = [];
    for (const name of SLASH_NAMES) {
      const artifact = makeSlashArtifact(name);
      const entry = await installer.install(artifact, ctx);
      manifest.artifacts.push(entry);
      entries.push(entry);
    }

    // Uninstall in reverse
    for (const entry of [...entries].reverse()) {
      await installer.uninstall(entry, ctx);
    }

    // All files gone
    for (const name of SLASH_NAMES) {
      expect(existsSync(join(commandsDir, `${name}.md`))).toBe(false);
    }
    // Dir gone (we created it and all files are removed)
    expect(existsSync(commandsDir)).toBe(false);
  });
});

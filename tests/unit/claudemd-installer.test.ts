/**
 * Tests for ClaudeMdAugmentInstaller — detect / install / uninstall / verify.
 *
 * Strict TDD — this file was written BEFORE the implementation.
 * All tests must fail (RED) until claudemd.ts is implemented (GREEN).
 *
 * Invariants tested:
 * - Token budget: augment body ≤ 240 chars (chars/4 heuristic ≤ 60 tokens).
 * - Byte-identity: every fixture roundtrips through install+uninstall unchanged.
 * - CRLF: install on CRLF CLAUDE.md fixture produces all-CRLF output; uninstall restores original.
 * - Empty file (absent): install creates file; uninstall deletes it when createdFile=true.
 * - detect: manifest-based occupied-by-logbook vs empty vs occupied-by-other (orphan block).
 * - verify: ok / hash_mismatch / file_missing / anchor_missing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
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
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLAUDEMD_FIXTURES = resolve(import.meta.dirname, "../fixtures/claudemd");
const CRLF_FIXTURES = resolve(import.meta.dirname, "../fixtures/crlf");
const ASSETS_CLAUDEMD = resolve(import.meta.dirname, "../../assets/claudemd");

function readFixture(dir: string, name: string): Buffer {
  return readFileSync(resolve(dir, name));
}

// ---------------------------------------------------------------------------
// Token budget assertion (T5 requirement)
// ---------------------------------------------------------------------------

describe("T5 token budget", () => {
  it("augment body is ≤ 240 chars (chars/4 ≤ 60 tokens)", () => {
    const body = readFileSync(resolve(ASSETS_CLAUDEMD, "augment.md"), "utf8").trim();
    // The body is trimmed (no leading/trailing whitespace) for the token budget check.
    expect(body.length).toBeLessThanOrEqual(240);
  });
});

// ---------------------------------------------------------------------------
// Test context factory
// ---------------------------------------------------------------------------

function makeManifest(artifacts: ManifestArtifact[] = []): Manifest {
  return {
    version: 1,
    installed_at: "2026-01-01T00:00:00.000Z",
    preset: "minimal",
    artifacts,
    backups: [],
  };
}

function makeClaudeMdArtifact(filePath = "CLAUDE.md"): Extract<Artifact, { kind: "augment_claudemd" }> {
  const body = readFileSync(resolve(ASSETS_CLAUDEMD, "augment.md"), "utf8").trim();
  return {
    kind: "augment_claudemd",
    file_path: filePath,
    block_content: body,
    _logbookId: "lb-claudemd-001",
  };
}

function makeContext(projectRoot: string, manifest: Manifest = makeManifest()): InstallContext {
  return {
    projectRoot,
    preset: "minimal",
    manifest,
    backups: new Map(),
    dryRun: false,
    now: () => "2026-01-01T00:00:00.000Z",
    ulid: () => "01JTEST000000000000000001",
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
// Test harness
// ---------------------------------------------------------------------------

let tmpDir: string;
let installer: ArtifactInstaller;

beforeEach(() => {
  clearRegistry();
  _resetBootstrapFlag();
  bootstrapClaudeCodeInstallers();
  installer = getInstaller("augment_claudemd");
  tmpDir = resolve(tmpdir(), `logbook-claudemd-test-${process.pid}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Helper: copy fixture to tmpDir and return abs path to the file
function setupFixture(fixtureDir: string, fixtureName: string, targetName = "CLAUDE.md"): { absPath: string; original: Buffer } {
  const original = readFixture(fixtureDir, fixtureName);
  const absPath = resolve(tmpDir, targetName);
  writeFileSync(absPath, original);
  return { absPath, original };
}

// ---------------------------------------------------------------------------
// detect() tests
// ---------------------------------------------------------------------------

describe("ClaudeMdAugmentInstaller — detect()", () => {
  it("returns empty when manifest has no matching entry", async () => {
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);
    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("empty");
  });

  it("returns occupied-by-logbook when manifest has matching _logbookId", async () => {
    const artifact = makeClaudeMdArtifact();
    const existingEntry: ManifestArtifact = {
      id: "lb-claudemd-001",
      kind: "augment_claudemd",
      file_path: "CLAUDE.md",
      anchor: {
        type: "markdown_block",
        start_marker: "<!-- logbook:generated start v=1 -->",
        end_marker: "<!-- logbook:generated end -->",
      },
      content_hash: "abc123",
      installed_at: "2026-01-01T00:00:00.000Z",
    };
    const ctx = makeContext(tmpDir, makeManifest([existingEntry]));
    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("occupied-by-logbook");
    if (result.status === "occupied-by-logbook") {
      expect(result.existing.id).toBe("lb-claudemd-001");
    }
  });

  it("returns occupied-by-other with orphan-logbook-block fingerprint when block exists but no manifest entry", async () => {
    // Set up a CLAUDE.md with our marker block but no manifest entry
    const orphanContent = `# Project\n\n<!-- logbook:generated start v=1 -->\nsome old content\n<!-- logbook:generated end -->\n`;
    writeFileSync(resolve(tmpDir, "CLAUDE.md"), orphanContent, "utf8");

    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir, makeManifest([]));
    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("occupied-by-other");
    if (result.status === "occupied-by-other") {
      expect(result.fingerprint).toBe("orphan-logbook-block");
    }
  });
});

// ---------------------------------------------------------------------------
// install + uninstall byte-identity per LF fixture
// ---------------------------------------------------------------------------

describe("ClaudeMdAugmentInstaller — LF fixtures", () => {
  it("empty.md: install creates block; uninstall leaves empty file", async () => {
    const { absPath, original } = setupFixture(CLAUDEMD_FIXTURES, "empty.md");
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    // Install
    const entry = await installer.install(artifact, ctx);
    const afterInstall = readFileSync(absPath, "utf8");

    // Block markers and body must be present
    expect(afterInstall).toContain("<!-- logbook:generated start v=1 -->");
    expect(afterInstall).toContain("<!-- logbook:generated end -->");
    expect(afterInstall).toContain(artifact.block_content);

    // Uninstall
    ctx.manifest.artifacts.push(entry);
    await installer.uninstall(entry, ctx);

    const afterUninstall = readFileSync(absPath);
    // Byte-identical to original (empty file = 0 bytes)
    expect(afterUninstall).toEqual(original);
  });

  it("with-content.md: install appends block; uninstall restores exact bytes", async () => {
    const { absPath, original } = setupFixture(CLAUDEMD_FIXTURES, "with-content.md");
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    const afterInstall = readFileSync(absPath, "utf8");

    expect(afterInstall).toContain("<!-- logbook:generated start v=1 -->");
    expect(afterInstall).toContain(artifact.block_content);
    // Original content must still be present
    expect(afterInstall).toContain("# Project");
    expect(afterInstall).toContain("Some user content.");

    ctx.manifest.artifacts.push(entry);
    await installer.uninstall(entry, ctx);

    const afterUninstall = readFileSync(absPath);
    expect(afterUninstall).toEqual(original);
  });

  it("with-block-from-iter3.md: install replaces existing block (mode=replaced); uninstall removes block leaving outer content intact", async () => {
    const { absPath, original } = setupFixture(CLAUDEMD_FIXTURES, "with-block-from-iter3.md");
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    const afterInstall = readFileSync(absPath, "utf8");

    // Block must contain our new content
    expect(afterInstall).toContain("<!-- logbook:generated start v=1 -->");
    expect(afterInstall).toContain(artifact.block_content);
    // OLD block content (from iter3 placeholder) must NOT be present
    expect(afterInstall).not.toContain("iter3-placeholder-content");

    // Uninstall removes the block — outer content preserved but NOT the previous block content
    ctx.manifest.artifacts.push(entry);
    await installer.uninstall(entry, ctx);

    const afterUninstall = readFileSync(absPath, "utf8");
    expect(afterUninstall).not.toContain("<!-- logbook:generated start v=1 -->");
    // The header line must still be there
    expect(afterUninstall).toContain("# Project");
  });
});

// ---------------------------------------------------------------------------
// CRLF fixture
// ---------------------------------------------------------------------------

describe("ClaudeMdAugmentInstaller — CRLF fixture", () => {
  it("CRLF CLAUDE.md: install produces all-CRLF output; uninstall restores original bytes", async () => {
    const { absPath, original } = setupFixture(CRLF_FIXTURES, "CLAUDE.md");
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    expect(entry.detectedLineEnding).toBe("crlf");

    const afterInstall = readFileSync(absPath, "utf8");
    // Should contain CRLF sequences — no lone LF newlines
    expect(afterInstall).toContain("\r\n");
    expect(afterInstall).not.toMatch(/(?<!\r)\n/);

    ctx.manifest.artifacts.push(entry);
    await installer.uninstall(entry, ctx);

    const afterUninstall = readFileSync(absPath);
    expect(afterUninstall).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// File-absent scenario
// ---------------------------------------------------------------------------

describe("ClaudeMdAugmentInstaller — file absent", () => {
  it("creates CLAUDE.md when file is missing; uninstall deletes the file (createdFile=true)", async () => {
    // No CLAUDE.md in tmpDir
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    expect(entry.anchor.type).toBe("markdown_block");
    // createdFile should be tracked in the anchor flags
    expect((entry.anchor as Record<string, unknown>)["createdFile"]).toBe(true);

    const claudeMdPath = resolve(tmpDir, "CLAUDE.md");
    expect(existsSync(claudeMdPath)).toBe(true);

    const content = readFileSync(claudeMdPath, "utf8");
    expect(content).toContain("<!-- logbook:generated start v=1 -->");
    expect(content).toContain(artifact.block_content);

    // Uninstall: deletes the file since we created it
    ctx.manifest.artifacts.push(entry);
    await installer.uninstall(entry, ctx);
    expect(existsSync(claudeMdPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verify() tests
// ---------------------------------------------------------------------------

describe("ClaudeMdAugmentInstaller — verify()", () => {
  it("returns ok:true after a clean install", async () => {
    const { absPath } = setupFixture(CLAUDEMD_FIXTURES, "with-content.md");
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    ctx.manifest.artifacts.push(entry);

    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(true);
  });

  it("returns hash_mismatch when block content is manually edited", async () => {
    const { absPath } = setupFixture(CLAUDEMD_FIXTURES, "with-content.md");
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    ctx.manifest.artifacts.push(entry);

    // Manually edit the block content
    const content = readFileSync(absPath, "utf8");
    const tampered = content.replace(artifact.block_content, "tampered content here");
    writeFileSync(absPath, tampered, "utf8");

    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("returns ok:true when content outside the markers is manually edited", async () => {
    const { absPath } = setupFixture(CLAUDEMD_FIXTURES, "with-content.md");
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    ctx.manifest.artifacts.push(entry);

    // Edit content outside the markers
    const content = readFileSync(absPath, "utf8");
    const edited = "# Modified Header\n\n" + content;
    writeFileSync(absPath, edited, "utf8");

    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(true);
  });

  it("returns file_missing when CLAUDE.md is deleted", async () => {
    const { absPath } = setupFixture(CLAUDEMD_FIXTURES, "with-content.md");
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    ctx.manifest.artifacts.push(entry);

    unlinkSync(absPath);

    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("file_missing");
  });

  it("returns anchor_missing when the block markers are removed", async () => {
    const { absPath } = setupFixture(CLAUDEMD_FIXTURES, "with-content.md");
    const artifact = makeClaudeMdArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    ctx.manifest.artifacts.push(entry);

    // Remove the block manually
    const content = readFileSync(absPath, "utf8");
    const stripped = content
      .replace(/<!-- logbook:generated start v=1 -->[\s\S]*?<!-- logbook:generated end -->\n?/, "");
    writeFileSync(absPath, stripped, "utf8");

    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("anchor_missing");
  });
});

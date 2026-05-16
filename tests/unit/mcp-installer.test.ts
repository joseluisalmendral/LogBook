/**
 * Tests for MCPServerInstaller — detect / install / uninstall / verify.
 *
 * Strict TDD — this file was written BEFORE the implementation.
 * All tests must fail (RED) until mcp.ts is implemented (GREEN).
 *
 * Invariants tested:
 * - Byte-identity: every fixture roundtrips through install+uninstall unchanged.
 * - CRLF: install on CRLF fixture produces all-CRLF output; uninstall restores original bytes.
 * - Controlled re-serialize: fixtures without mcpServers key use JSON.parse+stringify path.
 * - detect: manifest-based occupied-by-logbook vs empty.
 * - verify: ok / hash_mismatch / file_missing / anchor_missing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
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
import type { InstallContext } from "../../src/connectors/claude-code/artifacts/installer.js";
import type { Manifest, ManifestArtifact } from "../../src/types/manifest.js";
import type { Artifact } from "../../src/types/artifact.js";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MCP_JSON_FIXTURES = resolve(import.meta.dirname, "../fixtures/mcp-json");
const CRLF_FIXTURES = resolve(import.meta.dirname, "../fixtures/crlf");

function readFixture(dir: string, name: string): string {
  return readFileSync(resolve(dir, name), "utf8");
}

/** Canonical logbook MCP entry — the value we expect in the file after install. */
const LOGBOOK_MCP_KEY = "logbook-mcp";
const LOGBOOK_MCP_ID = "lb-mcp-001";

/** Placeholder absolute path used in tests (T7 produces the real bundle). */
const MCP_SERVER_PATH = "/abs/dist/mcp/server.cjs";

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

function makeMcpArtifact(): Extract<Artifact, { kind: "mcp_server" }> {
  return {
    kind: "mcp_server",
    name: LOGBOOK_MCP_KEY,
    command: "node",
    args: [MCP_SERVER_PATH],
    _logbookId: LOGBOOK_MCP_ID,
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
    ulid: () => "01HZZZZZZZZZZZZZZZZZZZZZZ",
    paths: {
      projectRoot,
      dotLogbook: join(projectRoot, ".logbook"),
      state: join(projectRoot, ".logbook", "state.json"),
      manifest: join(projectRoot, ".logbook", "manifest.json"),
      backups: join(projectRoot, ".logbook", "backups"),
      events: join(projectRoot, "logbook", "events.jsonl"),
      sessions: join(projectRoot, "logbook", "sessions.jsonl"),
      decisions: join(projectRoot, "logbook", "decisions"),
    } as unknown as import("../../src/core/paths.js").ProjectPaths,
  };
}

// ---------------------------------------------------------------------------
// Temp directory setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  clearRegistry();
  _resetBootstrapFlag();
  bootstrapClaudeCodeInstallers();
  tmpDir = resolve(tmpdir(), `mcp-installer-test-${process.pid}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(join(tmpDir, ".claude"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function mcpJsonPath(): string {
  return join(tmpDir, ".claude", "mcp.json");
}

function copyFixture(dir: string, name: string): string {
  const content = readFixture(dir, name);
  writeFileSync(mcpJsonPath(), content, "utf8");
  return content;
}

// ---------------------------------------------------------------------------
// Helper: get MCPServerInstaller from registry
// ---------------------------------------------------------------------------

function getMcpInstaller() {
  return getInstaller("mcp_server");
}

// ---------------------------------------------------------------------------
// Install + uninstall byte-identity tests per fixture
// ---------------------------------------------------------------------------

describe("MCPServerInstaller — byte-identity roundtrips", () => {
  const LF_FIXTURES = [
    "empty.json",
    "with-other-mcp-server.json",
    "with-two-other-servers.json",
    "tabs-indent.json",
    "weird-formatting.json",
  ];

  for (const fixtureName of LF_FIXTURES) {
    it(`roundtrips ${fixtureName} byte-identically`, async () => {
      const original = copyFixture(MCP_JSON_FIXTURES, fixtureName);
      const installer = getMcpInstaller();
      const artifact = makeMcpArtifact();
      const ctx = makeContext(tmpDir);

      // Install
      const entry = await installer.install(artifact, ctx);
      const afterInstall = await fs.readFile(mcpJsonPath(), "utf8");

      // logbook-mcp key must be present
      const parsed = JSON.parse(afterInstall) as { mcpServers: Record<string, unknown> };
      expect(parsed.mcpServers[LOGBOOK_MCP_KEY]).toBeDefined();
      const installedEntry = parsed.mcpServers[LOGBOOK_MCP_KEY] as Record<string, unknown>;
      expect(installedEntry["_logbookId"]).toBe(LOGBOOK_MCP_ID);

      // detectedLineEnding must be populated
      expect(entry.detectedLineEnding).toBe("lf");

      // Uninstall
      const manifestWithEntry = makeManifest([entry]);
      const ctxWithManifest = makeContext(tmpDir, manifestWithEntry);
      await installer.uninstall(entry, ctxWithManifest);
      const afterUninstall = await fs.readFile(mcpJsonPath(), "utf8");

      // Byte-identical to original
      expect(afterUninstall).toBe(original);
    });
  }

  it("roundtrips CRLF mcp.json fixture byte-identically", async () => {
    // Copy CRLF fixture
    const original = readFixture(CRLF_FIXTURES, "mcp.json");
    writeFileSync(mcpJsonPath(), original, "utf8");

    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    // Install
    const entry = await installer.install(artifact, ctx);
    const afterInstall = await fs.readFile(mcpJsonPath(), "utf8");

    // Must still be CRLF throughout
    expect(afterInstall).not.toMatch(/(?<!\r)\n/); // no lone LF
    expect(afterInstall).toMatch(/\r\n/); // has CRLF

    // logbook-mcp must be present
    const normalized = afterInstall.replace(/\r\n/g, "\n");
    const parsed = JSON.parse(normalized) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers[LOGBOOK_MCP_KEY]).toBeDefined();

    // detectedLineEnding must be crlf
    expect(entry.detectedLineEnding).toBe("crlf");

    // Uninstall
    const manifestWithEntry = makeManifest([entry]);
    const ctxWithManifest = makeContext(tmpDir, manifestWithEntry);
    await installer.uninstall(entry, ctxWithManifest);
    const afterUninstall = await fs.readFile(mcpJsonPath(), "utf8");

    // Byte-identical to original CRLF file
    expect(afterUninstall).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Special case: file missing entirely
// ---------------------------------------------------------------------------

describe("MCPServerInstaller — file missing", () => {
  it("install creates .claude/mcp.json with mcpServers key", async () => {
    // Do NOT copy a fixture — file is absent
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    const content = await fs.readFile(mcpJsonPath(), "utf8");
    const parsed = JSON.parse(content) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers[LOGBOOK_MCP_KEY]).toBeDefined();
    expect(entry.kind).toBe("mcp_server");
  });

  it("uninstall deletes the file when install created it from scratch", async () => {
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    expect(existsSync(mcpJsonPath())).toBe(true);

    // Mark that we created the file entirely
    const manifestWithEntry = makeManifest([entry]);
    const ctxWithManifest = makeContext(tmpDir, manifestWithEntry);
    await installer.uninstall(entry, ctxWithManifest);

    // File should be gone (we created it from nothing)
    expect(existsSync(mcpJsonPath())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Special case: file has {} (no mcpServers key) — controlled re-serialize
// ---------------------------------------------------------------------------

describe("MCPServerInstaller — file has {} (no mcpServers key)", () => {
  it("install injects mcpServers structure", async () => {
    writeFileSync(mcpJsonPath(), "{}", "utf8");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    const content = await fs.readFile(mcpJsonPath(), "utf8");
    const parsed = JSON.parse(content) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers[LOGBOOK_MCP_KEY]).toBeDefined();

    // createdMcpServersKey must be recorded in the manifest entry anchor
    expect((entry.anchor as Record<string, unknown>)["createdMcpServersKey"]).toBe(true);
  });

  it("uninstall removes mcpServers key when we created it, restoring to {}", async () => {
    writeFileSync(mcpJsonPath(), "{}", "utf8");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    const manifestWithEntry = makeManifest([entry]);
    const ctxWithManifest = makeContext(tmpDir, manifestWithEntry);
    await installer.uninstall(entry, ctxWithManifest);

    const content = await fs.readFile(mcpJsonPath(), "utf8");
    // Should be {} or equivalent (controlled re-serialize may produce formatted output)
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(Object.keys(parsed)).not.toContain("mcpServers");
  });
});

// ---------------------------------------------------------------------------
// Special case: file has top-level keys but no mcpServers — controlled re-serialize
// ---------------------------------------------------------------------------

describe("MCPServerInstaller — file has other top-level keys, no mcpServers", () => {
  it("install injects mcpServers key (controlled re-serialize path, documented T4.D2)", async () => {
    const original = JSON.stringify({ otherKey: "value" }, null, 2) + "\n";
    writeFileSync(mcpJsonPath(), original, "utf8");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    const content = await fs.readFile(mcpJsonPath(), "utf8");
    const parsed = JSON.parse(content) as { mcpServers: Record<string, unknown>; otherKey: string };

    // logbook-mcp injected
    expect(parsed.mcpServers[LOGBOOK_MCP_KEY]).toBeDefined();
    // other key preserved
    expect(parsed.otherKey).toBe("value");
    // createdMcpServersKey recorded
    expect((entry.anchor as Record<string, unknown>)["createdMcpServersKey"]).toBe(true);
  });

  it("uninstall removes mcpServers key when we created it", async () => {
    const original = JSON.stringify({ otherKey: "value" }, null, 2) + "\n";
    writeFileSync(mcpJsonPath(), original, "utf8");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    const manifestWithEntry = makeManifest([entry]);
    const ctxWithManifest = makeContext(tmpDir, manifestWithEntry);
    await installer.uninstall(entry, ctxWithManifest);

    const content = await fs.readFile(mcpJsonPath(), "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    // mcpServers removed
    expect(Object.keys(parsed)).not.toContain("mcpServers");
    // otherKey preserved
    expect(parsed["otherKey"]).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// Detect tests
// ---------------------------------------------------------------------------

describe("MCPServerInstaller — detect", () => {
  it("returns 'empty' when manifest has no matching entry", async () => {
    copyFixture(MCP_JSON_FIXTURES, "with-other-mcp-server.json");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir, makeManifest([]));

    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("empty");
  });

  it("returns 'occupied-by-logbook' when manifest has matching entry", async () => {
    copyFixture(MCP_JSON_FIXTURES, "with-other-mcp-server.json");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    // Install first to get a real entry
    const entry = await installer.install(artifact, ctx);
    // Now create a context where the manifest already has this entry
    const manifestWithEntry = makeManifest([entry]);
    const ctxWithEntry = makeContext(tmpDir, manifestWithEntry);

    const result = await installer.detect(artifact, ctxWithEntry);
    expect(result.status).toBe("occupied-by-logbook");
    if (result.status === "occupied-by-logbook") {
      expect(result.existing.id).toBe(LOGBOOK_MCP_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// Verify tests
// ---------------------------------------------------------------------------

describe("MCPServerInstaller — verify", () => {
  it("returns ok:true after a clean install", async () => {
    copyFixture(MCP_JSON_FIXTURES, "with-other-mcp-server.json");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    const verifyCtx = makeContext(tmpDir, makeManifest([entry]));
    const result = await installer.verify(entry, verifyCtx);
    expect(result.ok).toBe(true);
  });

  it("returns hash_mismatch after manual edit of the value object", async () => {
    copyFixture(MCP_JSON_FIXTURES, "with-other-mcp-server.json");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);

    // Manually tamper with the file
    const content = await fs.readFile(mcpJsonPath(), "utf8");
    const tampered = content.replace('"lb-mcp-001"', '"tampered-id"');
    await fs.writeFile(mcpJsonPath(), tampered, "utf8");

    const verifyCtx = makeContext(tmpDir, makeManifest([entry]));
    const result = await installer.verify(entry, verifyCtx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("returns file_missing when file was deleted after install", async () => {
    copyFixture(MCP_JSON_FIXTURES, "with-other-mcp-server.json");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    await fs.unlink(mcpJsonPath());

    const verifyCtx = makeContext(tmpDir, makeManifest([entry]));
    const result = await installer.verify(entry, verifyCtx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("file_missing");
  });

  it("returns anchor_missing when logbook-mcp key was removed", async () => {
    copyFixture(MCP_JSON_FIXTURES, "with-other-mcp-server.json");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);

    // Remove the logbook-mcp key manually by rewriting the file without it
    const original = readFixture(MCP_JSON_FIXTURES, "with-other-mcp-server.json");
    await fs.writeFile(mcpJsonPath(), original, "utf8");

    const verifyCtx = makeContext(tmpDir, makeManifest([entry]));
    const result = await installer.verify(entry, verifyCtx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("anchor_missing");
  });
});

// ---------------------------------------------------------------------------
// ManifestArtifact shape verification
// ---------------------------------------------------------------------------

describe("MCPServerInstaller — manifest entry shape", () => {
  it("produces a valid ManifestArtifact with expected fields", async () => {
    copyFixture(MCP_JSON_FIXTURES, "with-other-mcp-server.json");
    const installer = getMcpInstaller();
    const artifact = makeMcpArtifact();
    const ctx = makeContext(tmpDir);

    const entry = await installer.install(artifact, ctx);
    expect(entry.id).toBe(LOGBOOK_MCP_ID);
    expect(entry.kind).toBe("mcp_server");
    expect(entry.file_path).toBe(".claude/mcp.json");
    expect(entry.content_hash).toBeTruthy();
    expect(entry.installed_at).toBeTruthy();
    expect(entry.anchor.type).toBe("json_object_key");
    if (entry.anchor.type === "json_object_key") {
      expect(entry.anchor.jsonPath).toBe("/mcpServers/logbook-mcp");
      expect(entry.anchor.idField).toBe("_logbookId");
      expect(entry.anchor.idValue).toBe(LOGBOOK_MCP_ID);
    }
  });
});

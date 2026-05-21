/**
 * hook-installer.test.ts — Unit tests for HookInstaller.
 *
 * TDD: written BEFORE hook.ts exists. Running this file while hook.ts is absent
 * produces ERR_MODULE_NOT_FOUND (confirmed RED state).
 *
 * Byte-identity contract: for fixtures that already have a hooks array, install
 * then uninstall must produce 0 diff vs the original bytes. For empty.json
 * (hooks structure absent), uninstall must also recover to the original.
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
import { getInstaller } from "../../src/connectors/claude-code/artifacts/registry.js";
import type { InstallContext } from "../../src/connectors/claude-code/artifacts/installer.js";
import type { Artifact } from "../../src/types/artifact.js";
import { emptyManifest } from "../../src/core/manifest.js";
import { makePaths } from "../../src/core/paths.js";
import { sha256 } from "../../src/util/hash.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "../fixtures/settings-local-json"
);

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-hook-inst-"));
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

function settingsPath(): string {
  return path.join(projectRoot, ".claude", "settings.local.json");
}

function writeSettings(content: string): void {
  fs.writeFileSync(settingsPath(), content, "utf8");
}

// ---------------------------------------------------------------------------
// install / uninstall — byte-identity per fixture
// ---------------------------------------------------------------------------

const HOOK_FIXTURES = [
  "empty.json",
  "only-other-plugin.json",
  "two-other-plugins.json",
  "tabs-indent.json",
  "no-trailing-newline.json",
];

describe("HookInstaller — install + uninstall byte-identity per fixture", () => {
  for (const fixture of HOOK_FIXTURES) {
    it(`roundtrip is byte-identical for ${fixture}`, async () => {
      const original = readFixture(fixture);
      writeSettings(original);

      const installer = getInstaller("hook");
      const artifact = makeHookArtifact();
      const ctx = makeCtx();

      // Install
      const entry = await installer.install(artifact, ctx);
      const afterInstall = fs.readFileSync(settingsPath(), "utf8");

      // The file must have changed (a new hook entry must be present)
      expect(afterInstall).toContain('"_logbookId"');
      expect(afterInstall).toContain(entry.id);

      // The content_hash must match
      expect(entry.content_hash).toBeTruthy();

      // Uninstall — must restore byte-identity
      await installer.uninstall(entry, ctx);
      const afterUninstall = fs.readFileSync(settingsPath(), "utf8");
      expect(afterUninstall).toBe(original);
    });
  }
});

// ---------------------------------------------------------------------------
// empty.json edge case: hooks structure injected then fully removed
// ---------------------------------------------------------------------------

describe("HookInstaller — empty.json (hooks-absent) edge case", () => {
  it("injects hooks structure and removes it entirely on uninstall", async () => {
    const original = readFixture("empty.json");
    expect(original.trim()).toBe("{}"); // sanity check
    writeSettings(original);

    const installer = getInstaller("hook");
    const artifact = makeHookArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);
    const afterInstall = fs.readFileSync(settingsPath(), "utf8");
    expect(afterInstall).toContain('"hooks"');
    expect(afterInstall).toContain('"PostToolUse"');
    expect(afterInstall).toContain('"_logbookId"');

    await installer.uninstall(entry, ctx);
    const afterUninstall = fs.readFileSync(settingsPath(), "utf8");
    // Must be byte-identical to original (the hooks structure is gone)
    expect(afterUninstall).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Claude Code shape compliance (2026-05-21 regression)
// ---------------------------------------------------------------------------

describe("HookInstaller — Claude Code hook schema compliance", () => {
  // Claude Code's settings.local.json schema for `hooks.<Event>[i]` requires
  // a matcher object with an inner `hooks` array of command descriptors.
  // Before 2026-05-21 we wrote the inner command directly into the outer
  // array, causing Claude Code to refuse the file at session start:
  //   `hooks: Expected array, but received undefined`.
  it("install writes matcher+hooks array shape (not bare command descriptor)", async () => {
    writeSettings(readFixture("only-other-plugin.json"));
    const installer = getInstaller("hook");
    const artifact = makeHookArtifact();
    const ctx = makeCtx();

    await installer.install(artifact, ctx);

    const content = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(content) as {
      hooks: Record<
        string,
        Array<{
          matcher: string;
          hooks: Array<{ type: string; command: string }>;
          _logbookId?: string;
        }>
      >;
    };

    const event = parsed.hooks["PostToolUse"];
    expect(Array.isArray(event)).toBe(true);

    // The fixture may have pre-existing other-plugin entries — find OUR entry
    // by its _logbookId. We only assert the shape of the LogBook entry; other
    // plugins are responsible for their own.
    const ours = event!.find((e) =>
      typeof e._logbookId === "string" && e._logbookId.startsWith("lb-hook-"),
    );
    expect(ours, "expected a LogBook hook entry in PostToolUse").toBeDefined();

    // OUTER object: matcher + inner hooks array + _logbookId
    expect(typeof ours!.matcher).toBe("string");
    expect(Array.isArray(ours!.hooks)).toBe(true);

    // INNER hook descriptor: type + command
    expect(ours!.hooks).toHaveLength(1);
    expect(ours!.hooks[0]!.type).toBe("command");
    expect(typeof ours!.hooks[0]!.command).toBe("string");
    expect(ours!.hooks[0]!.command).toContain("hook.cjs");
  });
});

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------

describe("HookInstaller.detect()", () => {
  it('returns {status:"empty"} when manifest has no matching entry', async () => {
    writeSettings(readFixture("only-other-plugin.json"));
    const installer = getInstaller("hook");
    const artifact = makeHookArtifact();
    const ctx = makeCtx();
    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("empty");
  });

  it('returns {status:"occupied-by-logbook"} when manifest has a matching entry', async () => {
    writeSettings(readFixture("only-other-plugin.json"));
    const installer = getInstaller("hook");
    const artifact = makeHookArtifact("lb-hook-posttooluse-001");
    const ctx = makeCtx();

    // First install to get an entry in the manifest
    const entry = await installer.install(artifact, ctx);
    // Add the entry to manifest
    ctx.manifest.artifacts.push(entry);

    // Now detect should find it
    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("occupied-by-logbook");
    if (result.status === "occupied-by-logbook") {
      expect(result.existing.id).toBe(entry.id);
    }
  });
});

// ---------------------------------------------------------------------------
// verify()
// ---------------------------------------------------------------------------

describe("HookInstaller.verify()", () => {
  it("returns {ok:true} immediately after install", async () => {
    writeSettings(readFixture("only-other-plugin.json"));
    const installer = getInstaller("hook");
    const artifact = makeHookArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);
    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(true);
  });

  it("returns {ok:false, reason:'hash_mismatch'} after file is manually corrupted", async () => {
    writeSettings(readFixture("only-other-plugin.json"));
    const installer = getInstaller("hook");
    const artifact = makeHookArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);

    // Corrupt the installed content — change the command value so that the
    // entry is still findable (by _logbookId) but the canonical hash differs.
    const current = fs.readFileSync(settingsPath(), "utf8");
    const corrupted = current.replace(
      "/abs/dist/connectors/claude-code/hook.cjs",
      "/CORRUPTED/hook.cjs"
    );
    fs.writeFileSync(settingsPath(), corrupted, "utf8");

    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("returns {ok:false, reason:'file_missing'} when settings file is deleted", async () => {
    writeSettings(readFixture("only-other-plugin.json"));
    const installer = getInstaller("hook");
    const artifact = makeHookArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);
    fs.unlinkSync(settingsPath());

    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("file_missing");
  });
});

// ---------------------------------------------------------------------------
// ManifestArtifact shape validation
// ---------------------------------------------------------------------------

describe("HookInstaller — ManifestArtifact shape", () => {
  it("install returns a properly shaped ManifestArtifact", async () => {
    writeSettings(readFixture("empty.json"));
    const installer = getInstaller("hook");
    const artifact = makeHookArtifact("lb-hook-posttooluse-001");
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);

    expect(entry.id).toBe("lb-hook-posttooluse-001");
    expect(entry.kind).toBe("hook");
    expect(entry.file_path).toBe(".claude/settings.local.json");
    expect(entry.anchor.type).toBe("json_field");
    if (entry.anchor.type === "json_field") {
      expect(entry.anchor.idField).toBe("_logbookId");
      expect(entry.anchor.idValue).toBe("lb-hook-posttooluse-001");
      expect(entry.anchor.jsonPath).toMatch(/^\/hooks\/PostToolUse\//);
    }
    expect(entry.content_hash).toHaveLength(64); // sha256 hex
    expect(entry.installed_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

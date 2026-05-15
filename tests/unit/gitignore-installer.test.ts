/**
 * gitignore-installer.test.ts — Unit tests for GitignoreInstaller.
 *
 * TDD: written BEFORE gitignore.ts exists. Running this file while gitignore.ts
 * is absent produces ERR_MODULE_NOT_FOUND (confirmed RED state).
 *
 * Byte-identity contract: for every fixture, install then uninstall must
 * recover the original file bytes byte-for-byte.
 *
 * CRLF behavior: appending LF-joined lines into a CRLF file produces mixed
 * newlines. The roundtrip still works because removeLines uses the recorded
 * flags to undo exactly what appendLines did. Documented as iter1 limitation.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "../fixtures/gitignore"
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-gitignore-inst-"));
  projectRoot = fs.realpathSync(tmpDir);
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".logbook"), { recursive: true });
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

function makeGitignoreArtifact(
  id = "lb-gitignore-001"
): Extract<Artifact, { kind: "gitignore_entry" }> {
  return {
    kind: "gitignore_entry",
    file_path: ".gitignore",
    lines: [".logbook/", "logbook/", `# ${id}`],
  };
}

function gitignorePath(): string {
  return path.join(projectRoot, ".gitignore");
}

function writeGitignore(content: string): void {
  fs.writeFileSync(gitignorePath(), content, "utf8");
}

// ---------------------------------------------------------------------------
// install / uninstall — byte-identity per fixture
// ---------------------------------------------------------------------------

const GITIGNORE_FIXTURES = ["empty", "with-content", "with-trailing-newline", "crlf"];

describe("GitignoreInstaller — install + uninstall byte-identity per fixture", () => {
  for (const fixture of GITIGNORE_FIXTURES) {
    it(`roundtrip is byte-identical for ${fixture}`, async () => {
      const original = readFixture(fixture);
      writeGitignore(original);

      const installer = getInstaller("gitignore_entry");
      const artifact = makeGitignoreArtifact();
      const ctx = makeCtx();

      // Install
      const entry = await installer.install(artifact, ctx);
      const afterInstall = fs.readFileSync(gitignorePath(), "utf8");

      // The file must contain the appended lines
      expect(afterInstall).toContain(".logbook/");
      expect(afterInstall).toContain("logbook/");
      expect(entry.content_hash).toBeTruthy();

      // Uninstall — must restore byte-identity
      await installer.uninstall(entry, ctx);
      const afterUninstall = fs.readFileSync(gitignorePath(), "utf8");
      expect(afterUninstall).toBe(original);
    });
  }
});

// ---------------------------------------------------------------------------
// install when .gitignore is missing
// ---------------------------------------------------------------------------

describe("GitignoreInstaller — .gitignore absent", () => {
  it("creates .gitignore when absent and uninstall removes it cleanly", async () => {
    // Do NOT create the file — it should not exist
    expect(fs.existsSync(gitignorePath())).toBe(false);

    const installer = getInstaller("gitignore_entry");
    const artifact = makeGitignoreArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);
    expect(fs.existsSync(gitignorePath())).toBe(true);

    const afterInstall = fs.readFileSync(gitignorePath(), "utf8");
    expect(afterInstall).toContain(".logbook/");

    // Uninstall must restore to empty string (original was absent → treated as "")
    await installer.uninstall(entry, ctx);
    const afterUninstall = fs.readFileSync(gitignorePath(), "utf8");
    // When the original was absent, "empty string" is the pre-install state.
    // The uninstall should leave an empty file (removing what we added).
    expect(afterUninstall).toBe("");
  });
});

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------

describe("GitignoreInstaller.detect()", () => {
  it('returns {status:"empty"} when manifest has no matching entry and lines not present', async () => {
    writeGitignore(readFixture("with-content"));
    const installer = getInstaller("gitignore_entry");
    const artifact = makeGitignoreArtifact();
    const ctx = makeCtx();
    const result = await installer.detect(artifact, ctx);
    expect(result.status).toBe("empty");
  });

  it('returns {status:"occupied-by-logbook"} when manifest has matching entry', async () => {
    writeGitignore(readFixture("with-trailing-newline"));
    const installer = getInstaller("gitignore_entry");
    const artifact = makeGitignoreArtifact("lb-gitignore-001");
    const ctx = makeCtx();

    // Install first
    const entry = await installer.install(artifact, ctx);
    ctx.manifest.artifacts.push(entry);

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

describe("GitignoreInstaller.verify()", () => {
  it("returns {ok:true} immediately after install", async () => {
    writeGitignore(readFixture("with-trailing-newline"));
    const installer = getInstaller("gitignore_entry");
    const artifact = makeGitignoreArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);
    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(true);
  });

  it("returns {ok:false, reason:'anchor_missing'} when lines are removed manually", async () => {
    writeGitignore(readFixture("with-trailing-newline"));
    const installer = getInstaller("gitignore_entry");
    const artifact = makeGitignoreArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);

    // Manually remove the lines
    const current = fs.readFileSync(gitignorePath(), "utf8");
    const withoutLines = current
      .replace(".logbook/\n", "")
      .replace("logbook/\n", "")
      .replace("# lb-gitignore-001\n", "");
    fs.writeFileSync(gitignorePath(), withoutLines, "utf8");

    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("anchor_missing");
  });

  it("returns {ok:false, reason:'file_missing'} when .gitignore is deleted", async () => {
    writeGitignore(readFixture("with-trailing-newline"));
    const installer = getInstaller("gitignore_entry");
    const artifact = makeGitignoreArtifact();
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);
    fs.unlinkSync(gitignorePath());

    const result = await installer.verify(entry, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("file_missing");
  });
});

// ---------------------------------------------------------------------------
// ManifestArtifact shape validation
// ---------------------------------------------------------------------------

describe("GitignoreInstaller — ManifestArtifact shape", () => {
  it("install returns a properly shaped ManifestArtifact", async () => {
    writeGitignore(readFixture("empty"));
    const installer = getInstaller("gitignore_entry");
    const artifact = makeGitignoreArtifact("lb-gitignore-001");
    const ctx = makeCtx();

    const entry = await installer.install(artifact, ctx);

    expect(entry.id).toBe("lb-gitignore-001");
    expect(entry.kind).toBe("gitignore_entry");
    expect(entry.file_path).toBe(".gitignore");
    expect(entry.anchor.type).toBe("line_set");
    if (entry.anchor.type === "line_set") {
      expect(entry.anchor.lines).toEqual([
        ".logbook/",
        "logbook/",
        "# lb-gitignore-001",
      ]);
    }
    expect(entry.content_hash).toHaveLength(64);
    expect(entry.installed_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

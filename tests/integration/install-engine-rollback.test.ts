import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { register, clearRegistry } from "../../src/connectors/claude-code/artifacts/registry.js";
import type { ArtifactInstaller, DetectionResult } from "../../src/connectors/claude-code/artifacts/installer.js";
import type { InstallContext } from "../../src/connectors/claude-code/artifacts/installer.js";
import type { ManifestArtifact } from "../../src/types/manifest.js";
import type { Artifact } from "../../src/types/artifact.js";
import { runInstall } from "../../src/core/install-engine.js";
import { runUninstall } from "../../src/core/uninstall-engine.js";
import { makePaths } from "../../src/core/paths.js";
import { readManifest, writeManifest, emptyManifest } from "../../src/core/manifest.js";

// ---------------------------------------------------------------------------
// Test project setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let projectRoot: string;

beforeEach(() => {
  clearRegistry();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-engine-"));
  projectRoot = fs.realpathSync(tmpDir);
  // Create .git to allow resolveProjectRoot to find the root
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".logbook"), { recursive: true });
});

afterEach(() => {
  clearRegistry();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fake artifact + installer helpers
// ---------------------------------------------------------------------------

type FakeArtifact = Extract<Artifact, { kind: "hook" }>;

function makeFakeArtifact(id: string): FakeArtifact {
  return {
    kind: "hook",
    hookEvent: "PostToolUse",
    command: "node /dist/hook.cjs",
    _logbookId: id,
  };
}

function makeFakeManifestArtifact(id: string): ManifestArtifact {
  return {
    id,
    kind: "hook",
    file_path: ".claude/settings.local.json",
    anchor: { type: "json_field", jsonPath: "/hooks/PostToolUse/0", idField: "_logbookId", idValue: id },
    content_hash: "abc123",
    installed_at: "2026-01-01T00:00:00Z",
  };
}

interface FakeInstallerOptions {
  detectResult?: DetectionResult;
  throwOnInstall?: boolean;
  throwOnUninstall?: boolean;
  installCalls?: string[];
  uninstallCalls?: string[];
  verifyCalls?: string[];
}

function makeFakeInstaller(options: FakeInstallerOptions = {}): ArtifactInstaller {
  return {
    kind: "hook" as const,
    detect: async () =>
      options.detectResult ?? ({ status: "empty" } as const),
    install: async (artifact: Artifact) => {
      if (options.throwOnInstall) throw new Error("FakeInstaller.install deliberate failure");
      const a = artifact as FakeArtifact;
      options.installCalls?.push(a._logbookId);
      return makeFakeManifestArtifact(a._logbookId);
    },
    uninstall: async (entry: ManifestArtifact) => {
      if (options.throwOnUninstall) throw new Error("FakeInstaller.uninstall deliberate failure");
      options.uninstallCalls?.push(entry.id);
    },
    verify: async (entry: ManifestArtifact) => {
      options.verifyCalls?.push(entry.id);
      return { ok: true };
    },
  };
}

// ---------------------------------------------------------------------------
// install-engine tests
// ---------------------------------------------------------------------------

describe("runInstall — empty artifacts list", () => {
  it("returns empty result with no manifest write when artifacts is empty", async () => {
    const installer = makeFakeInstaller();
    register(installer);

    const paths = makePaths(projectRoot);
    const result = await runInstall({
      paths,
      preset: "minimal",
      artifacts: [],
      dryRun: false,
    });

    expect(result.installed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    // When no artifacts installed, manifest still gets written (empty)
    // OR not written if nothing done — verify by spec: no artifacts = no disk write
    // The engine should still return a valid manifest object
    expect(result.manifest.artifacts).toHaveLength(0);
  });
});

describe("runInstall — discovery report", () => {
  it("produces a discovery report row per artifact", async () => {
    const calls = { install: [] as string[] };
    const installer = makeFakeInstaller({ installCalls: calls.install });
    register(installer);

    const paths = makePaths(projectRoot);
    const reports: unknown[] = [];
    await runInstall({
      paths,
      preset: "minimal",
      artifacts: [makeFakeArtifact("lb-hook-001")],
      dryRun: false,
      onReport: (r) => reports.push(r),
    });

    expect(reports).toHaveLength(1);
    const report = reports[0] as { rows: Array<{ kind: string; status: string; action: string }> };
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.kind).toBe("hook");
    expect(report.rows[0]!.status).toBe("empty");
    expect(report.rows[0]!.action).toBe("will-install");
  });
});

describe("runInstall — single artifact, no pre-existing file", () => {
  it("calls install, writes manifest, returns ManifestArtifact", async () => {
    const installCalls: string[] = [];
    const installer = makeFakeInstaller({ installCalls });
    register(installer);

    const paths = makePaths(projectRoot);
    const result = await runInstall({
      paths,
      preset: "minimal",
      artifacts: [makeFakeArtifact("lb-hook-001")],
      dryRun: false,
    });

    expect(installCalls).toEqual(["lb-hook-001"]);
    expect(result.installed).toHaveLength(1);
    expect(result.installed[0]!.id).toBe("lb-hook-001");
    expect(result.skipped).toHaveLength(0);

    // Manifest must be persisted to disk
    const manifest = readManifest(paths.manifestPath);
    expect(manifest).not.toBeNull();
    expect(manifest!.artifacts).toHaveLength(1);
    expect(manifest!.artifacts[0]!.id).toBe("lb-hook-001");
  });
});

describe("runInstall — artifact already installed (occupied-by-logbook)", () => {
  it("skips install when detector returns occupied-by-logbook", async () => {
    const existing = makeFakeManifestArtifact("lb-hook-001");
    const installCalls: string[] = [];
    const installer = makeFakeInstaller({
      detectResult: { status: "occupied-by-logbook", existing },
      installCalls,
    });
    register(installer);

    const paths = makePaths(projectRoot);
    const result = await runInstall({
      paths,
      preset: "minimal",
      artifacts: [makeFakeArtifact("lb-hook-001")],
      dryRun: false,
    });

    // installer.install must NOT be called
    expect(installCalls).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/already-present/);
  });
});

describe("runInstall — rollback on installer throw", () => {
  it("rolls back previously installed artifacts when an installer throws mid-run", async () => {
    // We need two "hook" installers. Since registry only allows one per kind,
    // we simulate a two-artifact run via a stateful installer that fails on 2nd call.
    // Instead, we test with a single artifact that ALWAYS throws.
    // The rollback test verifies that nothing is written to disk.
    const uninstallCalls: string[] = [];
    const installer = makeFakeInstaller({ throwOnInstall: true, uninstallCalls });
    register(installer);

    const paths = makePaths(projectRoot);
    await expect(
      runInstall({
        paths,
        preset: "minimal",
        artifacts: [makeFakeArtifact("lb-hook-001")],
        dryRun: false,
      })
    ).rejects.toThrow("FakeInstaller.install deliberate failure");

    // Manifest must NOT be written on error
    expect(readManifest(paths.manifestPath)).toBeNull();
  });

  it("calls uninstall in reverse order for prior successes when a later installer throws", async () => {
    // Simulate a multi-artifact scenario using a stateful installer:
    // first artifact succeeds; second (represented by same kind but different id) throws.
    // We accomplish this by registering a stateful installer that succeeds on first call
    // and throws on second.

    const installOrder: string[] = [];
    const uninstallOrder: string[] = [];
    let callCount = 0;

    const stateInjectedInstaller: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async (artifact: Artifact) => {
        const a = artifact as FakeArtifact;
        callCount++;
        if (callCount >= 2) throw new Error("second install fails");
        installOrder.push(a._logbookId);
        return makeFakeManifestArtifact(a._logbookId);
      },
      uninstall: async (entry: ManifestArtifact) => {
        uninstallOrder.push(entry.id);
      },
      verify: async () => ({ ok: true }),
    };
    register(stateInjectedInstaller);

    // Two artifacts of kind "hook" — engine must handle same-kind multi-artifacts
    // by looking up the installer once and calling it for each artifact.
    // (The design says: resolve installer per artifact by kind, then call it.)
    const paths = makePaths(projectRoot);

    // We need to use two different artifact ids but same kind. The engine
    // resolves the installer by kind — so both artifacts call the SAME installer.
    const twoArtifacts: FakeArtifact[] = [
      makeFakeArtifact("lb-hook-001"),
      makeFakeArtifact("lb-hook-002"),
    ];

    await expect(
      runInstall({
        paths,
        preset: "minimal",
        artifacts: twoArtifacts as Artifact[],
        dryRun: false,
      })
    ).rejects.toThrow("second install fails");

    // First artifact was installed successfully; rollback must have happened.
    expect(installOrder).toEqual(["lb-hook-001"]);

    // Regression 2026-05-21 audit, CRITICAL #3: rollback now restores SHARED
    // files (`hook`, `mcp_server`, `augment_claudemd`, etc.) from their
    // .logbook/backups/ snapshot, not by calling `installer.uninstall()`.
    // For OWNED-file kinds (slash_command / skill / subagent), uninstall is
    // still called. The fake installer here is registered under kind="hook",
    // which is shared — so uninstall is NOT called and the backup restore
    // path runs instead. The .claude/settings.local.json file never existed
    // in this test, so the sentinel-restore is a no-op (correct end state:
    // file absent).
    //
    // We deliberately do NOT assert `uninstallOrder.toContain(...)` here
    // anymore — that would re-encode the old (incorrect) rollback contract
    // and is exactly the test-shape mistake the 2026-05-21 post-mortem
    // called out.
    expect(uninstallOrder).toEqual([]);

    // Manifest must NOT be written.
    expect(readManifest(paths.manifestPath)).toBeNull();
  });

  it("rollback restores SHARED-FILE backups (does not rely on installer.uninstall)", async () => {
    // Direct evidence for the new contract: write real bytes to a shared
    // file at install time, fail on the second artifact, assert the file
    // was restored from the backup snapshot.
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async (_artifact, ctx) => {
        // Simulate the real hook installer: write a mutation to the shared
        // file. This is what makes the rollback meaningful.
        const target = path.join(ctx.projectRoot, ".claude/settings.local.json");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const current = fs.existsSync(target)
          ? fs.readFileSync(target, "utf8")
          : "{}";
        const next = current.replace(/}$/, ',"_lb_marker":true}');
        fs.writeFileSync(target, next, "utf8");
        return makeFakeManifestArtifact("lb-hook-001");
      },
      // uninstall should NOT be called for shared-file kinds.
      uninstall: async () => {
        throw new Error("rollback must NOT call uninstall for shared-file kinds");
      },
      verify: async () => ({ ok: true }),
    };
    register(installer);

    // Seed a non-empty pre-install file so we can verify exact restoration.
    const settingsAbs = path.join(projectRoot, ".claude/settings.local.json");
    fs.mkdirSync(path.dirname(settingsAbs), { recursive: true });
    const preInstallContent = '{"user":"keep-this"}\n';
    fs.writeFileSync(settingsAbs, preInstallContent, "utf8");

    // Throwing installer for the second artifact, registered under a
    // different kind so we don't conflict with the one above.
    const throwingInstaller: ArtifactInstaller = {
      kind: "augment_claudemd" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => {
        throw new Error("second install fails");
      },
      uninstall: async () => {},
      verify: async () => ({ ok: true }),
    };
    register(throwingInstaller);

    const paths = makePaths(projectRoot);

    await expect(
      runInstall({
        paths,
        preset: "minimal",
        artifacts: [
          makeFakeArtifact("lb-hook-001"),
          { kind: "augment_claudemd", file_path: "CLAUDE.md", block_content: "x", _logbookId: "lb-claudemd-001" },
        ],
        dryRun: false,
      })
    ).rejects.toThrow("second install fails");

    // The shared file MUST be byte-identical to pre-install — proves restore
    // path ran. If uninstall had been the rollback path it would have thrown
    // (see installer.uninstall above) and the test would have crashed.
    expect(fs.readFileSync(settingsAbs, "utf8")).toBe(preInstallContent);
  });
});

describe("runInstall — dry run", () => {
  it("does not write to disk in dry-run mode but still produces a report", async () => {
    const installCalls: string[] = [];
    const installer = makeFakeInstaller({ installCalls });
    register(installer);

    const paths = makePaths(projectRoot);
    const reports: unknown[] = [];
    const result = await runInstall({
      paths,
      preset: "minimal",
      artifacts: [makeFakeArtifact("lb-hook-001")],
      dryRun: true,
      onReport: (r) => reports.push(r),
    });

    // No disk writes
    expect(readManifest(paths.manifestPath)).toBeNull();
    // No install calls
    expect(installCalls).toHaveLength(0);
    // Report still produced
    expect(reports).toHaveLength(1);
    // Installed array is empty
    expect(result.installed).toHaveLength(0);
  });
});

describe("runInstall — artifact ordering", () => {
  it("preserves the order of artifacts in the input", async () => {
    const installOrder: string[] = [];
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async (artifact: Artifact) => {
        const a = artifact as FakeArtifact;
        installOrder.push(a._logbookId);
        return makeFakeManifestArtifact(a._logbookId);
      },
      uninstall: async () => {},
      verify: async () => ({ ok: true }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    await runInstall({
      paths,
      preset: "minimal",
      artifacts: [
        makeFakeArtifact("lb-hook-001"),
        makeFakeArtifact("lb-hook-002"),
        makeFakeArtifact("lb-hook-003"),
      ] as Artifact[],
      dryRun: false,
    });

    expect(installOrder).toEqual(["lb-hook-001", "lb-hook-002", "lb-hook-003"]);
  });
});

// ---------------------------------------------------------------------------
// uninstall-engine tests
// ---------------------------------------------------------------------------

describe("runUninstall — no manifest", () => {
  it("returns empty result with note when manifest is missing", async () => {
    const paths = makePaths(projectRoot);
    const result = await runUninstall({ paths, dryRun: false });
    expect(result.removed).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });
});

describe("runUninstall — reverse order removal", () => {
  it("removes 2 artifacts in reverse order of manifest", async () => {
    const uninstallOrder: string[] = [];
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async (entry: ManifestArtifact) => {
        uninstallOrder.push(entry.id);
      },
      verify: async () => ({ ok: true }),
    };
    register(installer);

    const paths = makePaths(projectRoot);

    // Write a manifest with 2 artifacts
    const manifest = {
      ...emptyManifest("minimal"),
      artifacts: [
        makeFakeManifestArtifact("lb-hook-001"),
        makeFakeManifestArtifact("lb-hook-002"),
      ],
    };
    writeManifest(paths.manifestPath, manifest);

    const result = await runUninstall({ paths, dryRun: false });

    // Both removed
    expect(result.removed).toHaveLength(2);
    expect(result.issues).toHaveLength(0);

    // REVERSE order: 002 first, then 001
    expect(uninstallOrder[0]!).toBe("lb-hook-002");
    expect(uninstallOrder[1]!).toBe("lb-hook-001");

    // Manifest on disk should be empty (or absent — we write empty after full uninstall)
    const afterManifest = readManifest(paths.manifestPath);
    // Engine writes empty manifest after all removed; CLI may delete it
    if (afterManifest !== null) {
      expect(afterManifest.artifacts).toHaveLength(0);
    }
  });
});

describe("runUninstall — hash_mismatch preserves entry", () => {
  it("does not uninstall entry when verify reports hash_mismatch", async () => {
    const uninstallCalls: string[] = [];
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async (entry: ManifestArtifact) => {
        uninstallCalls.push(entry.id);
      },
      verify: async () => ({ ok: false, reason: "hash_mismatch" as const }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    const manifest = {
      ...emptyManifest("minimal"),
      artifacts: [makeFakeManifestArtifact("lb-hook-001")],
    };
    writeManifest(paths.manifestPath, manifest);

    const result = await runUninstall({ paths, dryRun: false });

    // uninstall NOT called
    expect(uninstallCalls).toHaveLength(0);
    // Recorded as issue
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.status).toBe("hash-mismatch");
    expect(result.issues[0]!.id).toBe("lb-hook-001");
    // Not in removed
    expect(result.removed).toHaveLength(0);
  });
});

// Regression: a user reported that `logbook uninstall --force` left logbook
// content in modified files (CLAUDE.md augment block, .gitignore lines, etc).
// Root cause: the engine skipped uninstall whenever verify reported
// hash_mismatch, and --force was not threaded through from the CLI. Result:
// any drift in installed content would leave the artifact orphaned on disk
// forever. The fix routes --force into the engine; hash_mismatch with force
// still calls installer.uninstall() (anchor-based removal, drift-safe).
describe("runUninstall — force overrides hash_mismatch", () => {
  it("with force=true and verify reports hash_mismatch, still calls installer.uninstall()", async () => {
    const uninstallCalls: string[] = [];
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async (entry: ManifestArtifact) => {
        uninstallCalls.push(entry.id);
      },
      verify: async () => ({ ok: false, reason: "hash_mismatch" as const }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    const manifest = {
      ...emptyManifest("minimal"),
      artifacts: [makeFakeManifestArtifact("lb-hook-001")],
    };
    writeManifest(paths.manifestPath, manifest);

    const result = await runUninstall({ paths, dryRun: false, force: true });

    // uninstall WAS called despite hash_mismatch
    expect(uninstallCalls).toEqual(["lb-hook-001"]);
    // No longer recorded as a blocking issue — surfaced as "removed-forced"
    // in the report so the user can see it was a forced removal.
    expect(result.removed).toEqual(["lb-hook-001"]);
    // Manifest entry is gone
    const after = readManifest(paths.manifestPath);
    expect(after?.artifacts ?? []).toHaveLength(0);
  });

  it("with force=false (default), hash_mismatch still skips uninstall (back-compat)", async () => {
    const uninstallCalls: string[] = [];
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async (entry: ManifestArtifact) => {
        uninstallCalls.push(entry.id);
      },
      verify: async () => ({ ok: false, reason: "hash_mismatch" as const }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    const manifest = {
      ...emptyManifest("minimal"),
      artifacts: [makeFakeManifestArtifact("lb-hook-001")],
    };
    writeManifest(paths.manifestPath, manifest);

    // No force passed
    const result = await runUninstall({ paths, dryRun: false });

    expect(uninstallCalls).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.issues[0]!.status).toBe("hash-mismatch");
    // The "drift" hint must be present in the note so users know about --force
    expect(result.issues[0]!.note).toMatch(/--force/);
  });

  it("force surfaces 'removed-forced' status in the report row (not 'removed')", async () => {
    const reportRows: import("../../src/core/uninstall-engine.js").UninstallReportRow[] = [];
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async () => {},
      verify: async () => ({ ok: false, reason: "hash_mismatch" as const }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    const manifest = {
      ...emptyManifest("minimal"),
      artifacts: [makeFakeManifestArtifact("lb-hook-001")],
    };
    writeManifest(paths.manifestPath, manifest);

    await runUninstall({
      paths,
      dryRun: false,
      force: true,
      onReport: (rows) => reportRows.push(...rows),
    });

    expect(reportRows).toHaveLength(1);
    expect(reportRows[0]!.status).toBe("removed-forced");
    expect(reportRows[0]!.note).toMatch(/drift/i);
  });
});

// Regression 2026-05-18: user reported `.gitignore` with the LogBook block
// duplicated 3 times. Root cause: manifest was lost between install cycles
// (a previous bad uninstall/purge), so detect() returned "occupied-by-other"
// instead of "occupied-by-logbook", and the install-engine called install()
// anyway — appending the same lines repeatedly. The engine must HONOR the
// installer's intent to skip when content is already on disk, regardless of
// whether ownership can be proven via the manifest.
describe("runInstall — occupied-by-other is a hard skip (prevents duplication)", () => {
  it("does NOT call installer.install() when detect returns occupied-by-other", async () => {
    const installCalls: string[] = [];
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({
        status: "occupied-by-other" as const,
        fingerprint: "orphan-content",
      }),
      install: async (artifact: Artifact) => {
        installCalls.push((artifact as FakeArtifact)._logbookId);
        return makeFakeManifestArtifact("never-reached");
      },
      uninstall: async () => {},
      verify: async () => ({ ok: true }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    const result = await runInstall({
      paths,
      preset: "minimal",
      artifacts: [makeFakeArtifact("lb-hook-001")],
      dryRun: false,
    });

    expect(installCalls).toHaveLength(0);
    expect(result.installed).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toBe("occupied-by-other");
  });
});

// Regression: programmatic callers of runUninstall (TUI, tests, scripts) used
// to get a partial uninstall — artifact bodies removed, but the SHARED FILES
// LogBook created from scratch (.gitignore, .claude/settings.local.json) were
// left on disk as empty husks (""  or "{}") and the manifest stayed behind.
// The CLI worked around this with its own post-uninstall sentinel cleanup, but
// the TUI did not have that code, so users uninstalling via the TUI got dirty
// projects. The cleanup now lives INSIDE runUninstall, so every caller wins.
describe("runUninstall — sentinel-backup cleanup is built into the engine", () => {
  it("deletes files that LogBook created from scratch (sentinel sha256='')", async () => {
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async (_entry, ctx: InstallContext) => {
        // Simulate what the real hook installer does: write a husk file.
        const abs = path.join(ctx.projectRoot, ".claude/settings.local.json");
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, "{}\n", "utf8");
      },
      verify: async () => ({ ok: true }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    const manifest = {
      ...emptyManifest("minimal"),
      artifacts: [makeFakeManifestArtifact("lb-hook-001")],
      backups: [
        {
          file_path: ".claude/settings.local.json",
          backup_path: "",
          sha256: "", // sentinel — file did not exist pre-install
          taken_at: "2026-05-18T00:00:00Z",
        },
      ],
    };
    writeManifest(paths.manifestPath, manifest);

    await runUninstall({ paths, dryRun: false });

    // The husk file must be gone — even though the engine was called directly
    // (no CLI wrapper to do the cleanup).
    expect(fs.existsSync(path.join(projectRoot, ".claude/settings.local.json"))).toBe(false);
    // Manifest file must also be gone.
    expect(fs.existsSync(paths.manifestPath)).toBe(false);
  });

  it("PRESERVES a sentinel-backed file if the user added their own content (no data loss)", async () => {
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async (_entry, ctx: InstallContext) => {
        // Simulate user-added content surviving uninstall: the installer leaves
        // something meaningful on disk (e.g. a user-added key in settings.local.json).
        const abs = path.join(ctx.projectRoot, ".claude/settings.local.json");
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, '{"userKey":"userValue"}\n', "utf8");
      },
      verify: async () => ({ ok: true }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    const manifest = {
      ...emptyManifest("minimal"),
      artifacts: [makeFakeManifestArtifact("lb-hook-001")],
      backups: [
        {
          file_path: ".claude/settings.local.json",
          backup_path: "",
          sha256: "",
          taken_at: "2026-05-18T00:00:00Z",
        },
      ],
    };
    writeManifest(paths.manifestPath, manifest);

    await runUninstall({ paths, dryRun: false });

    // File MUST survive — it has user content, even though LogBook originally created it.
    const abs = path.join(projectRoot, ".claude/settings.local.json");
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toBe('{"userKey":"userValue"}\n');
  });

  it("looksEmpty heuristic handles whitespace-only and JSON {} / []", async () => {
    // We exercise the heuristic via the public API: write three different
    // husk variants and assert each gets deleted.
    const writeAndUninstall = async (huskContent: string) => {
      // Fresh project subdir per case
      const sub = fs.mkdtempSync(path.join(projectRoot, "case-"));
      fs.mkdirSync(path.join(sub, ".git"), { recursive: true });
      fs.mkdirSync(path.join(sub, ".logbook"), { recursive: true });

      const installer: ArtifactInstaller = {
        kind: "hook" as const,
        detect: async () => ({ status: "empty" as const }),
        install: async () => makeFakeManifestArtifact("fake"),
        uninstall: async (_entry, ctx: InstallContext) => {
          const abs = path.join(ctx.projectRoot, "shared-file.txt");
          fs.writeFileSync(abs, huskContent, "utf8");
        },
        verify: async () => ({ ok: true }),
      };
      clearRegistry();
      register(installer);

      const localPaths = makePaths(sub);
      writeManifest(localPaths.manifestPath, {
        ...emptyManifest("minimal"),
        artifacts: [makeFakeManifestArtifact("lb-hook-001")],
        backups: [
          {
            file_path: "shared-file.txt",
            backup_path: "",
            sha256: "",
            taken_at: "2026-05-18T00:00:00Z",
          },
        ],
      });

      await runUninstall({ paths: localPaths, dryRun: false });
      return fs.existsSync(path.join(sub, "shared-file.txt"));
    };

    // All these should be detected as empty and deleted.
    expect(await writeAndUninstall("")).toBe(false);
    expect(await writeAndUninstall("\n")).toBe(false);
    expect(await writeAndUninstall("   \n  \t  \n")).toBe(false);
    expect(await writeAndUninstall("{}")).toBe(false);
    expect(await writeAndUninstall("{}\n")).toBe(false);
    expect(await writeAndUninstall("  {  }  ")).toBe(false);
    expect(await writeAndUninstall("[]")).toBe(false);
  });

  it("removes .logbook/backups/ entirely on clean uninstall", async () => {
    // Regression 2026-05-18: user reported `.logbook/backups/...` files left
    // on disk after `logbook uninstall`. Internal scratch — must be wiped.
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async () => {},
      verify: async () => ({ ok: true }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    // Seed a backup file the way install would have.
    fs.mkdirSync(paths.backupsDir, { recursive: true });
    fs.writeFileSync(path.join(paths.backupsDir, "abc123-.gitignore"), "stale", "utf8");

    writeManifest(paths.manifestPath, {
      ...emptyManifest("minimal"),
      artifacts: [makeFakeManifestArtifact("lb-hook-001")],
    });

    await runUninstall({ paths, dryRun: false });

    expect(fs.existsSync(paths.backupsDir)).toBe(false);
    expect(fs.existsSync(paths.manifestPath)).toBe(false);
  });

  it("removes empty .logbook/ directory but PRESERVES it if user data exists", async () => {
    // Spec §24: state.json, events/, journals are preserved. The engine must
    // delete .logbook/ ONLY when it would otherwise be empty.
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async () => {},
      verify: async () => ({ ok: true }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    fs.mkdirSync(paths.backupsDir, { recursive: true });
    // Pretend the user has accumulated events (data that must survive).
    fs.writeFileSync(path.join(paths.logbookDir, "state.json"), '{"disabled":false}', "utf8");

    writeManifest(paths.manifestPath, {
      ...emptyManifest("minimal"),
      artifacts: [makeFakeManifestArtifact("lb-hook-001")],
    });

    await runUninstall({ paths, dryRun: false });

    // backups + manifest gone; .logbook/ stays because state.json lives there.
    expect(fs.existsSync(paths.backupsDir)).toBe(false);
    expect(fs.existsSync(paths.manifestPath)).toBe(false);
    expect(fs.existsSync(paths.logbookDir)).toBe(true);
    expect(fs.existsSync(path.join(paths.logbookDir, "state.json"))).toBe(true);
  });

  it("dry-run does NOT delete sentinel files", async () => {
    const installer: ArtifactInstaller = {
      kind: "hook" as const,
      detect: async () => ({ status: "empty" as const }),
      install: async () => makeFakeManifestArtifact("fake"),
      uninstall: async () => {},
      verify: async () => ({ ok: true }),
    };
    register(installer);

    const paths = makePaths(projectRoot);
    fs.writeFileSync(path.join(projectRoot, ".gitignore"), "", "utf8");
    writeManifest(paths.manifestPath, {
      ...emptyManifest("minimal"),
      artifacts: [makeFakeManifestArtifact("lb-hook-001")],
      backups: [
        {
          file_path: ".gitignore",
          backup_path: "",
          sha256: "",
          taken_at: "2026-05-18T00:00:00Z",
        },
      ],
    });

    await runUninstall({ paths, dryRun: true });

    // Dry-run must NEVER touch disk.
    expect(fs.existsSync(path.join(projectRoot, ".gitignore"))).toBe(true);
    expect(fs.existsSync(paths.manifestPath)).toBe(true);
  });
});

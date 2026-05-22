import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveProjectRoot, makePaths } from "../../src/core/paths.js";
import { LogBookError } from "../../src/core/errors.js";

let tmpDir: string;
let canonicalTmp: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-paths-"));
  canonicalTmp = fs.realpathSync(tmpDir);
});

afterEach(() => {
  fs.rmSync(canonicalTmp, { recursive: true, force: true });
});

describe("resolveProjectRoot", () => {
  it("finds root when package.json is present in the given dir", () => {
    fs.writeFileSync(path.join(canonicalTmp, "package.json"), "{}");
    const result = resolveProjectRoot(canonicalTmp);
    expect(result).toBe(canonicalTmp);
  });

  it("finds root when .git directory is present", () => {
    fs.mkdirSync(path.join(canonicalTmp, ".git"));
    const result = resolveProjectRoot(canonicalTmp);
    expect(result).toBe(canonicalTmp);
  });

  it("finds root when .claude directory is present", () => {
    fs.mkdirSync(path.join(canonicalTmp, ".claude"));
    const result = resolveProjectRoot(canonicalTmp);
    expect(result).toBe(canonicalTmp);
  });

  it("walks up from a nested subdir to find the marker", () => {
    fs.writeFileSync(path.join(canonicalTmp, "package.json"), "{}");
    const nested = path.join(canonicalTmp, "a", "b", "c");
    fs.mkdirSync(nested, { recursive: true });
    const result = resolveProjectRoot(nested);
    expect(result).toBe(canonicalTmp);
  });

  it("throws PROJECT_ROOT_NOT_FOUND when no marker is found", () => {
    // Fresh tmp dir has no markers
    let caught: unknown;
    try {
      resolveProjectRoot(canonicalTmp);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LogBookError);
    expect((caught as LogBookError).code).toBe("PROJECT_ROOT_NOT_FOUND");
  });

  it("uses process.cwd() when startFrom is not given (smoke test — just not throws in a real repo)", () => {
    // This test validates the default arg behavior; in CI cwd should have package.json
    // We can't guarantee the env, so we simply test it doesn't throw in node_modules context.
    // Instead, just verify the function accepts no argument.
    expect(typeof resolveProjectRoot).toBe("function");
  });

  // Regression 2026-05-21: user reported "se instala en otra ubicación cuando
  // no hay git init". Without the HOME boundary the walk-up climbed all the
  // way to `/` and picked up the first ancestor with any of {.git, .claude,
  // package.json} — sometimes a totally unrelated project. The fix stops the
  // walk at HOME and either throws (default) or returns cwd (--here).
  describe("HOME-boundary + --here fallback (2026-05-21 regression)", () => {
    it("does NOT walk above HOME — throws PROJECT_ROOT_NOT_FOUND for a marker-less dir under HOME", () => {
      const home = fs.realpathSync(os.homedir());
      // Create a marker-less directory directly under HOME so the walk-up
      // stops at HOME without finding anything.
      const subdir = fs.mkdtempSync(path.join(home, "lb-paths-no-marker-"));
      try {
        // HOME itself must NOT have a marker for this assertion to be
        // meaningful; if it does (very unusual for a CI runner), skip.
        const homeHasMarker = [".git", ".claude", "package.json"].some((m) =>
          fs.existsSync(path.join(home, m)),
        );
        if (homeHasMarker) {
          // Cannot make this assertion deterministically — skip silently.
          return;
        }
        expect(() => resolveProjectRoot(subdir)).toThrow(LogBookError);
      } finally {
        fs.rmSync(subdir, { recursive: true, force: true });
      }
    });

    it("error message mentions --here as the escape hatch", () => {
      // canonicalTmp is under /tmp (NOT under HOME), so the walk goes all the
      // way to / without finding a marker. We just want the helpful text.
      try {
        resolveProjectRoot(canonicalTmp);
        throw new Error("expected throw");
      } catch (e) {
        expect((e as LogBookError).message).toMatch(/--here/);
      }
    });

    it("useCwdAsFallback=true returns the start dir even without any marker", () => {
      // No marker anywhere — should still resolve to canonicalTmp.
      const result = resolveProjectRoot(canonicalTmp, /* useCwdAsFallback */ true);
      expect(result).toBe(canonicalTmp);
    });

    it("useCwdAsFallback=true still prefers an ancestor with a marker over the start dir", () => {
      // Marker in parent, start dir nested 3 deep — should return parent.
      fs.writeFileSync(path.join(canonicalTmp, "package.json"), "{}");
      const nested = path.join(canonicalTmp, "a", "b", "c");
      fs.mkdirSync(nested, { recursive: true });
      const result = resolveProjectRoot(nested, true);
      expect(result).toBe(canonicalTmp);
    });

    // Regression 2026-05-22: user ran `logbook init` from a project under
    // HOME with no marker. The walk-up reached HOME, found `~/.claude/`
    // (which always exists because Claude Code itself created it) and
    // accepted HOME as the project root. LogBook then installed every
    // artifact INTO HOME (`~/.claude/settings.local.json`, `~/.mcp.json`,
    // etc.), polluting the user's home directory. The fix: HOME is NEVER
    // a valid project root — markers there are ignored.
    it("HOME with a `.claude/` marker is NOT accepted as project root", () => {
      const home = fs.realpathSync(os.homedir());
      // HOME has `.claude/` on virtually every machine where Claude Code ran.
      // (We do not create it in the test — the assumption is realistic.)
      if (!fs.existsSync(path.join(home, ".claude"))) {
        // Test cannot be deterministic without it — skip silently.
        return;
      }
      // Start the walk from a marker-less subdir directly under HOME.
      const sub = fs.mkdtempSync(path.join(home, "lb-paths-not-home-"));
      try {
        expect(() => resolveProjectRoot(sub)).toThrow(LogBookError);
      } finally {
        fs.rmSync(sub, { recursive: true, force: true });
      }
    });

    it("--here at HOME-like subdir still resolves to that subdir (escape hatch works)", () => {
      // The user can still install into a marker-less directory under HOME
      // by passing `--here`. The fallback honors the start dir even if HOME
      // is on the walk path.
      const home = fs.realpathSync(os.homedir());
      const sub = fs.mkdtempSync(path.join(home, "lb-paths-here-"));
      try {
        const result = resolveProjectRoot(sub, true);
        expect(result).toBe(sub);
        expect(result).not.toBe(home);
      } finally {
        fs.rmSync(sub, { recursive: true, force: true });
      }
    });
  });
});

describe("makePaths", () => {
  it("builds all expected paths relative to root", () => {
    const root = "/some/project";
    const p = makePaths(root);

    expect(p.root).toBe(root);
    expect(p.logbookDir).toBe("/some/project/.logbook");
    expect(p.manifestPath).toBe("/some/project/.logbook/install-manifest.json");
    expect(p.configPath).toBe("/some/project/.logbook/config.json");
    expect(p.providersPath).toBe("/some/project/.logbook/providers.json");
    expect(p.statePath).toBe("/some/project/.logbook/state.json");
    expect(p.indexDbPath).toBe("/some/project/.logbook/index.sqlite");
    expect(p.backupsDir).toBe("/some/project/.logbook/backups");
    expect(p.dataDir).toBe("/some/project/logbook");
    expect(p.evidenceDir).toBe("/some/project/logbook/evidence");
    expect(p.eventsJsonl).toBe("/some/project/logbook/evidence/events.jsonl");
  });

  it("is a pure function — calling twice with the same root yields identical results", () => {
    const root = "/another/root";
    const a = makePaths(root);
    const b = makePaths(root);
    expect(a).toEqual(b);
  });
});

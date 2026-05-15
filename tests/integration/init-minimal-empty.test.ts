/**
 * I1 — init --preset minimal --yes on an empty project
 *
 * Setup: empty temp dir with package.json + empty .claude/ dir.
 * Spawns the BUILT CJS binary (node dist/cli/index.cjs).
 * Requires pnpm build to have run before (integration tests run after build
 * in CI; locally run `pnpm build` first).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");

/** Spawn the CLI in a given cwd and return exit code + output. */
function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      LOGBOOK_HOOK_PATH: HOOK_CJS,
      ...env,
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("I1 — init minimal empty project", () => {
  let tmp: string;

  beforeAll(() => {
    // Require the built CLI to exist.
    if (!fs.existsSync(CLI)) {
      throw new Error(
        `Built CLI not found at ${CLI}. Run \`pnpm build\` before running integration tests.`,
      );
    }

    // Create temp project: package.json + empty .claude/
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-i1-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  });

  it("exits 0", () => {
    const result = runCli(["init", "--preset", "minimal", "--yes"], tmp);
    expect(result.code).toBe(0);
  });

  it("creates .logbook/install-manifest.json with exactly 2 artifacts", () => {
    const manifestPath = path.join(tmp, ".logbook", "install-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.version).toBe(1);
    expect(manifest.preset).toBe("minimal");
    expect(Array.isArray(manifest.artifacts)).toBe(true);
    expect(manifest.artifacts).toHaveLength(2);

    const kinds = manifest.artifacts.map((a: { kind: string }) => a.kind);
    expect(kinds).toContain("hook");
    expect(kinds).toContain("gitignore_entry");
  });

  it("creates .claude/settings.local.json with hook entry containing _logbookId", () => {
    const settingsPath = path.join(tmp, ".claude", "settings.local.json");
    expect(fs.existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const hooks = settings?.hooks?.PostToolUse;
    expect(Array.isArray(hooks)).toBe(true);

    const logbookEntry = hooks.find(
      (h: { _logbookId?: string }) => typeof h._logbookId === "string" && h._logbookId.startsWith("lb-"),
    );
    expect(logbookEntry).toBeDefined();
    expect(logbookEntry._logbookId).toBe("lb-hook-posttooluse-001");
  });

  it("creates .gitignore containing logbook lines", () => {
    const gitignorePath = path.join(tmp, ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, "utf8");
    expect(content).toContain(".logbook/");
    expect(content).toContain("logbook/");
    expect(content).toContain("lb-gitignore-001");
  });

  it("creates .logbook/state.json with disabled: false", () => {
    const statePath = path.join(tmp, ".logbook", "state.json");
    expect(fs.existsSync(statePath)).toBe(true);

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state.disabled).toBe(false);
  });

  it("does NOT backup .claude/settings.local.json (file did not exist before — sentinel)", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmp, ".logbook", "install-manifest.json"), "utf8"),
    );
    // settings.local.json did not exist pre-install → sentinel backup (empty sha256)
    const settingsBackup = manifest.backups.find(
      (b: { file_path: string }) => b.file_path === ".claude/settings.local.json",
    );
    // sentinel has empty sha256
    if (settingsBackup) {
      expect(settingsBackup.sha256).toBe("");
    }
    // If no backup at all, that's also fine (manifest may not record sentinel)
  });
});

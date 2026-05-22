/**
 * Integration test: `logbook snapshot` CLI command (T10a).
 *
 * Tests:
 *  1. Non-git project: exit 0, event has note, sha: undefined, dirty: undefined
 *  2. Git-initialized project with a commit: exit 0, event has 40-char sha and dirty: 0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI = path.join(PROJECT_ROOT, "dist", "cli", "index.cjs");

beforeAll(() => {
  if (!fs.existsSync(CLI)) {
    const result = spawnSync("pnpm", ["build"], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`,
      );
    }
  }
}, 90_000);

function makeTmpProject(withGit = false): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-snap-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );

  if (withGit) {
    spawnSync("git", ["init"], { cwd: dir, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", "test@test.com"], {
      cwd: dir,
      stdio: "pipe",
    });
    spawnSync("git", ["config", "user.name", "Test"], {
      cwd: dir,
      stdio: "pipe",
    });
    spawnSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "pipe" });
  }

  return dir;
}

function runCli(
  args: string[],
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readEvents(dir: string): unknown[] {
  const p = path.join(dir, "logbook", "evidence", "events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("cli-snapshot", () => {
  it("exits 0 on non-git project with note, sha and dirty undefined", () => {
    const dir = makeTmpProject(false);
    const { code, stdout } = runCli(["snapshot", "--note", "test"], dir);
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["note"]).toBe("test");
    // sha and dirty should be absent or null/undefined — we accept undefined keys
    expect(out["sha"] == null).toBe(true);
    expect(out["dirty"] == null).toBe(true);

    const events = readEvents(dir);
    // Shape-A: kind=user_entry, payload.entryType=snapshot
    const snapEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "user_entry" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "snapshot"),
    ) as Record<string, unknown> | undefined;
    expect(snapEvent).toBeDefined();
    expect(snapEvent?.["schemaVersion"]).toBe(3);
    const payload = snapEvent?.["payload"] as Record<string, unknown>;
    expect(payload?.["note"]).toBe("test");
    expect(payload?.["sha"] == null).toBe(true);
    expect(payload?.["dirty"] == null).toBe(true);
  });

  it("exits 0 on git-initialized project with 40-char sha and dirty: 0", () => {
    const dir = makeTmpProject(true);
    const { code, stdout } = runCli(["snapshot"], dir);
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["sha"]).toBe("string");
    expect((out["sha"] as string).length).toBe(40);
    expect(out["dirty"]).toBe(0);

    const events = readEvents(dir);
    const snapEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "user_entry" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "snapshot"),
    ) as Record<string, unknown> | undefined;
    expect(snapEvent).toBeDefined();
    const snapPayload = snapEvent?.["payload"] as Record<string, unknown>;
    expect(typeof snapPayload?.["sha"]).toBe("string");
    expect((snapPayload?.["sha"] as string).length).toBe(40);
    expect(snapPayload?.["dirty"]).toBe(0);
  });
});

/**
 * Integration test: `logbook session rename` CLI command (T10a).
 *
 * Tests:
 *  1. No active session → exit 1, stderr contains "no active session"
 *  2. After start with --label, rename updates sessionLabel and appends event
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

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-session-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
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

function readState(dir: string): Record<string, unknown> {
  const p = path.join(dir, ".logbook", "state.json");
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
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

describe("cli-session-rename", () => {
  it("exits 1 with 'no active session' error when no session started", () => {
    const dir = makeTmpProject();
    const { code, stderr } = runCli(["session", "rename", "foo"], dir);
    expect(code).toBe(1);
    expect(stderr.toLowerCase()).toContain("no active session");
  });

  it("renames session label and appends manual.session_rename event", () => {
    const dir = makeTmpProject();
    runCli(["start", "--label", "old"], dir);

    const { code, stdout } = runCli(["session", "rename", "new label"], dir);
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["old"]).toBe("old");
    expect(out["new"]).toBe("new label");

    const state = readState(dir);
    expect(state["sessionLabel"]).toBe("new label");

    const events = readEvents(dir);
    // Shape-A: kind=system, payload.entryType=session_rename
    const renameEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "system" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "session_rename"),
    ) as Record<string, unknown> | undefined;
    expect(renameEvent).toBeDefined();
    expect(renameEvent?.["schemaVersion"]).toBe(3);
    const payload = renameEvent?.["payload"] as Record<string, unknown>;
    expect(payload?.["old"]).toBe("old");
    expect(payload?.["new"]).toBe("new label");
  });
});

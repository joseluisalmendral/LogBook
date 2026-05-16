/**
 * Integration test: `logbook start` CLI command (T10a).
 *
 * Tests:
 *  1. exit 0, stdout JSON has sessionId (ULID) and label when --label provided
 *  2. state.json updated with session id and sessionLabel
 *  3. events.jsonl contains manual.session_start event
 *  4. second call without label updates state.session with new ULID
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
  const dir = path.join(tmp, `lb-start-${Math.random().toString(36).slice(2)}`);
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

// ULID format: 26 chars, Crockford base32 (no I L O U)
const ULID_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

describe("cli-start", () => {
  it("exits 0 and returns sessionId + label in JSON stdout", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(["start", "--label", "Iter2 work"], dir);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["sessionId"]).toBe("string");
    expect(ULID_RE.test(out["sessionId"] as string)).toBe(true);
    expect(out["label"]).toBe("Iter2 work");
  });

  it("updates state.json with session id and sessionLabel", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(["start", "--label", "Iter2 work"], dir);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const state = readState(dir);
    expect(state["session"]).toBe(out["sessionId"]);
    expect(state["sessionLabel"]).toBe("Iter2 work");
  });

  it("appends a manual.session_start event to events.jsonl", () => {
    const dir = makeTmpProject();
    runCli(["start", "--label", "Iter2 work"], dir);
    const events = readEvents(dir);
    const startEvent = events.find(
      (e) => (e as { type?: string }).type === "manual.session_start",
    ) as { type: string; sessionId?: string; label?: string } | undefined;
    expect(startEvent).toBeDefined();
    expect(startEvent?.label).toBe("Iter2 work");
  });

  it("second call without --label updates state.session with new ULID, no label in state", () => {
    const dir = makeTmpProject();
    const { stdout: first } = runCli(["start", "--label", "first"], dir);
    const firstId = (JSON.parse(first.trim()) as Record<string, unknown>)[
      "sessionId"
    ] as string;

    const { code, stdout: second } = runCli(["start"], dir);
    expect(code).toBe(0);
    const secondOut = JSON.parse(second.trim()) as Record<string, unknown>;
    const secondId = secondOut["sessionId"] as string;

    expect(ULID_RE.test(secondId)).toBe(true);
    expect(secondId).not.toBe(firstId);

    const state = readState(dir);
    expect(state["session"]).toBe(secondId);
    // No label provided — sessionLabel should be absent or empty
    expect(state["sessionLabel"] == null || state["sessionLabel"] === "").toBe(
      true,
    );
  });
});

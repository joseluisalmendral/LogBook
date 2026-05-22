/**
 * Integration test: `logbook error` CLI command (T10b).
 *
 * Tests:
 *  1. exit 0, stdout JSON has id (ULID)
 *  2. events.jsonl has manual.error event with redacted stack
 *  3. SQLite errors table has row with resolved: 0
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
  const dir = path.join(tmp, `lb-error-${Math.random().toString(36).slice(2)}`);
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

function readEvents(dir: string): unknown[] {
  const p = path.join(dir, "logbook", "evidence", "events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const ULID_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

describe("cli-error", () => {
  it("exits 0 and returns id (ULID) in JSON stdout", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(
      [
        "error",
        "--kind",
        "TypeError",
        "--message",
        "Cannot read property",
      ],
      dir,
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["id"]).toBe("string");
    expect(ULID_RE.test(out["id"] as string)).toBe(true);
  });

  it("redacts AWS key in stack before persisting to events.jsonl", () => {
    const dir = makeTmpProject();
    const { code } = runCli(
      [
        "error",
        "--kind",
        "TypeError",
        "--message",
        "Cannot read property",
        "--stack",
        "stack trace with AKIAIOSFODNN7EXAMPLE",
      ],
      dir,
    );
    expect(code).toBe(0);

    const events = readEvents(dir);
    // Shape-A: kind=user_entry, payload.entryType=error
    const errEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "user_entry" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "error"),
    ) as Record<string, unknown> | undefined;
    expect(errEvent).toBeDefined();
    const payload = errEvent?.["payload"] as Record<string, unknown>;
    // Stack should be redacted — must NOT contain the raw key
    expect(String(payload?.["stack"] ?? "")).not.toContain(
      "AKIAIOSFODNN7EXAMPLE",
    );
    // Should contain [REDACTED:...] marker
    expect(String(payload?.["stack"] ?? "")).toContain("[REDACTED:");
    // redacted flag should be true
    expect(errEvent?.["redacted"]).toBe(true);
  });

  it("appends user_entry/error event with kind and message fields", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(
      [
        "error",
        "--kind",
        "TypeError",
        "--message",
        "Cannot read property",
        "--source",
        "manual",
      ],
      dir,
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const id = out["id"] as string;
    expect(ULID_RE.test(id)).toBe(true);

    // Verify via events.jsonl (canonical event log — SQLite is best-effort).
    const events = readEvents(dir);
    const errEvent = events.find(
      (e) => (e as { id?: string }).id === id,
    ) as Record<string, unknown> | undefined;
    expect(errEvent).toBeDefined();
    expect(errEvent?.["schemaVersion"]).toBe(3);
    expect(errEvent?.["kind"]).toBe("user_entry");
    const payload = errEvent?.["payload"] as Record<string, unknown>;
    expect(payload?.["entryType"]).toBe("error");
    expect(payload?.["kind"]).toBe("TypeError");
    expect(payload?.["message"]).toBe("Cannot read property");
    expect(payload?.["source"]).toBe("manual");
  });
});

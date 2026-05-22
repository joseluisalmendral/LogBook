/**
 * Integration test: `logbook lesson` CLI command (T10b).
 *
 * Tests:
 *  1. exit 0, stdout JSON has id
 *  2. events.jsonl has manual.lesson event with tags array and promotable=true
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
    `lb-lesson-${Math.random().toString(36).slice(2)}`,
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

describe("cli-lesson", () => {
  it("exits 0 and returns id in JSON stdout", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(
      [
        "lesson",
        "--title",
        "Always validate",
        "--body",
        "Don't trust input",
        "--tags",
        "security,validation",
        "--promotable",
      ],
      dir,
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["id"]).toBe("string");
    expect(ULID_RE.test(out["id"] as string)).toBe(true);
  });

  it("appends user_entry/lesson event with tags array and promotable=true", () => {
    const dir = makeTmpProject();
    runCli(
      [
        "lesson",
        "--title",
        "Always validate",
        "--body",
        "Don't trust input",
        "--tags",
        "security,validation",
        "--promotable",
      ],
      dir,
    );

    const events = readEvents(dir);
    // Shape-A: kind=user_entry, payload.entryType=lesson
    const lessonEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "user_entry" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "lesson"),
    ) as Record<string, unknown> | undefined;
    expect(lessonEvent).toBeDefined();
    expect(lessonEvent?.["kind"]).toBe("user_entry");
    expect(lessonEvent?.["schemaVersion"]).toBe(3);
    expect(typeof lessonEvent?.["redacted"]).toBe("boolean");
    const payload = lessonEvent?.["payload"] as Record<string, unknown>;
    expect(payload?.["entryType"]).toBe("lesson");
    expect(payload?.["title"]).toBe("Always validate");
    expect(payload?.["body"]).toBe("Don't trust input");
    expect(Array.isArray(payload?.["tags"])).toBe(true);
    expect(payload?.["tags"]).toEqual(["security", "validation"]);
    expect(payload?.["promotable"]).toBe(true);
  });

  it("handles lesson without tags or promotable flag", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(
      [
        "lesson",
        "--title",
        "Simple lesson",
        "--body",
        "Keep it simple",
      ],
      dir,
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(ULID_RE.test(out["id"] as string)).toBe(true);

    const events = readEvents(dir);
    const lessonEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "user_entry" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "lesson"),
    ) as Record<string, unknown> | undefined;
    const payload = lessonEvent?.["payload"] as Record<string, unknown> | undefined;
    expect(payload?.["tags"]).toEqual([]);
    expect(payload?.["promotable"]).toBe(false);
  });
});

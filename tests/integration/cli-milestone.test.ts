/**
 * Integration test: `logbook milestone` CLI command (T10b).
 *
 * Tests:
 *  1. exit 0, stdout JSON has id
 *  2. events.jsonl has manual.milestone event with sessionIds and decisionIds as arrays
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
    `lb-milestone-${Math.random().toString(36).slice(2)}`,
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

describe("cli-milestone", () => {
  it("exits 0 and returns id in JSON stdout", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(
      [
        "milestone",
        "--title",
        "MVP done",
        "--description",
        "Completed all iteration 2 tasks",
        "--session-ids",
        "abc,def",
        "--decision-ids",
        "0001,0002",
      ],
      dir,
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["id"]).toBe("string");
    expect(ULID_RE.test(out["id"] as string)).toBe(true);
  });

  it("appends manual.milestone event with sessionIds and decisionIds as arrays", () => {
    const dir = makeTmpProject();
    runCli(
      [
        "milestone",
        "--title",
        "MVP done",
        "--description",
        "Completed all iteration 2 tasks",
        "--session-ids",
        "abc,def",
        "--decision-ids",
        "0001,0002",
        "--tags",
        "v2,release",
      ],
      dir,
    );

    const events = readEvents(dir);
    const msEvent = events.find(
      (e) => (e as { type?: string }).type === "manual.milestone",
    ) as Record<string, unknown> | undefined;
    expect(msEvent).toBeDefined();
    expect(msEvent?.["title"]).toBe("MVP done");
    expect(msEvent?.["description"]).toBe(
      "Completed all iteration 2 tasks",
    );
    expect(Array.isArray(msEvent?.["sessionIds"])).toBe(true);
    expect(msEvent?.["sessionIds"]).toEqual(["abc", "def"]);
    expect(Array.isArray(msEvent?.["decisionIds"])).toBe(true);
    expect(msEvent?.["decisionIds"]).toEqual(["0001", "0002"]);
    expect(Array.isArray(msEvent?.["tags"])).toBe(true);
    expect(msEvent?.["tags"]).toEqual(["v2", "release"]);
  });

  it("handles milestone without optional arrays", () => {
    const dir = makeTmpProject();
    const { code } = runCli(
      [
        "milestone",
        "--title",
        "Simple milestone",
        "--description",
        "Done",
      ],
      dir,
    );
    expect(code).toBe(0);

    const events = readEvents(dir);
    const msEvent = events.find(
      (e) => (e as { type?: string }).type === "manual.milestone",
    ) as Record<string, unknown> | undefined;
    expect(msEvent?.["sessionIds"]).toEqual([]);
    expect(msEvent?.["decisionIds"]).toEqual([]);
    expect(msEvent?.["tags"]).toEqual([]);
  });
});

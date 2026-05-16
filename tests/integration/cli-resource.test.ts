/**
 * Integration test: `logbook resource` CLI command (T10b).
 *
 * Tests:
 *  1. Valid url kind: exit 0, stdout JSON has id
 *  2. Invalid kind: exit 1, stderr contains "invalid kind"
 *  3. File kind with path escape: exit 1
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
    `lb-resource-${Math.random().toString(36).slice(2)}`,
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

describe("cli-resource", () => {
  it("exits 0 for valid url kind and returns id", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(
      [
        "resource",
        "--kind",
        "url",
        "--uri",
        "https://example.com",
        "--title",
        "Example",
      ],
      dir,
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["id"]).toBe("string");
    expect(ULID_RE.test(out["id"] as string)).toBe(true);
  });

  it("appends manual.resource event with correct fields", () => {
    const dir = makeTmpProject();
    runCli(
      [
        "resource",
        "--kind",
        "url",
        "--uri",
        "https://example.com",
        "--title",
        "Example",
        "--tags",
        "ref,docs",
      ],
      dir,
    );
    const events = readEvents(dir);
    const resEvent = events.find(
      (e) => (e as { type?: string }).type === "manual.resource",
    ) as Record<string, unknown> | undefined;
    expect(resEvent).toBeDefined();
    expect(resEvent?.["kind"]).toBe("url");
    expect(resEvent?.["uri"]).toBe("https://example.com");
    expect(resEvent?.["title"]).toBe("Example");
    expect(Array.isArray(resEvent?.["tags"])).toBe(true);
    expect(resEvent?.["tags"]).toEqual(["ref", "docs"]);
  });

  it("exits 1 when kind is invalid, stderr contains 'invalid kind'", () => {
    const dir = makeTmpProject();
    const { code, stderr } = runCli(
      ["resource", "--kind", "invalid", "--uri", "x"],
      dir,
    );
    expect(code).toBe(1);
    expect(stderr.toLowerCase()).toContain("invalid kind");
  });

  it("exits 1 when kind=file and uri escapes project root", () => {
    const dir = makeTmpProject();
    const { code } = runCli(
      ["resource", "--kind", "file", "--uri", "/etc/passwd"],
      dir,
    );
    expect(code).toBe(1);
  });
});

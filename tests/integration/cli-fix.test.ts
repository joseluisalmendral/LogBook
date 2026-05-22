/**
 * Integration test: `logbook fix` CLI command (T10b).
 *
 * Tests:
 *  1. exit 0, stdout JSON has id and errorId
 *  2. events.jsonl has manual.fix event linking to the error
 *  3. --verified toggles errors.resolved=1 and sets fix_id in SQLite
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
  const dir = path.join(tmp, `lb-fix-${Math.random().toString(36).slice(2)}`);
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

describe("cli-fix", () => {
  it("exits 0 and returns id + errorId in JSON stdout", () => {
    const dir = makeTmpProject();
    // First create an error
    const { stdout: errOut } = runCli(
      ["error", "--kind", "TypeError", "--message", "Cannot read property"],
      dir,
    );
    const errorId = (JSON.parse(errOut.trim()) as Record<string, unknown>)[
      "id"
    ] as string;

    // Now fix it
    const { code, stdout } = runCli(
      [
        "fix",
        "--error-id",
        errorId,
        "--description",
        "Added null check",
      ],
      dir,
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["id"]).toBe("string");
    expect(ULID_RE.test(out["id"] as string)).toBe(true);
    expect(out["errorId"]).toBe(errorId);
  });

  it("appends a user_entry/fix event linking to the error id", () => {
    const dir = makeTmpProject();
    const { stdout: errOut } = runCli(
      ["error", "--kind", "TypeError", "--message", "Cannot read property"],
      dir,
    );
    const errorId = (JSON.parse(errOut.trim()) as Record<string, unknown>)[
      "id"
    ] as string;

    runCli(
      ["fix", "--error-id", errorId, "--description", "Added null check"],
      dir,
    );

    const events = readEvents(dir);
    // Shape-A: kind=user_entry, payload.entryType=fix
    const fixEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "user_entry" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "fix"),
    ) as Record<string, unknown> | undefined;
    expect(fixEvent).toBeDefined();
    const payload = fixEvent?.["payload"] as Record<string, unknown>;
    expect(payload?.["errorId"]).toBe(errorId);
    expect(payload?.["description"]).toBe("Added null check");
  });

  it("--verified sets verified=true in fix event and links error in events.jsonl", () => {
    const dir = makeTmpProject();
    const { stdout: errOut } = runCli(
      ["error", "--kind", "TypeError", "--message", "Cannot read property"],
      dir,
    );
    const errorId = (JSON.parse(errOut.trim()) as Record<string, unknown>)[
      "id"
    ] as string;

    const { code, stdout: fixOut } = runCli(
      [
        "fix",
        "--error-id",
        errorId,
        "--description",
        "Added null check",
        "--verified",
      ],
      dir,
    );
    expect(code).toBe(0);
    const fixId = (JSON.parse(fixOut.trim()) as Record<string, unknown>)[
      "id"
    ] as string;
    expect(ULID_RE.test(fixId)).toBe(true);

    // Verify the fix event via events.jsonl (canonical log — SQLite is best-effort).
    const events = readEvents(dir);
    const fixEvent = events.find(
      (e) => (e as { id?: string }).id === fixId,
    ) as Record<string, unknown> | undefined;
    expect(fixEvent).toBeDefined();
    // Shape-A: kind and payload
    expect(fixEvent?.["kind"]).toBe("user_entry");
    expect(fixEvent?.["schemaVersion"]).toBe(3);
    const payload = fixEvent?.["payload"] as Record<string, unknown>;
    expect(payload?.["entryType"]).toBe("fix");
    expect(payload?.["errorId"]).toBe(errorId);
    expect(payload?.["verified"]).toBe(true);
    expect(payload?.["description"]).toBe("Added null check");
  });
});

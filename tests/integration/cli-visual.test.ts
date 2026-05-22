/**
 * Integration test: `logbook visual` CLI command (T10a).
 *
 * Tests:
 *  1. Valid path inside project → exit 0, event has project-relative path and note
 *  2. Path outside project → exit 1 (path-escape error)
 *  3. No file copy occurs (no logbook/visuals/ dir created)
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
    `lb-visual-${Math.random().toString(36).slice(2)}`,
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

describe("cli-visual", () => {
  it("records a reference to a visual file and exits 0", () => {
    const dir = makeTmpProject();

    // Create a test image file inside the project
    const screenshotDir = path.join(dir, "tmp", "screenshots");
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, "foo.png");
    fs.writeFileSync(screenshotPath, ""); // empty file is fine

    const { code, stdout } = runCli(
      ["visual", "tmp/screenshots/foo.png", "--note", "design mockup"],
      dir,
    );
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["path"]).toBe("tmp/screenshots/foo.png");
    expect(out["note"]).toBe("design mockup");

    const events = readEvents(dir);
    // Shape-A: kind=user_entry, payload.entryType=visual
    const visualEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "user_entry" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "visual"),
    ) as Record<string, unknown> | undefined;
    expect(visualEvent).toBeDefined();
    expect(visualEvent?.["schemaVersion"]).toBe(3);
    const visualPayload = visualEvent?.["payload"] as Record<string, unknown>;
    expect(visualPayload?.["path"]).toBe("tmp/screenshots/foo.png");
    expect(visualPayload?.["note"]).toBe("design mockup");
  });

  it("exits 1 when path escapes the project root", () => {
    const dir = makeTmpProject();
    const { code, stderr } = runCli(["visual", "/etc/passwd"], dir);
    expect(code).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });

  it("does NOT copy the file (no logbook/visuals/ directory)", () => {
    const dir = makeTmpProject();

    // Create test file
    const screenshotDir = path.join(dir, "tmp", "screenshots");
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.writeFileSync(path.join(screenshotDir, "bar.png"), "original content");

    runCli(["visual", "tmp/screenshots/bar.png"], dir);

    // No visuals dir should be created
    const visualsDir = path.join(dir, "logbook", "visuals");
    expect(fs.existsSync(visualsDir)).toBe(false);

    // Original file should be untouched
    const content = fs.readFileSync(
      path.join(screenshotDir, "bar.png"),
      "utf8",
    );
    expect(content).toBe("original content");
  });
});

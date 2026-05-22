/**
 * Integration test: `logbook phase` CLI command (T10a).
 *
 * Tests:
 *  1. After start, `logbook phase design` sets state.currentPhase and appends event
 *  2. `logbook phase apply` updates state.currentPhase and appends second event
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
  const dir = path.join(tmp, `lb-phase-${Math.random().toString(36).slice(2)}`);
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

describe("cli-phase", () => {
  it("sets currentPhase to 'design' and appends system/phase_change event", () => {
    const dir = makeTmpProject();
    // Start a session first
    runCli(["start"], dir);

    const { code, stdout } = runCli(["phase", "design"], dir);
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["phase"]).toBe("design");

    const state = readState(dir);
    expect(state["currentPhase"]).toBe("design");

    const events = readEvents(dir);
    // Shape-A: kind=system, payload.entryType=phase_change
    const phaseEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "system" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "phase_change"),
    ) as Record<string, unknown> | undefined;
    expect(phaseEvent).toBeDefined();
    expect(phaseEvent?.["schemaVersion"]).toBe(3);
    const payload = phaseEvent?.["payload"] as Record<string, unknown>;
    expect(payload?.["phase"]).toBe("design");
  });

  it("updates currentPhase to 'apply' and appends second system/phase_change event", () => {
    const dir = makeTmpProject();
    runCli(["start"], dir);
    runCli(["phase", "design"], dir);
    const { code, stdout } = runCli(["phase", "apply"], dir);
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["phase"]).toBe("apply");

    const state = readState(dir);
    expect(state["currentPhase"]).toBe("apply");

    const events = readEvents(dir);
    const phaseEvents = events.filter(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "system" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "phase_change"),
    );
    expect(phaseEvents.length).toBe(2);
  });
});

/**
 * Integration test: `logbook summarize` CLI command (T8).
 *
 * Uses LOGBOOK_LLM_MOCK=1 — zero real LLM calls.
 *
 * Tests:
 *  1. `summarize milestone last --json` exits 0, writes summary file, returns JSON with summaryPath
 *  2. `summarize project --json` exits 0, project summary file exists with mock content
 *  3. `summarize milestone last --json` exits 1 (no events.jsonl) with error message in stderr
 *
 * TDD Cycle:
 *   RED  → fails with "summarize is not a subcommand" (command not registered yet)
 *   GREEN → implement CLI commands
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

function makeTmpProject(): { dir: string; eventsJsonl: string } {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(tmp, `lb-summ-cli-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
  const eventsJsonl = path.join(dir, "logbook", "evidence", "events.jsonl");
  return { dir, eventsJsonl };
}

function writeEvents(eventsJsonl: string): string {
  const milestoneId = "m-01JVTTEST1234567";
  const events = [
    { id: "ev-001", type: "manual.decision", ts: "2026-01-01T10:00:00.000Z", title: "Use JSONL" },
    { id: "ev-002", type: "manual.error", ts: "2026-01-01T10:05:00.000Z", title: "Compile error" },
    { id: milestoneId, type: "manual.milestone", ts: "2026-01-01T10:10:00.000Z", title: "v1 done" },
  ];
  fs.writeFileSync(eventsJsonl, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return milestoneId;
}

function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("cli-summarize", () => {
  it("summarize milestone last --json exits 0 and writes summary file (LOGBOOK_LLM_MOCK=1)", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const milestoneId = writeEvents(eventsJsonl);

    const { code, stdout, stderr } = runCli(
      ["summarize", "milestone", "last", "--json"],
      dir,
      { LOGBOOK_LLM_MOCK: "1" },
    );

    expect(stderr).toBe("");
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["ok"]).toBe(true);
    expect(typeof out["summaryPath"]).toBe("string");
    expect(typeof out["bytes"]).toBe("number");
    expect((out["bytes"] as number) > 0).toBe(true);

    const summaryPath = out["summaryPath"] as string;
    expect(fs.existsSync(summaryPath)).toBe(true);
    const content = fs.readFileSync(summaryPath, "utf-8");
    // Mock returns a deterministic summary containing the milestoneId
    expect(content.length).toBeGreaterThan(0);
    expect(summaryPath).toContain(milestoneId);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("summarize project --json exits 0 and writes project.md (LOGBOOK_LLM_MOCK=1)", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    writeEvents(eventsJsonl);

    const { code, stdout, stderr } = runCli(
      ["summarize", "project", "--json"],
      dir,
      { LOGBOOK_LLM_MOCK: "1" },
    );

    expect(stderr).toBe("");
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["ok"]).toBe(true);
    expect(typeof out["summaryPath"]).toBe("string");

    const summaryPath = out["summaryPath"] as string;
    expect(summaryPath).toMatch(/project\.md$/);
    expect(fs.existsSync(summaryPath)).toBe(true);
    expect(fs.readFileSync(summaryPath, "utf-8").length).toBeGreaterThan(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("summarize milestone last --json exits 1 and returns ok=false when no events.jsonl exists", () => {
    const { dir } = makeTmpProject();
    // Do NOT write events.jsonl — want ok=false path

    const { code, stdout } = runCli(
      ["summarize", "milestone", "last", "--json"],
      dir,
      { LOGBOOK_LLM_MOCK: "1" },
    );

    expect(code).toBe(1);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["ok"]).toBe(false);
    expect(typeof out["error"]).toBe("string");
    expect((out["error"] as string).length).toBeGreaterThan(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

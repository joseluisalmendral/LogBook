/**
 * Integration test: `logbook teaching-script` CLI command (T12).
 *
 * Uses LOGBOOK_LLM_MOCK=1 — zero real LLM calls.
 *
 * Tests:
 *  1. `teaching-script last --json` exits 0, writes file, returns JSON with filePath
 *  2. Run again → file updated; content idempotent (markers still present)
 *  3. No milestone in events → exit 1 with "no milestones" error
 *
 * TDD Cycle:
 *   RED  → fails with "teaching-script is not a subcommand" (command not registered)
 *   GREEN → implement CLI command
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
  const dir = path.join(tmp, `lb-ts-cli-${Math.random().toString(36).slice(2)}`);
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
  const milestoneId = "m-01JVTTS1234INTEG";
  const events = [
    { id: "ev-001", type: "manual.decision", ts: "2026-01-01T10:00:00.000Z", title: "Use JSONL" },
    { id: "ev-002", type: "manual.error", ts: "2026-01-01T10:05:00.000Z", title: "Compile error" },
    { id: "ev-003", type: "manual.fix", ts: "2026-01-01T10:07:00.000Z", summary: "Fixed import" },
    { id: "ev-004", type: "manual.lesson", ts: "2026-01-01T10:09:00.000Z", text: "Add .js extensions" },
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

describe("cli-teaching-script", () => {
  it("teaching-script last --json exits 0 and writes file (LOGBOOK_LLM_MOCK=1)", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const milestoneId = writeEvents(eventsJsonl);

    const { code, stdout, stderr } = runCli(
      ["teaching-script", "last", "--json"],
      dir,
      { LOGBOOK_LLM_MOCK: "1" },
    );

    expect(stderr).toBe("");
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["ok"]).toBe(true);
    expect(typeof out["filePath"]).toBe("string");
    expect(typeof out["bytes"]).toBe("number");
    expect((out["bytes"] as number) > 0).toBe(true);

    const filePath = out["filePath"] as string;
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain(milestoneId);

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("<!-- logbook:teaching-script start v=1 -->");
    expect(content).toContain("<!-- logbook:teaching-script end -->");
    expect(content.length).toBeGreaterThan(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("second run updates content inside markers; markers still present", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    writeEvents(eventsJsonl);

    // First run
    const first = runCli(
      ["teaching-script", "last", "--json"],
      dir,
      { LOGBOOK_LLM_MOCK: "1" },
    );
    expect(first.code).toBe(0);
    const firstOut = JSON.parse(first.stdout.trim()) as Record<string, unknown>;
    const filePath = firstOut["filePath"] as string;
    expect(fs.existsSync(filePath)).toBe(true);

    // Add content outside markers (simulate user edit)
    const afterFirst = fs.readFileSync(filePath, "utf-8");
    fs.writeFileSync(filePath, "# Header preserved\n\n" + afterFirst, "utf-8");

    // Second run
    const second = runCli(
      ["teaching-script", "last", "--json"],
      dir,
      { LOGBOOK_LLM_MOCK: "1" },
    );
    expect(second.code).toBe(0);
    const secondOut = JSON.parse(second.stdout.trim()) as Record<string, unknown>;
    expect(secondOut["ok"]).toBe(true);

    const finalContent = fs.readFileSync(filePath, "utf-8");
    // Outside content preserved
    expect(finalContent).toContain("# Header preserved");
    // Markers still present
    expect(finalContent).toContain("<!-- logbook:teaching-script start v=1 -->");
    expect(finalContent).toContain("<!-- logbook:teaching-script end -->");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 with ok=false error when no milestones in events (LOGBOOK_LLM_MOCK=1)", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    // Write events without any milestone
    const events = [
      { id: "ev-001", type: "manual.decision", ts: "2026-01-01T10:00:00.000Z", title: "A decision" },
    ];
    fs.writeFileSync(eventsJsonl, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const { code, stdout } = runCli(
      ["teaching-script", "last", "--json"],
      dir,
      { LOGBOOK_LLM_MOCK: "1" },
    );

    expect(code).toBe(1);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out["ok"]).toBe(false);
    expect(typeof out["error"]).toBe("string");
    expect((out["error"] as string).toLowerCase()).toContain("milestone");

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

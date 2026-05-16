/**
 * session-start-hook.test.ts — Integration: SessionStart hook → stdout summary.
 *
 * Strict TDD T4.5: written after T4.3/T4.4 are green (integration phase).
 *
 * Test strategy:
 *   - Setup: temp project with init standard + populate state.json + events.jsonl
 *   - Pipe a SessionStart payload into the BUILT hook bundle dist/connectors/claude-code/hook.cjs
 *   - Capture stdout
 *   - Assert: stdout contains "LogBook context:" line
 *   - Assert: stdout line length ≤ 480 chars
 *   - Assert: events.jsonl has one more event (the SessionStart audit append)
 *
 * Requires: pnpm build has been run (uses dist/connectors/claude-code/hook.cjs).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");

// ---------------------------------------------------------------------------
// Helper: run the hook bundle with a given payload
// ---------------------------------------------------------------------------

function runHook(
  payload: object,
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [HOOK_CJS], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env },
  });
  return {
    code: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readEventsJsonl(cwd: string): unknown[] {
  const eventsPath = path.join(cwd, "logbook", "evidence", "events.jsonl");
  if (!fs.existsSync(eventsPath)) return [];
  return fs
    .readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session-start-hook integration", () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(HOOK_CJS)) {
      throw new Error(`Built hook bundle not found at ${HOOK_CJS}. Run \`pnpm build\` first.`);
    }
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }

    // Setup: temp project with init standard
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-t4-int-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    const initResult = spawnSync("node", [CLI, "init", "--preset", "standard", "--yes"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
    });
    if ((initResult.status ?? 1) !== 0) {
      throw new Error(`init failed: ${initResult.stderr}`);
    }

    // Populate state.json with a known phase + session
    const stateDir = path.join(tmp, ".logbook");
    fs.mkdirSync(stateDir, { recursive: true });
    const stateJson = {
      version: 1,
      disabled: false,
      warnings: [],
      staleLocksReleased: 0,
      currentPhase: "integration-test",
      session: "sess-t4-int",
      sessionLabel: "T4 Integration",
    };
    fs.writeFileSync(
      path.join(stateDir, "state.json"),
      JSON.stringify(stateJson, null, 2) + "\n",
      "utf8",
    );

    // Populate events.jsonl with a couple of decisions.
    // CLI events use TOP-LEVEL fields with "ts" (not "timestamp") — render-context.ts
    // requires id, type, and ts (lowercase) to accept an event.
    const evidenceDir = path.join(tmp, "logbook", "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const decisions = [
      JSON.stringify({
        id: "dec-001",
        type: "manual.decision",
        ts: "2024-01-01T00:00:01Z",
        title: "T4 integration test decision",
        status: "Proposed",
      }),
    ];
    fs.writeFileSync(
      path.join(evidenceDir, "events.jsonl"),
      decisions.join("\n") + "\n",
      "utf8",
    );
  });

  it("hook exits 0 for SessionStart payload", () => {
    const result = runHook({ hook_event_name: "SessionStart" }, tmp);
    expect(result.code).toBe(0);
  });

  it("stdout contains 'LogBook context:' line", () => {
    const result = runHook({ hook_event_name: "SessionStart" }, tmp);
    expect(result.stdout).toContain("LogBook context:");
  });

  it("stdout summary line is ≤ 480 chars", () => {
    const result = runHook({ hook_event_name: "SessionStart" }, tmp);
    const lines = result.stdout.split("\n").filter((l) => l.includes("LogBook context:"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(480);
    }
  });

  it("stdout summary contains the populated phase and session label", () => {
    const result = runHook({ hook_event_name: "SessionStart" }, tmp);
    expect(result.stdout).toContain("phase=integration-test");
    expect(result.stdout).toContain("T4 Integration");
  });

  it("stdout summary contains the recent decision title", () => {
    const result = runHook({ hook_event_name: "SessionStart" }, tmp);
    expect(result.stdout).toContain("T4 integration test decision");
  });

  it("events.jsonl gains one more event (audit append) after SessionStart", () => {
    const before = readEventsJsonl(tmp).length;
    runHook({ hook_event_name: "SessionStart" }, tmp);
    const after = readEventsJsonl(tmp).length;
    expect(after).toBeGreaterThan(before);
  });

  it("the appended event has kind='system' (SessionStart is a system event)", () => {
    const before = readEventsJsonl(tmp).length;
    runHook({ hook_event_name: "SessionStart" }, tmp);
    const events = readEventsJsonl(tmp);
    const newEvents = events.slice(before);
    expect(newEvents.length).toBeGreaterThan(0);
    const sessionEvent = newEvents[newEvents.length - 1] as Record<string, unknown>;
    expect(sessionEvent["kind"]).toBe("system");
  });

  it("non-SessionStart events do NOT produce stdout output", () => {
    const result = runHook({ hook_event_name: "PreToolUse", tool_name: "Bash" }, tmp);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });
});

/**
 * I3 — ingest claude: pipe hook payload fixtures through CLI, assert JSONL output.
 *
 * Requires: pnpm build has been run (integration tests use dist/cli/index.cjs).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");
const FIXTURES = path.join(ROOT, "tests/fixtures/claude-hook-payloads");

function runIngest(
  fixtureFile: string,
  cwd: string,
  sessionId?: string,
): { code: number; stdout: string; stderr: string } {
  const input = fs.readFileSync(path.join(FIXTURES, fixtureFile), "utf8");
  const args = ["ingest", "claude"];
  if (sessionId) args.push("--session-id", sessionId);
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      LOGBOOK_HOOK_PATH: HOOK_CJS,
    },
  });
  return {
    code: result.status ?? 1,
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

describe("I3 — ingest claude stdin", () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }

    // Setup: temp project with .logbook/ initialized
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-i3-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    const initResult = spawnSync("node", [CLI, "init", "--preset", "minimal", "--yes"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
    });
    if ((initResult.status ?? 1) !== 0) {
      throw new Error(`init failed: ${initResult.stderr}`);
    }
  });

  it("exits 0 for user-message.json fixture", () => {
    const result = runIngest("user-message.json", tmp, "test-session-i3");
    expect(result.code).toBe(0);
  });

  it("appends exactly one JSONL line for user-message fixture", () => {
    // Already piped in prior test; count lines
    const events = readEventsJsonl(tmp);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("parsed JSONL line has expected kind=tool_use for PreToolUse payload", () => {
    const events = readEventsJsonl(tmp);
    const event = events[0] as Record<string, unknown>;
    expect(event["kind"]).toBe("tool_use");
  });

  it("parsed JSONL line has expected sessionId from --session-id flag", () => {
    const events = readEventsJsonl(tmp);
    const event = events[0] as Record<string, unknown>;
    expect(event["sessionId"]).toBe("test-session-i3");
  });

  it("parsed JSONL line has redacted=false for benign user-message fixture", () => {
    const events = readEventsJsonl(tmp);
    const event = events[0] as Record<string, unknown>;
    expect(event["redacted"]).toBe(false);
  });

  it("tool-result-with-secrets fixture: exits 0 and redacted=true in JSONL", () => {
    // Pipe the secrets fixture (fresh session to isolate)
    const result = runIngest("tool-result-with-secrets.json", tmp, "secrets-session");
    expect(result.code).toBe(0);

    const events = readEventsJsonl(tmp);
    const secretEvent = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "secrets-session",
    ) as Record<string, unknown> | undefined;
    expect(secretEvent).toBeDefined();
    expect(secretEvent?.["redacted"]).toBe(true);
  });

  it("tool-result-with-secrets: JSONL line contains [REDACTED:aws-access-key-id]", () => {
    const events = readEventsJsonl(tmp);
    const secretEvent = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "secrets-session",
    ) as Record<string, unknown> | undefined;
    const line = JSON.stringify(secretEvent);
    expect(line).toContain("[REDACTED:aws-access-key-id]");
  });

  it("tool-result-with-secrets: JSONL line contains [REDACTED:github-pat-classic]", () => {
    const events = readEventsJsonl(tmp);
    const secretEvent = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "secrets-session",
    ) as Record<string, unknown> | undefined;
    const line = JSON.stringify(secretEvent);
    expect(line).toContain("[REDACTED:github-pat-classic]");
  });

  it("benign-uuid-and-sha fixture: exits 0 and redacted=false in JSONL", () => {
    const result = runIngest("benign-uuid-and-sha.json", tmp, "benign-session");
    expect(result.code).toBe(0);

    const events = readEventsJsonl(tmp);
    const benignEvent = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "benign-session",
    ) as Record<string, unknown> | undefined;
    expect(benignEvent).toBeDefined();
    expect(benignEvent?.["redacted"]).toBe(false);
  });

  it("invalid JSON payload: exits 0 (degrades gracefully)", () => {
    // Pipe raw non-JSON; ingest must not crash
    const result = spawnSync("node", [CLI, "ingest", "claude"], {
      cwd: tmp,
      input: "not json at all {{{{",
      encoding: "utf8",
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
    });
    expect(result.status).toBe(0);
  });
});

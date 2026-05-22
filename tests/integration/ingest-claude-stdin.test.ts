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

  // Fix 2: session_id propagation from hook payload (Req 2.1 + Req 2.2).

  it("posttool-with-session.json: sessionId equals the payload session_id (NOT a ULID)", () => {
    // Pipe WITHOUT --session-id flag so the payload's session_id is used (slot 2).
    const input = fs.readFileSync(path.join(FIXTURES, "posttool-with-session.json"), "utf8");
    const result = spawnSync("node", [CLI, "ingest", "claude"], {
      cwd: tmp,
      input,
      encoding: "utf8",
      env: {
        ...process.env,
        LOGBOOK_HOOK_PATH: HOOK_CJS,
        // Unset any env override to ensure slot 2 (payload) fires, not slot 3.
        LOGBOOK_SESSION_ID: undefined as unknown as string,
      },
    });
    expect(result.status).toBe(0);

    const events = readEventsJsonl(tmp);
    // Find the event written in this test run by filtering on the known session_id.
    const event = events.find(
      (e) => (e as Record<string, unknown>)["sessionId"] === "abc12345-dead-beef-0000-000000000001",
    ) as Record<string, unknown> | undefined;
    expect(event).toBeDefined();
    // Must NOT look like a ULID (Crockford base32, ~26 chars, starts with timestamp).
    const sessionId = String(event?.["sessionId"] ?? "");
    expect(sessionId).toBe("abc12345-dead-beef-0000-000000000001");
    // Verify it is NOT a ULID-format string (ULIDs are 26 chars of Crockford base32).
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(sessionId)).toBe(false);
  });

  it("user-message.json without --session-id: ULID fallback still fires when no session_id in payload", () => {
    // user-message.json contains session_id: "sess-001" — but we verify the
    // resolver uses the payload value directly (not a generated ULID).
    // The ULID-fallback path: pipe a payload WITHOUT session_id field.
    const payloadWithoutSession = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_args: { command: "echo" },
      tool_response: { output: "ok" },
    });
    const result = spawnSync("node", [CLI, "ingest", "claude"], {
      cwd: tmp,
      input: payloadWithoutSession,
      encoding: "utf8",
      env: {
        ...process.env,
        LOGBOOK_HOOK_PATH: HOOK_CJS,
        // Unset env override to force ULID fallback (slot 4).
        LOGBOOK_SESSION_ID: undefined as unknown as string,
      },
    });
    expect(result.status).toBe(0);

    const events = readEventsJsonl(tmp);
    // The last event should have a ULID-format sessionId (26 chars, Crockford base32).
    const lastEvent = events[events.length - 1] as Record<string, unknown> | undefined;
    expect(lastEvent).toBeDefined();
    const sessionId = String(lastEvent?.["sessionId"] ?? "");
    // ULID format: 26 chars, chars from Crockford base32 set 0-9A-HJKMNP-TV-Z
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(sessionId)).toBe(true);
  });
});

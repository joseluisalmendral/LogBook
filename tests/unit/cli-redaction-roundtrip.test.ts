/**
 * CLI redaction roundtrip tests (PR 2).
 *
 * For each CLI command that writes user-authored content, inject a fake AWS
 * access key (AKIAIOSFODNN7EXAMPLE) into the most user-controllable string
 * argument, read back the stored JSONL event, and assert:
 *  1. The raw token is NOT present anywhere in the stored event.
 *  2. A [REDACTED: marker IS present.
 *  3. The event has the new Shape-A fields (schemaVersion=3, kind, payload).
 *
 * These tests run against the BUILT CLI (dist/cli/index.cjs), so they require
 * `pnpm build` to be run first. The beforeAll guard handles this automatically.
 *
 * Commands covered: lesson, decision, resource, milestone, error, fix,
 *   phase (system kind — no user string, skip redaction test),
 *   start (system kind — no user string, skip redaction test),
 *   snapshot, visual (no user string in note), annotate, promote
 *   (teaching value is enumerated — no redaction needed).
 *
 * Commands that do NOT accept free-text user strings:
 *   start, phase, promote, snapshot → only verify Shape-A output, not redaction.
 *
 * session rename → also tested.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI = path.join(PROJECT_ROOT, "dist", "cli", "index.cjs");

const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const REDACTED_MARKER = "[REDACTED:";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(): { dir: string; eventsJsonl: string } {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(tmp, `lb-redact-rt-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
  return {
    dir,
    eventsJsonl: path.join(dir, "logbook", "evidence", "events.jsonl"),
  };
}

function runCli(
  args: string[],
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 20_000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readLastEvent(eventsJsonl: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(eventsJsonl)) return undefined;
  const lines = fs.readFileSync(eventsJsonl, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1];
  if (!last) return undefined;
  return JSON.parse(last) as Record<string, unknown>;
}

/**
 * Assert that a Shape-A event does NOT contain the raw secret anywhere,
 * and DOES contain the redaction marker.
 */
function assertRedacted(event: Record<string, unknown>): void {
  const serialized = JSON.stringify(event);
  expect(serialized).not.toContain(FAKE_AWS_KEY);
  expect(serialized).toContain(REDACTED_MARKER);
  expect(event["redacted"]).toBe(true);
}

/**
 * Assert Shape-A envelope fields.
 */
function assertShapeA(
  event: Record<string, unknown>,
  expectedKind: string,
  expectedEntryType: string,
): void {
  expect(event["schemaVersion"]).toBe(3);
  expect(event["kind"]).toBe(expectedKind);
  const payload = event["payload"] as Record<string, unknown>;
  expect(payload["entryType"]).toBe(expectedEntryType);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cli redaction roundtrip — Shape-A events contain no raw secrets", () => {
  it("lesson: body with AWS key is redacted before storage", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const { code } = runCli(
      ["lesson", "--title", "test", "--body", `secret=${FAKE_AWS_KEY} end`],
      dir,
    );
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "user_entry", "lesson");
    assertRedacted(event!);
  });

  it("decision: context with AWS key is redacted before storage", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const { code } = runCli(
      [
        "decision",
        "--title",
        "Use foo",
        "--chosen",
        "foo",
        "--context",
        `leaked=${FAKE_AWS_KEY}`,
      ],
      dir,
    );
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "user_entry", "decision");
    assertRedacted(event!);
  });

  it("resource: uri with AWS key is redacted before storage", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const { code } = runCli(
      [
        "resource",
        "--kind",
        "url",
        "--uri",
        `https://example.com?token=${FAKE_AWS_KEY}`,
        "--title",
        "resource title",
      ],
      dir,
    );
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "user_entry", "resource");
    assertRedacted(event!);
  });

  it("milestone: description with AWS key is redacted before storage", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const { code } = runCli(
      [
        "milestone",
        "--title",
        "milestone title",
        "--description",
        `leaked=${FAKE_AWS_KEY}`,
      ],
      dir,
    );
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "user_entry", "milestone");
    assertRedacted(event!);
  });

  it("error: stack with AWS key is redacted before storage", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const { code } = runCli(
      [
        "error",
        "--kind",
        "TypeError",
        "--message",
        "Cannot read",
        "--stack",
        `Error at auth with key=${FAKE_AWS_KEY}`,
      ],
      dir,
    );
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "user_entry", "error");
    assertRedacted(event!);
  });

  it("fix: description with AWS key is redacted before storage", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    // Create an error first to get an errorId
    const { stdout: errOut } = runCli(
      ["error", "--kind", "TypeError", "--message", "original"],
      dir,
    );
    const errorId = (JSON.parse(errOut.trim()) as Record<string, unknown>)["id"] as string;

    const { code } = runCli(
      [
        "fix",
        "--error-id",
        errorId,
        "--description",
        `fixed key=${FAKE_AWS_KEY}`,
      ],
      dir,
    );
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "user_entry", "fix");
    assertRedacted(event!);
  });

  it("start: stores Shape-A system/session_start event", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const { code } = runCli(["start", "--label", "test session"], dir);
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "system", "session_start");
    expect(event!["schemaVersion"]).toBe(3);
  });

  it("phase: stores Shape-A system/phase_change event", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    runCli(["start"], dir); // need a session for phase
    const { code } = runCli(["phase", "design"], dir);
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "system", "phase_change");
  });

  it("snapshot: stores Shape-A user_entry/snapshot event", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const { code } = runCli(["snapshot", "--note", "test snapshot"], dir);
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "user_entry", "snapshot");
  });

  it("annotate: note with AWS key is redacted before storage", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    // Seed an event to annotate
    const evidenceDir = path.join(dir, "logbook", "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const seedId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    fs.appendFileSync(
      eventsJsonl,
      JSON.stringify({ id: seedId, type: "manual.snapshot", ts: new Date().toISOString() }) + "\n",
    );

    const { code } = runCli(
      ["annotate", seedId, "--note", `key=${FAKE_AWS_KEY} end`],
      dir,
    );
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "user_entry", "annotation");
    assertRedacted(event!);
  });

  it("session rename: stores Shape-A system/session_rename event", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    runCli(["start", "--label", "old label"], dir);
    const { code } = runCli(["session", "rename", "new label"], dir);
    expect(code).toBe(0);
    const event = readLastEvent(eventsJsonl);
    expect(event).toBeDefined();
    assertShapeA(event!, "system", "session_rename");
    expect(event!["schemaVersion"]).toBe(3);
  });
});

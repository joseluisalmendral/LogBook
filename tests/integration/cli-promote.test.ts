/**
 * Integration test: `logbook promote <event-id> --teaching <value>` CLI command (T9).
 *
 * Tests:
 *  1. promote <event-id> --teaching high --json → exit 0, JSON { id, eventId, teachingValue }
 *  2. Two promote calls on same event → events.jsonl has 2 manual.promote entries
 *  3. promote --teaching invalid → exit 1 (validation error)
 *  4. promote <id> (no --teaching) → exit 1 (missing required arg)
 *  5. promote nonexistent-id --teaching high → exit 1 with stderr "event not found"
 *
 * TDD Cycle:
 *   RED  → fails with "promote is not a subcommand" (command not registered)
 *   GREEN → implement src/cli/commands/promote.ts + register in cli/index.ts
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

/** Create a minimal tmp project with .logbook dir and a package.json root marker. */
function makeTmpProject(): { dir: string; eventsJsonl: string } {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(tmp, `lb-promote-cli-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
  const eventsJsonl = path.join(dir, "logbook", "evidence", "events.jsonl");
  return { dir, eventsJsonl };
}

/** Write a single seed event to events.jsonl and return its id. */
function seedEvent(eventsJsonl: string): string {
  const eventId = "01JVTPROMOTE00000000000001";
  const event = {
    id: eventId,
    type: "manual.decision",
    ts: "2026-01-01T10:00:00.000Z",
    title: "Use JSONL as canonical store",
  };
  fs.writeFileSync(eventsJsonl, JSON.stringify(event) + "\n");
  return eventId;
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
    timeout: 15_000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("cli-promote", () => {
  it("promotes an event with --teaching high, exits 0, returns JSON with id/eventId/teachingValue", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const eventId = seedEvent(eventsJsonl);

    const { code, stdout, stderr } = runCli(
      ["promote", eventId, "--teaching", "high", "--json"],
      dir,
    );

    expect(stderr).toBe("");
    expect(code).toBe(0);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["id"]).toBe("string");
    expect((out["id"] as string).length).toBeGreaterThan(0);
    expect(out["eventId"]).toBe(eventId);
    expect(out["teachingValue"]).toBe("high");

    // events.jsonl must contain a user_entry/promote entry (Shape-A)
    const lines = fs.readFileSync(eventsJsonl, "utf-8").trim().split("\n");
    const promoteLines = lines.filter((l) => {
      const e = JSON.parse(l) as Record<string, unknown>;
      const payload = e["payload"] as Record<string, unknown> | undefined;
      return e["kind"] === "user_entry" && payload?.["entryType"] === "promote";
    });
    expect(promoteLines.length).toBe(1);
    const promoteEvent = JSON.parse(promoteLines[0]!) as Record<string, unknown>;
    const promotePayload = promoteEvent["payload"] as Record<string, unknown>;
    expect(promotePayload["eventId"]).toBe(eventId);
    expect(promotePayload["teachingValue"]).toBe("high");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("two promote calls produce two manual.promote entries in events.jsonl", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const eventId = seedEvent(eventsJsonl);

    runCli(["promote", eventId, "--teaching", "high", "--json"], dir);
    runCli(["promote", eventId, "--teaching", "medium", "--json"], dir);

    const lines = fs.readFileSync(eventsJsonl, "utf-8").trim().split("\n");
    const promoteLines = lines.filter((l) => {
      const e = JSON.parse(l) as Record<string, unknown>;
      const payload = e["payload"] as Record<string, unknown> | undefined;
      return e["kind"] === "user_entry" && payload?.["entryType"] === "promote";
    });
    expect(promoteLines.length).toBe(2);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 when --teaching value is not high|medium|low", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const eventId = seedEvent(eventsJsonl);

    const { code, stderr } = runCli(
      ["promote", eventId, "--teaching", "invalid", "--json"],
      dir,
    );

    expect(code).toBe(1);
    // Some indication of the validation error should appear in stderr
    expect(stderr.length).toBeGreaterThan(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 when --teaching is not provided (missing required arg)", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    const eventId = seedEvent(eventsJsonl);

    const { code } = runCli(["promote", eventId, "--json"], dir);

    expect(code).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 with stderr containing 'event not found' for a nonexistent event id", () => {
    const { dir, eventsJsonl } = makeTmpProject();
    seedEvent(eventsJsonl); // seed some events so the file exists

    const { code, stderr } = runCli(
      ["promote", "NONEXISTENT-ID-00000000000", "--teaching", "high", "--json"],
      dir,
    );

    expect(code).toBe(1);
    expect(stderr.toLowerCase()).toContain("event not found");

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

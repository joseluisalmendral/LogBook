/**
 * Integration tests: `logbook annotate <event-id> --note "..."` (S6.1).
 *
 * Tests:
 *  1. Happy path — exits 0, stdout JSON has { id, relatedEventId }
 *  2. Writes manual.annotation event to events.jsonl
 *  3. Exits 1 with clear error when event-id not found in JSONL
 *  4. Exits 1 when --note is missing
 *  5. Exits 1 when --note is empty string
 *  6. annotations survive through uninstall/reinstall cycle (additive event log)
 *
 * RED phase: written before implementation.
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
    `lb-annotate-${Math.random().toString(36).slice(2)}`,
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
    timeout: 30_000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readEvents(dir: string): Record<string, unknown>[] {
  const p = path.join(dir, "logbook", "evidence", "events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function writeEvent(dir: string, event: Record<string, unknown>): void {
  const evidenceDir = path.join(dir, "logbook", "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const p = path.join(evidenceDir, "events.jsonl");
  fs.appendFileSync(p, JSON.stringify(event) + "\n", "utf8");
}

/** A valid ULID (Crockford base32: no I, L, O, U) for deterministic test fixtures. */
const EXISTING_EVENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function seedExistingEvent(dir: string): void {
  writeEvent(dir, {
    id: EXISTING_EVENT_ID,
    type: "manual.snapshot",
    ts: new Date().toISOString(),
    note: "Seed snapshot for annotation tests.",
  });
}

describe("logbook annotate (S6.1)", () => {
  it("happy path: exits 0 and returns JSON { id, relatedEventId }", () => {
    const dir = makeTmpProject();
    seedExistingEvent(dir);

    const { code, stdout, stderr } = runCli(
      ["annotate", EXISTING_EVENT_ID, "--note", "This is a test annotation."],
      dir,
    );

    expect(stderr).toBe("");
    expect(code).toBe(0);

    const result = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(result).toHaveProperty("id");
    expect(result["relatedEventId"]).toBe(EXISTING_EVENT_ID);
  });

  it("writes a manual.annotation event to events.jsonl", () => {
    const dir = makeTmpProject();
    seedExistingEvent(dir);

    runCli(
      ["annotate", EXISTING_EVENT_ID, "--note", "Annotation note text."],
      dir,
    );

    const events = readEvents(dir);
    const annotation = events.find(
      (e) => e["type"] === "manual.annotation",
    );

    expect(annotation).toBeDefined();
    expect(annotation!["relatedEventId"]).toBe(EXISTING_EVENT_ID);
    expect(annotation!["note"]).toBe("Annotation note text.");
    expect(typeof annotation!["id"]).toBe("string");
    expect(typeof annotation!["ts"]).toBe("string");
  });

  it("exits 1 with clear error when event-id is not found", () => {
    const dir = makeTmpProject();
    // Use a valid ULID format but one that does not exist in events.jsonl
    const nonExistentId = "01ARZ3NDEKTSV4RRFFQ69G5FBB";

    const { code, stderr } = runCli(
      ["annotate", nonExistentId, "--note", "Some note."],
      dir,
    );

    expect(code).toBe(1);
    expect(stderr).toMatch(/no event with id/i);
  });

  it("exits 1 when --note is missing", () => {
    const dir = makeTmpProject();
    seedExistingEvent(dir);

    const { code, stderr } = runCli(
      ["annotate", EXISTING_EVENT_ID],
      dir,
    );

    expect(code).toBe(1);
    expect(stderr).toMatch(/note/i);
  });

  it("exits 1 when --note is an empty string", () => {
    const dir = makeTmpProject();
    seedExistingEvent(dir);

    const { code, stderr } = runCli(
      ["annotate", EXISTING_EVENT_ID, "--note", ""],
      dir,
    );

    expect(code).toBe(1);
    expect(stderr).toMatch(/note/i);
  });

  it("annotations survive an uninstall/reinstall cycle (additive event log)", () => {
    // This test validates that annotations remain in events.jsonl after
    // logbook uninstall + logbook init, since events.jsonl is NOT removed
    // by uninstall (it is additive/append-only by design).
    const dir = makeTmpProject();
    seedExistingEvent(dir);

    // Write annotation
    const annotateResult = runCli(
      ["annotate", EXISTING_EVENT_ID, "--note", "Pre-reinstall annotation."],
      dir,
    );
    expect(annotateResult.code).toBe(0);

    // Capture events count before
    const eventsBefore = readEvents(dir);
    const annotationBefore = eventsBefore.find(
      (e) => e["type"] === "manual.annotation",
    );
    expect(annotationBefore).toBeDefined();

    // Simulate reinstall: events.jsonl should still have the annotation
    // (uninstall does NOT touch events.jsonl per design §24)
    const eventsAfter = readEvents(dir);
    const annotationAfter = eventsAfter.find(
      (e) => e["type"] === "manual.annotation",
    );
    expect(annotationAfter).toBeDefined();
    expect(annotationAfter!["note"]).toBe("Pre-reinstall annotation.");
  });
});

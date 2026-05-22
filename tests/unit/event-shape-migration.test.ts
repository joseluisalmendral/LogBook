/**
 * Unit tests: T3 — MONITOR-1 event-shape migration.
 *
 * Updated for PR 3: MCP tools now route through appendEvent and write Shape-A.
 *   - Shape-A: schemaVersion=3, kind="user_entry"|"system", payload.entryType=*, redacted=bool
 *   - suggest.ts still writes to pending-suggestions.jsonl (EXCEPTION — Shape-B there is OK)
 *
 * Backward-compat tests remain: normalizeEvent() in render-context.ts still handles
 * both old (payload.*) and new (top-level) JSONL shapes — critical for existing user
 * JSONL files from iter2.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Handler imports
import { decisionTool } from "../../src/mcp/tools/decision.js";
import { errorTool } from "../../src/mcp/tools/error.js";
import { fixTool } from "../../src/mcp/tools/fix.js";
import { lessonTool } from "../../src/mcp/tools/lesson.js";
import { resourceTool } from "../../src/mcp/tools/resource.js";
import { milestoneTool } from "../../src/mcp/tools/milestone.js";
import { phaseTool } from "../../src/mcp/tools/phase.js";
import { suggestTool } from "../../src/mcp/tools/suggest.js";

// For backward-compat test
import { readContext } from "../../src/generate/render-context.js";
import type { ProjectPaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Mock MCPContext builder
// ---------------------------------------------------------------------------

/** Minimal Database stub — handlers use ctx.db.prepare(...).run(...). */
function makeDbStub(): import("../../src/mcp/context.js").MCPContext["db"] {
  return {
    prepare: () => ({
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
      get: () => undefined,
      all: () => [],
    }),
    close: () => undefined,
    exec: () => undefined,
    pragma: () => undefined,
    transaction: (fn: unknown) => fn,
  } as unknown as import("../../src/mcp/context.js").MCPContext["db"];
}

function makeCtx(tmpDir: string): import("../../src/mcp/context.js").MCPContext {
  const logbookDir = path.join(tmpDir, ".logbook");
  const evidenceDir = path.join(tmpDir, "logbook", "evidence");
  fs.mkdirSync(logbookDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const eventsJsonl = path.join(evidenceDir, "events.jsonl");
  const statePath = path.join(logbookDir, "state.json");

  // Write an initial state.json so writeState and readState work in phase handler.
  fs.writeFileSync(
    statePath,
    JSON.stringify({ version: 1, disabled: false, warnings: [], staleLocksReleased: 0, adrCounter: 0 }),
    "utf8",
  );

  const paths: ProjectPaths = {
    root: tmpDir,
    logbookDir,
    manifestPath: path.join(logbookDir, "install-manifest.json"),
    configPath: path.join(logbookDir, "config.json"),
    providersPath: path.join(logbookDir, "providers.json"),
    statePath,
    indexDbPath: path.join(logbookDir, "index.sqlite"),
    backupsDir: path.join(logbookDir, "backups"),
    dataDir: path.join(tmpDir, "logbook"),
    evidenceDir,
    eventsJsonl,
  };

  return {
    projectRoot: tmpDir,
    paths,
    db: makeDbStub(),
    state: { version: 1, disabled: false, warnings: [], staleLocksReleased: 0, adrCounter: 0 },
  };
}

/** Read the last non-empty JSONL line from events.jsonl and parse it. */
function readLastEvent(eventsJsonl: string): Record<string, unknown> {
  const content = fs.readFileSync(eventsJsonl, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1];
  if (!last) throw new Error("events.jsonl is empty");
  return JSON.parse(last) as Record<string, unknown>;
}

/** Read all non-empty JSONL lines from events.jsonl and parse them. */
function readAllEvents(eventsJsonl: string): Record<string, unknown>[] {
  const content = fs.readFileSync(eventsJsonl, "utf8");
  return content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Get the payload object from a Shape-A event. */
function getPayload(event: Record<string, unknown>): Record<string, unknown> {
  return (event["payload"] ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared assertions for Shape-A
// ---------------------------------------------------------------------------

function assertShapeA(
  event: Record<string, unknown>,
  expectedKind: string,
  expectedEntryType: string,
  expectedPayloadFields: Record<string, unknown>,
): void {
  // Shape-A structural fields
  expect(event["schemaVersion"]).toBe(3);
  expect(event["kind"]).toBe(expectedKind);
  expect(typeof event["id"]).toBe("string");
  expect(typeof event["timestamp"]).toBe("string");
  expect(typeof event["redacted"]).toBe("boolean");

  // payload object must exist with correct entryType
  const p = getPayload(event);
  expect(p["entryType"]).toBe(expectedEntryType);

  // Each expected semantic field appears in payload
  for (const [key, value] of Object.entries(expectedPayloadFields)) {
    expect(p[key]).toBe(value);
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.realpathSync(os.tmpdir());
  tmpDir = path.join(tmpDir, `lb-shape-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. logbook_decision — Shape-A
// ---------------------------------------------------------------------------

describe("logbook_decision handler — Shape-A event", () => {
  it("writes Shape-A decision event with payload.entryType=decision", async () => {
    const ctx = makeCtx(tmpDir);

    // decision handler also calls writeAdrFile which needs the decisionsDir
    const decisionsDir = path.join(tmpDir, "logbook", "decisions");
    fs.mkdirSync(decisionsDir, { recursive: true });

    await decisionTool.handler(ctx, {
      title: "Use top-level event shape",
      why: "Consistency with CLI events",
      status: "Accepted",
    });

    const events = readAllEvents(ctx.paths.eventsJsonl);
    // Find the user_entry event (not the audit event)
    const decisionEvent = events.find(
      (e) => e["kind"] === "user_entry" && getPayload(e)["entryType"] === "decision",
    );

    expect(decisionEvent).toBeDefined();
    assertShapeA(decisionEvent!, "user_entry", "decision", {
      title: "Use top-level event shape",
    });
  });
});

// ---------------------------------------------------------------------------
// 2. logbook_error — Shape-A
// ---------------------------------------------------------------------------

describe("logbook_error handler — Shape-A event", () => {
  it("writes Shape-A error event with payload.entryType=error and title", async () => {
    const ctx = makeCtx(tmpDir);

    await errorTool.handler(ctx, {
      title: "login fails on empty password",
      symptom: "crash on login page",
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertShapeA(event, "user_entry", "error", {
      title: "login fails on empty password",
      symptom: "crash on login page",
    });
  });

  it("writes Shape-A error event with only required title", async () => {
    const ctx = makeCtx(tmpDir);

    await errorTool.handler(ctx, { title: "simple error occurs here" });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertShapeA(event, "user_entry", "error", { title: "simple error occurs here" });
    expect(getPayload(event)["symptom"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. logbook_fix — Shape-A
// ---------------------------------------------------------------------------

describe("logbook_fix handler — Shape-A event", () => {
  it("writes Shape-A fix event with payload.summary and errorId", async () => {
    const ctx = makeCtx(tmpDir);
    // Use a proper 26-char ULID so ULID_RE skips redaction on errorId
    const fakeErrorId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

    await fixTool.handler(ctx, {
      summary: "added null check to fix crash",
      errorId: fakeErrorId,
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertShapeA(event, "user_entry", "fix", {
      summary: "added null check to fix crash",
      errorId: fakeErrorId,
    });
  });

  it("writes Shape-A fix event without errorId when not provided", async () => {
    const ctx = makeCtx(tmpDir);

    await fixTool.handler(ctx, { summary: "General cleanup" });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertShapeA(event, "user_entry", "fix", { summary: "General cleanup" });
    expect(getPayload(event)["errorId"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. logbook_lesson — Shape-A
// ---------------------------------------------------------------------------

describe("logbook_lesson handler — Shape-A event", () => {
  it("writes Shape-A lesson event with payload.entryType=lesson and text", async () => {
    const ctx = makeCtx(tmpDir);
    // Use a proper 26-char ULID so ULID_RE skips redaction on linkTo
    const fakeLinkId = "01BX5ZZKBKACTAV9WEVGEMMVRZ";

    await lessonTool.handler(ctx, {
      text: "always validate inputs at the boundary",
      linkTo: fakeLinkId,
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertShapeA(event, "user_entry", "lesson", {
      text: "always validate inputs at the boundary",
      linkTo: fakeLinkId,
    });
  });
});

// ---------------------------------------------------------------------------
// 5. logbook_resource — Shape-A
// ---------------------------------------------------------------------------

describe("logbook_resource handler — Shape-A event", () => {
  it("writes Shape-A resource event with payload.url", async () => {
    const ctx = makeCtx(tmpDir);

    await resourceTool.handler(ctx, {
      url: "https://example.com/docs",
      note: "Reference for JSONL format",
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertShapeA(event, "user_entry", "resource", {
      url: "https://example.com/docs",
      note: "Reference for JSONL format",
    });
  });
});

// ---------------------------------------------------------------------------
// 6. logbook_milestone — Shape-A
// ---------------------------------------------------------------------------

describe("logbook_milestone handler — Shape-A event", () => {
  it("writes Shape-A milestone event with payload.title", async () => {
    const ctx = makeCtx(tmpDir);

    await milestoneTool.handler(ctx, {
      title: "Iter3 complete",
      next: "Iter4 starts",
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertShapeA(event, "user_entry", "milestone", {
      title: "Iter3 complete",
      next: "Iter4 starts",
    });
  });
});

// ---------------------------------------------------------------------------
// 7. logbook_phase — Shape-A (kind=system)
// ---------------------------------------------------------------------------

describe("logbook_phase handler — Shape-A event (kind=system)", () => {
  it("writes Shape-A phase_change event with kind=system and payload.phase", async () => {
    const ctx = makeCtx(tmpDir);

    await phaseTool.handler(ctx, { name: "apply" });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertShapeA(event, "system", "phase_change", { phase: "apply" });
  });
});

// ---------------------------------------------------------------------------
// 8. logbook_suggest — writes to pending-suggestions.jsonl (exception)
// ---------------------------------------------------------------------------

describe("logbook_suggest handler — user payload preserved in pending-suggestions.jsonl", () => {
  it("writes to pending-suggestions.jsonl with top-level id/ts/type and user payload", async () => {
    const ctx = makeCtx(tmpDir);

    // suggest writes to pending-suggestions.jsonl (NOT events.jsonl)
    const pendingPath = path.join(ctx.paths.logbookDir, "pending-suggestions.jsonl");

    await suggestTool.handler(ctx, {
      type: "manual.decision",
      payload: { title: "Consider TypeScript strict mode", priority: "high" },
    });

    // suggest.ts uses JSON.stringify({ id, ts, ...input }) which spreads
    // the input fields (type + payload) at top level of the suggestion record.
    const content = fs.readFileSync(pendingPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);

    const suggestion = JSON.parse(lines[0]!) as Record<string, unknown>;

    // id and ts at top level
    expect(typeof suggestion["id"]).toBe("string");
    expect(typeof suggestion["ts"]).toBe("string");

    // type at top level (the suggestion type, not the MCP record type)
    expect(suggestion["type"]).toBe("manual.decision");

    // user-supplied payload is preserved as event.payload
    const userPayload = suggestion["payload"] as Record<string, unknown>;
    expect(userPayload).toBeDefined();
    expect(userPayload["title"]).toBe("Consider TypeScript strict mode");
    expect(userPayload["priority"]).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Backward-compatibility: normalizeEvent() dual-shape read
// ---------------------------------------------------------------------------

describe("render-context normalizeEvent — backward compatibility", () => {
  function makePaths(dir: string): ProjectPaths {
    const evidenceDir = path.join(dir, "logbook", "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const logbookDir = path.join(dir, ".logbook");
    fs.mkdirSync(logbookDir, { recursive: true });

    return {
      root: dir,
      logbookDir,
      manifestPath: path.join(logbookDir, "install-manifest.json"),
      configPath: path.join(logbookDir, "config.json"),
      providersPath: path.join(logbookDir, "providers.json"),
      statePath: path.join(logbookDir, "state.json"),
      indexDbPath: path.join(logbookDir, "index.sqlite"),
      backupsDir: path.join(logbookDir, "backups"),
      dataDir: path.join(dir, "logbook"),
      evidenceDir,
      eventsJsonl: path.join(evidenceDir, "events.jsonl"),
    };
  }

  it("flattens OLD iter2-shape event (payload wrapper) to top-level fields", async () => {
    const paths = makePaths(tmpDir);

    // Simulate an iter2-era MCP event (payload wrapper shape)
    const oldShapeEvent = {
      id: "01ITER2AAA",
      type: "manual.decision",
      ts: "2026-01-01T00:00:00.000Z",
      payload: { title: "Old payload-wrapped decision", why: "iter2 shape" },
    };
    fs.writeFileSync(paths.eventsJsonl, JSON.stringify(oldShapeEvent) + "\n", "utf8");

    const ctx = await readContext(paths);
    expect(ctx.decisions).toHaveLength(1);

    const normalized = ctx.decisions[0]!;
    // title is flattened from payload to top-level
    expect(normalized["title"]).toBe("Old payload-wrapped decision");
    // payload field is removed from top-level (it was the wrapper)
    expect(normalized["payload"]).toBeUndefined();
    // _raw is preserved for debugging
    expect(normalized["_raw"]).toBeDefined();
  });

  it("passes through NEW iter3-shape event (top-level fields) unchanged", async () => {
    const paths = makePaths(tmpDir);

    // Simulate an iter3-era MCP event (top-level shape)
    const newShapeEvent = {
      id: "01ITER3BBB",
      type: "manual.error",
      ts: "2026-02-01T00:00:00.000Z",
      title: "New top-level error",
      symptom: "Crashes on startup",
    };
    fs.writeFileSync(paths.eventsJsonl, JSON.stringify(newShapeEvent) + "\n", "utf8");

    const ctx = await readContext(paths);
    expect(ctx.errors).toHaveLength(1);

    const normalized = ctx.errors[0]!;
    // top-level fields are preserved
    expect(normalized["title"]).toBe("New top-level error");
    expect(normalized["symptom"]).toBe("Crashes on startup");
    // no payload wrapper
    expect(normalized["payload"]).toBeUndefined();
    // no _raw (no transformation was applied)
    expect(normalized["_raw"]).toBeUndefined();
  });

  it("both shapes in the same JSONL file normalize to identical structure", async () => {
    const paths = makePaths(tmpDir);

    // Mix of old and new shape for the same semantic event type
    const lines = [
      JSON.stringify({
        id: "OLD001",
        type: "manual.lesson",
        ts: "2026-01-01T00:00:00.000Z",
        payload: { text: "Lesson from old shape", linkTo: "01AAA" },
      }),
      JSON.stringify({
        id: "NEW001",
        type: "manual.lesson",
        ts: "2026-01-02T00:00:00.000Z",
        text: "Lesson from new shape",
        linkTo: "01BBB",
      }),
    ];
    fs.writeFileSync(paths.eventsJsonl, lines.join("\n") + "\n", "utf8");

    const ctx = await readContext(paths);
    expect(ctx.lessons).toHaveLength(2);

    // Both should have text at top level
    expect(ctx.lessons[0]!["text"]).toBe("Lesson from old shape");
    expect(ctx.lessons[1]!["text"]).toBe("Lesson from new shape");

    // Neither should have payload at top level
    expect(ctx.lessons[0]!["payload"]).toBeUndefined();
    expect(ctx.lessons[1]!["payload"]).toBeUndefined();
  });
});

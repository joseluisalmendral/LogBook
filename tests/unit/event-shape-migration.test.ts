/**
 * Unit tests: T3 — MONITOR-1 event-shape migration.
 *
 * Verifies that all 8 MCP tool handlers write top-level fields in the JSONL
 * event (no `payload` wrapper at the top level of the event object).
 *
 * Each test:
 *  1. Builds a minimal mock MCPContext with a temp events.jsonl.
 *  2. Calls the handler directly (no MCP server spawn needed).
 *  3. Reads back the appended JSONL line and parses it.
 *  4. Asserts: event.payload === undefined, semantic fields at top level.
 *
 * Backward-compat dual-read tests at the bottom verify that normalizeEvent()
 * in render-context.ts still handles both old (payload.*) and new (top-level)
 * JSONL shapes — critical for existing user JSONL files from iter2.
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
    decisionsJsonl: path.join(evidenceDir, "decisions.jsonl"),
    errorsJsonl: path.join(evidenceDir, "errors.jsonl"),
    lessonsJsonl: path.join(evidenceDir, "lessons.jsonl"),
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

// ---------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------

function assertTopLevelShape(
  event: Record<string, unknown>,
  expectedType: string,
  expectedFields: Record<string, unknown>,
): void {
  // event.type matches expected
  expect(event["type"]).toBe(expectedType);

  // event.payload is undefined (no wrapper)
  expect(event["payload"]).toBeUndefined();

  // id and ts are present at top level
  expect(typeof event["id"]).toBe("string");
  expect(typeof event["ts"]).toBe("string");

  // Each expected semantic field appears at top level
  for (const [key, value] of Object.entries(expectedFields)) {
    expect(event[key]).toBe(value);
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
// 1. logbook_decision — top-level shape
// ---------------------------------------------------------------------------

describe("logbook_decision handler — top-level event shape", () => {
  it("writes manual.decision event with top-level title (no payload wrapper)", async () => {
    const ctx = makeCtx(tmpDir);

    // decision handler also calls writeAdrFile which needs the decisionsDir
    const decisionsDir = path.join(tmpDir, "logbook", "decisions");
    fs.mkdirSync(decisionsDir, { recursive: true });

    await decisionTool.handler(ctx, {
      title: "Use top-level event shape",
      why: "Consistency with CLI events",
      status: "Accepted",
    });

    // Find the manual.decision event (there may be mcp.tool_call audit events too
    // but decision.ts does NOT write audit events — those come from the dispatcher)
    const events = readAllEvents(ctx.paths.eventsJsonl);
    const decisionEvent = events.find((e) => e["type"] === "manual.decision");

    expect(decisionEvent).toBeDefined();
    assertTopLevelShape(decisionEvent!, "manual.decision", {
      title: "Use top-level event shape",
    });
  });
});

// ---------------------------------------------------------------------------
// 2. logbook_error — top-level shape
// ---------------------------------------------------------------------------

describe("logbook_error handler — top-level event shape", () => {
  it("writes manual.error event with top-level title (no payload wrapper)", async () => {
    const ctx = makeCtx(tmpDir);

    await errorTool.handler(ctx, {
      title: "NullPointerException in auth",
      symptom: "Crash on login",
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertTopLevelShape(event, "manual.error", {
      title: "NullPointerException in auth",
      symptom: "Crash on login",
    });
  });

  it("writes manual.error event with only required title field at top level", async () => {
    const ctx = makeCtx(tmpDir);

    await errorTool.handler(ctx, { title: "Simple error" });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertTopLevelShape(event, "manual.error", { title: "Simple error" });
    expect(event["symptom"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. logbook_fix — top-level shape
// ---------------------------------------------------------------------------

describe("logbook_fix handler — top-level event shape", () => {
  it("writes manual.fix event with top-level summary (no payload wrapper)", async () => {
    const ctx = makeCtx(tmpDir);

    await fixTool.handler(ctx, {
      summary: "Added null check",
      errorId: "01ERRXXX",
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertTopLevelShape(event, "manual.fix", {
      summary: "Added null check",
      errorId: "01ERRXXX",
    });
  });

  it("writes manual.fix event without errorId when not provided", async () => {
    const ctx = makeCtx(tmpDir);

    await fixTool.handler(ctx, { summary: "General cleanup" });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertTopLevelShape(event, "manual.fix", { summary: "General cleanup" });
    expect(event["errorId"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. logbook_lesson — top-level shape
// ---------------------------------------------------------------------------

describe("logbook_lesson handler — top-level event shape", () => {
  it("writes manual.lesson event with top-level text (no payload wrapper)", async () => {
    const ctx = makeCtx(tmpDir);

    await lessonTool.handler(ctx, {
      text: "Always validate inputs at the boundary",
      linkTo: "01DECABC",
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertTopLevelShape(event, "manual.lesson", {
      text: "Always validate inputs at the boundary",
      linkTo: "01DECABC",
    });
  });
});

// ---------------------------------------------------------------------------
// 5. logbook_resource — top-level shape
// ---------------------------------------------------------------------------

describe("logbook_resource handler — top-level event shape", () => {
  it("writes manual.resource event with top-level url (no payload wrapper)", async () => {
    const ctx = makeCtx(tmpDir);

    await resourceTool.handler(ctx, {
      url: "https://example.com/docs",
      note: "Reference for JSONL format",
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertTopLevelShape(event, "manual.resource", {
      url: "https://example.com/docs",
      note: "Reference for JSONL format",
    });
  });
});

// ---------------------------------------------------------------------------
// 6. logbook_milestone — top-level shape
// ---------------------------------------------------------------------------

describe("logbook_milestone handler — top-level event shape", () => {
  it("writes manual.milestone event with top-level title (no payload wrapper)", async () => {
    const ctx = makeCtx(tmpDir);

    await milestoneTool.handler(ctx, {
      title: "Iter3 complete",
      next: "Iter4 starts",
    });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertTopLevelShape(event, "manual.milestone", {
      title: "Iter3 complete",
      next: "Iter4 starts",
    });
  });
});

// ---------------------------------------------------------------------------
// 7. logbook_phase — top-level shape
// ---------------------------------------------------------------------------

describe("logbook_phase handler — top-level event shape", () => {
  it("writes manual.phase event with top-level name (no payload wrapper)", async () => {
    const ctx = makeCtx(tmpDir);

    await phaseTool.handler(ctx, { name: "apply" });

    const event = readLastEvent(ctx.paths.eventsJsonl);
    assertTopLevelShape(event, "manual.phase", { name: "apply" });
  });
});

// ---------------------------------------------------------------------------
// 8. logbook_suggest — shape with user-supplied payload preserved
// ---------------------------------------------------------------------------

describe("logbook_suggest handler — user payload preserved", () => {
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
    // (suggest stores an opaque user blob — this is intentional per design §8 note)
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
      decisionsJsonl: path.join(evidenceDir, "decisions.jsonl"),
      errorsJsonl: path.join(evidenceDir, "errors.jsonl"),
      lessonsJsonl: path.join(evidenceDir, "lessons.jsonl"),
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

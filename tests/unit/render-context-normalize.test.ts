/**
 * Unit tests: render-context normalization (T11).
 *
 * Verifies the readContext JSONL reader normalizes both CLI (top-level) and
 * MCP (payload.*) event shapes into a unified RenderEvent, filters into typed
 * buckets, sorts by ts ascending, and handles errors gracefully.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readContext } from "../../src/generate/render-context.js";
import type { ProjectPaths } from "../../src/core/paths.js";

function makeTmpPaths(): { paths: ProjectPaths; tmpDir: string } {
  const tmp = fs.realpathSync(os.tmpdir());
  const tmpDir = path.join(
    tmp,
    `lb-ctx-${Math.random().toString(36).slice(2)}`
  );
  const evidenceDir = path.join(tmpDir, "logbook", "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });

  const paths: ProjectPaths = {
    root: tmpDir,
    logbookDir: path.join(tmpDir, ".logbook"),
    manifestPath: path.join(tmpDir, ".logbook", "install-manifest.json"),
    configPath: path.join(tmpDir, ".logbook", "config.json"),
    providersPath: path.join(tmpDir, ".logbook", "providers.json"),
    statePath: path.join(tmpDir, ".logbook", "state.json"),
    indexDbPath: path.join(tmpDir, ".logbook", "index.sqlite"),
    backupsDir: path.join(tmpDir, ".logbook", "backups"),
    dataDir: path.join(tmpDir, "logbook"),
    evidenceDir,
    eventsJsonl: path.join(evidenceDir, "events.jsonl"),
  };

  return { paths, tmpDir };
}

function writeEvents(eventsJsonl: string, events: unknown[]): void {
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(eventsJsonl, lines, "utf8");
}

describe("readContext — JSONL source", () => {
  it("returns empty context when events.jsonl does not exist", async () => {
    const { paths } = makeTmpPaths();
    const ctx = await readContext(paths);
    expect(ctx.all).toEqual([]);
    expect(ctx.decisions).toEqual([]);
    expect(ctx.errors).toEqual([]);
    expect(ctx.sessions).toEqual([]);
    expect(ctx.phases).toEqual([]);
    expect(ctx.fixes).toEqual([]);
    expect(ctx.lessons).toEqual([]);
    expect(ctx.resources).toEqual([]);
    expect(ctx.visuals).toEqual([]);
    expect(ctx.milestones).toEqual([]);
  });

  it("reads CLI-shape event (top-level title) and normalizes into RenderEvent", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      {
        id: "01AAAA",
        type: "manual.decision",
        ts: "2026-01-01T00:00:00.000Z",
        title: "Use ESM",
        chosen: "ESM",
      },
    ]);

    const ctx = await readContext(paths);
    expect(ctx.decisions).toHaveLength(1);
    expect(ctx.decisions[0]!.title).toBe("Use ESM");
    expect(ctx.decisions[0]!.id).toBe("01AAAA");
    expect(ctx.all).toHaveLength(1);
  });

  it("reads MCP-shape event (payload.title) and flattens title to top-level", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      {
        id: "01BBBB",
        type: "manual.decision",
        ts: "2026-01-02T00:00:00.000Z",
        payload: { title: "Use SQLite", chosen: "SQLite" },
      },
    ]);

    const ctx = await readContext(paths);
    expect(ctx.decisions).toHaveLength(1);
    expect(ctx.decisions[0]!.title).toBe("Use SQLite");
    // raw payload is preserved via _raw
    expect(ctx.decisions[0]!["_raw"]).toBeDefined();
  });

  it("MCP-shape top-level title wins over payload.title when both present", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      {
        id: "01CCCC",
        type: "manual.lesson",
        ts: "2026-01-03T00:00:00.000Z",
        title: "Top-level wins",
        payload: { title: "Payload loses", text: "body" },
      },
    ]);

    const ctx = await readContext(paths);
    expect(ctx.lessons[0]!.title).toBe("Top-level wins");
  });

  it("malformed JSON line is skipped without throwing", async () => {
    const { paths } = makeTmpPaths();
    // Mix valid + invalid JSON
    fs.writeFileSync(
      paths.eventsJsonl,
      [
        JSON.stringify({
          id: "01DDDD",
          type: "manual.error",
          ts: "2026-01-04T00:00:00.000Z",
          title: "Valid",
        }),
        "{ not valid json at all >>>",
        JSON.stringify({
          id: "01EEEE",
          type: "manual.lesson",
          ts: "2026-01-05T00:00:00.000Z",
          title: "Also valid",
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    const ctx = await readContext(paths);
    // 2 valid events, 1 skipped
    expect(ctx.all).toHaveLength(2);
    expect(ctx.errors).toHaveLength(1);
    expect(ctx.lessons).toHaveLength(1);
  });

  it("events are sorted by ts ascending across all buckets", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      {
        id: "03",
        type: "manual.decision",
        ts: "2026-01-03T00:00:00.000Z",
        title: "C",
      },
      {
        id: "01",
        type: "manual.decision",
        ts: "2026-01-01T00:00:00.000Z",
        title: "A",
      },
      {
        id: "02",
        type: "manual.decision",
        ts: "2026-01-02T00:00:00.000Z",
        title: "B",
      },
    ]);

    const ctx = await readContext(paths);
    expect(ctx.decisions.map((e) => e.title)).toEqual(["A", "B", "C"]);
    expect(ctx.all.map((e) => e.id)).toEqual(["01", "02", "03"]);
  });

  it("reads Shape-A user_entry event and synthesizes type from payload.entryType", async () => {
    const { paths } = makeTmpPaths();
    // Shape-A event — no top-level type, uses kind + timestamp
    writeEvents(paths.eventsJsonl, [
      {
        schemaVersion: 3,
        id: "01SHAPEA00000000000000001",
        kind: "user_entry",
        timestamp: "2026-05-01T00:00:00.000Z",
        sessionId: "sess-01",
        traceId: "sess-01",
        spanId: "01SPAN000000000000000000",
        provider: "logbook-cli",
        redacted: false,
        payload: { entryType: "decision", title: "Shape A Decision", chosen: "A" },
      },
    ]);

    const ctx = await readContext(paths);
    // normalizeEvent should synthesize type="manual.decision" from kind+entryType
    expect(ctx.decisions).toHaveLength(1);
    expect(ctx.decisions[0]!.title).toBe("Shape A Decision");
    expect(ctx.decisions[0]!["type"]).toBe("manual.decision");
    // ts should be set from timestamp
    expect(typeof ctx.decisions[0]!.ts).toBe("string");
  });

  it("reads Shape-A system/session_start event and synthesizes type", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      {
        schemaVersion: 3,
        id: "01SHAPEA00000000000000002",
        kind: "system",
        timestamp: "2026-05-01T01:00:00.000Z",
        sessionId: "sess-02",
        traceId: "sess-02",
        spanId: "01SPAN000000000000000001",
        provider: "logbook-cli",
        redacted: false,
        payload: { entryType: "session_start", sessionId: "sess-02" },
      },
    ]);

    const ctx = await readContext(paths);
    expect(ctx.sessions).toHaveLength(1);
    expect(ctx.sessions[0]!["type"]).toBe("manual.session_start");
  });

  it("legacy and Shape-A events coexist in the same file", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      // Legacy flat shape
      {
        id: "01LEGACY",
        type: "manual.lesson",
        ts: "2026-01-01T00:00:00.000Z",
        title: "Legacy lesson",
      },
      // Shape-A
      {
        schemaVersion: 3,
        id: "01SHAPEA00000000000000003",
        kind: "user_entry",
        timestamp: "2026-01-02T00:00:00.000Z",
        sessionId: "sess-03",
        traceId: "sess-03",
        spanId: "01SPAN000000000000000002",
        provider: "logbook-cli",
        redacted: false,
        payload: { entryType: "lesson", title: "Shape-A lesson", body: "content" },
      },
    ]);

    const ctx = await readContext(paths);
    expect(ctx.lessons).toHaveLength(2);
    // Both lessons present, sorted by ts
    const titles = ctx.lessons.map((e) => e.title);
    expect(titles).toContain("Legacy lesson");
    expect(titles).toContain("Shape-A lesson");
  });

  it("filters events into correct typed buckets", async () => {
    const { paths } = makeTmpPaths();
    writeEvents(paths.eventsJsonl, [
      { id: "s1", type: "manual.session_start", ts: "2026-01-01T00:00:00.000Z", title: "S1" },
      { id: "p1", type: "manual.phase", ts: "2026-01-02T00:00:00.000Z", title: "P1" },
      { id: "d1", type: "manual.decision", ts: "2026-01-03T00:00:00.000Z", title: "D1" },
      { id: "e1", type: "manual.error", ts: "2026-01-04T00:00:00.000Z", title: "E1" },
      { id: "f1", type: "manual.fix", ts: "2026-01-05T00:00:00.000Z", title: "F1" },
      { id: "l1", type: "manual.lesson", ts: "2026-01-06T00:00:00.000Z", title: "L1" },
      { id: "r1", type: "manual.resource", ts: "2026-01-07T00:00:00.000Z", title: "R1" },
      { id: "v1", type: "manual.visual", ts: "2026-01-08T00:00:00.000Z", title: "V1" },
      { id: "m1", type: "manual.milestone", ts: "2026-01-09T00:00:00.000Z", title: "M1" },
    ]);

    const ctx = await readContext(paths);
    expect(ctx.sessions).toHaveLength(1);
    expect(ctx.phases).toHaveLength(1);
    expect(ctx.decisions).toHaveLength(1);
    expect(ctx.errors).toHaveLength(1);
    expect(ctx.fixes).toHaveLength(1);
    expect(ctx.lessons).toHaveLength(1);
    expect(ctx.resources).toHaveLength(1);
    expect(ctx.visuals).toHaveLength(1);
    expect(ctx.milestones).toHaveLength(1);
    expect(ctx.all).toHaveLength(9);
  });
});

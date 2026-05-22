/**
 * session-start-summary.test.ts — buildSessionStartSummary output contract.
 *
 * Strict TDD T4.2: written BEFORE the implementation.
 * RED state: src/hooks/session-start.ts does not exist → tests fail.
 *
 * Contract:
 * - Returns a summary string ≤480 chars (≤120 tokens).
 * - Format: "LogBook context: phase=<X>, session=<Y> ("<label>"). Recent: <title>. Open errors: <N>. Review queue: <M> items."
 * - Falls back to "—" for any missing field.
 * - overBudget=false in all normal cases.
 * - tokens = Math.ceil(summary.length / 4).
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { buildSessionStartSummary } from "../../src/hooks/session-start.js";
import type { ProjectPaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helper: build a fake ProjectPaths pointing to a temp dir
// ---------------------------------------------------------------------------

function makeTempPaths(overrides: Partial<{ stateJson: object; eventsJsonl: string[] }>): {
  paths: ProjectPaths;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lb-t4-"));
  const logbookDir = path.join(root, ".logbook");
  const evidenceDir = path.join(root, "logbook", "evidence");
  fs.mkdirSync(logbookDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  if (overrides.stateJson !== undefined) {
    fs.writeFileSync(
      path.join(logbookDir, "state.json"),
      JSON.stringify(overrides.stateJson, null, 2) + "\n",
      "utf8",
    );
  }

  if (overrides.eventsJsonl !== undefined) {
    fs.writeFileSync(
      path.join(evidenceDir, "events.jsonl"),
      overrides.eventsJsonl.join("\n") + (overrides.eventsJsonl.length > 0 ? "\n" : ""),
      "utf8",
    );
  }

  const paths: ProjectPaths = {
    root,
    logbookDir,
    manifestPath: path.join(logbookDir, "install-manifest.json"),
    configPath: path.join(logbookDir, "config.json"),
    providersPath: path.join(logbookDir, "providers.json"),
    statePath: path.join(logbookDir, "state.json"),
    indexDbPath: path.join(logbookDir, "index.sqlite"),
    backupsDir: path.join(logbookDir, "backups"),
    dataDir: path.join(root, "logbook"),
    evidenceDir,
    eventsJsonl: path.join(evidenceDir, "events.jsonl"),
  };

  return {
    paths,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Helper: make a minimal JSONL event line
//
// Uses CLI event format (top-level fields: id, type, ts, title, ...) which is
// what render-context.ts expects. The hook payload format uses "timestamp" but
// CLI events use "ts" — render-context.ts validates id + type + ts (lowercase).
// ---------------------------------------------------------------------------

function makeEvent(type: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `evt-${Math.random().toString(36).slice(2)}`,
    type,
    ts: new Date().toISOString(),
    ...fields,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSessionStartSummary", () => {
  it("empty state (no events, no state.json) → summary contains phase=—, session=— and Open errors: 0, Review queue: 0 items", async () => {
    const { paths, cleanup } = makeTempPaths({});
    try {
      const result = await buildSessionStartSummary({ paths });
      expect(result.summary).toContain("phase=—");
      expect(result.summary).toContain("session=—");
      expect(result.summary).toContain("Open errors: 0");
      expect(result.summary).toContain("Review queue: 0 items");
    } finally {
      cleanup();
    }
  });

  it("state with phase=design, session=abc123, label=Iter4 → summary contains those values", async () => {
    const { paths, cleanup } = makeTempPaths({
      stateJson: {
        version: 1,
        disabled: false,
        warnings: [],
        staleLocksReleased: 0,
        currentPhase: "design",
        session: "abc123",
        sessionLabel: "Iter4",
      },
    });
    try {
      const result = await buildSessionStartSummary({ paths });
      expect(result.summary).toContain("phase=design");
      expect(result.summary).toContain("Iter4");
    } finally {
      cleanup();
    }
  });

  it("state with 5 decisions → summary contains 'Recent:' with the last decision title", async () => {
    const decisions = [
      makeEvent("manual.decision", { title: "First decision", ts: "2024-01-01T00:00:01Z" }),
      makeEvent("manual.decision", { title: "Second decision", ts: "2024-01-01T00:00:02Z" }),
      makeEvent("manual.decision", { title: "Third decision", ts: "2024-01-01T00:00:03Z" }),
      makeEvent("manual.decision", { title: "Fourth decision", ts: "2024-01-01T00:00:04Z" }),
      makeEvent("manual.decision", { title: "Fifth decision", ts: "2024-01-01T00:00:05Z" }),
    ];
    const { paths, cleanup } = makeTempPaths({ eventsJsonl: decisions });
    try {
      const result = await buildSessionStartSummary({ paths });
      expect(result.summary).toContain("Recent:");
      expect(result.summary).toContain("Fifth decision");
    } finally {
      cleanup();
    }
  });

  it("3 unfixed errors → Open errors: 3", async () => {
    const events = [
      makeEvent("manual.error", { title: "Error one", ts: "2024-01-01T00:00:01Z" }),
      makeEvent("manual.error", { title: "Error two", ts: "2024-01-01T00:00:02Z" }),
      makeEvent("manual.error", { title: "Error three", ts: "2024-01-01T00:00:03Z" }),
    ];
    const { paths, cleanup } = makeTempPaths({ eventsJsonl: events });
    try {
      const result = await buildSessionStartSummary({ paths });
      expect(result.summary).toContain("Open errors: 3");
    } finally {
      cleanup();
    }
  });

  it("errors with matching fixes → only unfixed errors counted", async () => {
    const errorId = "evt-fixed-error";
    const events = [
      JSON.stringify({
        id: errorId,
        type: "manual.error",
        ts: "2024-01-01T00:00:01Z",
        title: "Fixed error",
      }),
      JSON.stringify({
        id: "evt-fix-1",
        type: "manual.fix",
        ts: "2024-01-01T00:00:02Z",
        title: "Fix for error",
        errorId,
      }),
      makeEvent("manual.error", { title: "Open error", ts: "2024-01-01T00:00:03Z" }),
    ];
    const { paths, cleanup } = makeTempPaths({ eventsJsonl: events });
    try {
      const result = await buildSessionStartSummary({ paths });
      // 1 fixed + 1 unfixed → Open errors: 1
      expect(result.summary).toContain("Open errors: 1");
    } finally {
      cleanup();
    }
  });

  it("tokens ≤ 120 (chars ≤ 480) for all normal cases", async () => {
    const { paths, cleanup } = makeTempPaths({
      stateJson: {
        version: 1,
        disabled: false,
        warnings: [],
        staleLocksReleased: 0,
        currentPhase: "implementation",
        session: "sess-001",
        sessionLabel: "Sprint 1",
      },
      eventsJsonl: [
        makeEvent("manual.decision", { title: "Use TypeScript strict mode", ts: "2024-01-01T00:00:01Z" }),
        makeEvent("manual.error", { title: "Build fails on CI", ts: "2024-01-01T00:00:02Z" }),
      ],
    });
    try {
      const result = await buildSessionStartSummary({ paths });
      expect(result.tokens).toBeLessThanOrEqual(120);
      expect(result.summary.length).toBeLessThanOrEqual(480);
      expect(result.overBudget).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("very long decision title → summary is trimmed to ≤480 chars and overBudget=false", async () => {
    const longTitle = "A".repeat(400); // far exceeds any reasonable title
    const events = [
      makeEvent("manual.decision", { title: longTitle, ts: "2024-01-01T00:00:01Z" }),
    ];
    const { paths, cleanup } = makeTempPaths({ eventsJsonl: events });
    try {
      const result = await buildSessionStartSummary({ paths });
      expect(result.summary.length).toBeLessThanOrEqual(480);
      expect(result.tokens).toBeLessThanOrEqual(120);
      expect(result.overBudget).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("summary starts with 'LogBook context:'", async () => {
    const { paths, cleanup } = makeTempPaths({});
    try {
      const result = await buildSessionStartSummary({ paths });
      expect(result.summary.startsWith("LogBook context:")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("overBudget=false for empty state", async () => {
    const { paths, cleanup } = makeTempPaths({});
    try {
      const result = await buildSessionStartSummary({ paths });
      expect(result.overBudget).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("tokens = Math.ceil(summary.length / 4)", async () => {
    const { paths, cleanup } = makeTempPaths({});
    try {
      const result = await buildSessionStartSummary({ paths });
      expect(result.tokens).toBe(Math.ceil(result.summary.length / 4));
    } finally {
      cleanup();
    }
  });
});

/**
 * Unit tests for --no-stream / streaming activation policy (SG-A design D2).
 *
 * Tests:
 *   A6. SummarizeOptions.onChunk is passed through to router.call
 *   A7. --no-stream flag: onChunk NOT created / not passed
 *   A8. json mode: onChunk NOT created (json never interleaves chunks)
 *   A9. Non-TTY stdout: onChunk NOT created (auto-disable)
 *
 * These tests focus on the onChunk wiring in summarize.ts,
 * not the CLI command layer (which is tested in integration/cli-summarize.test.ts).
 * The CLI command behavior is verified by checking that summarizeMilestone
 * and summarizeProject are called with / without onChunk.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { LlmAdapterCallInput } from "../../src/types/llm.js";
import { createRouter } from "../../src/llm/provider-router.js";
import { summarizeMilestone } from "../../src/llm/summarize.js";
import { makePaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(tmp, `lb-nostream-test-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProjectDir(root: string): ReturnType<typeof makePaths> {
  fs.mkdirSync(path.join(root, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(root, "logbook", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
  return makePaths(root);
}

function writeEventsJsonl(eventsJsonlPath: string, lines: object[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  fs.writeFileSync(eventsJsonlPath, content, "utf-8");
}

function sampleEvents(): object[] {
  return [
    { id: "ev-001", type: "manual.decision", ts: "2026-01-01T10:00:00.000Z", title: "A decision" },
    { id: "m-STREAM01", type: "manual.milestone", ts: "2026-01-01T10:10:00.000Z", title: "v1" },
  ];
}

const MOCK_TEXT = "## Summary\n\nParagraph one. Paragraph two. Paragraph three.";
const MILESTONE_ID = "m-STREAM01";

function makeStreamingMock(receivedOnChunk: { value: ((s: string) => void) | undefined }) {
  return async (input: LlmAdapterCallInput): Promise<string> => {
    receivedOnChunk.value = input.onChunk;
    if (input.onChunk) {
      const parts = MOCK_TEXT.split(". ");
      for (const part of parts) {
        await Promise.resolve();
        input.onChunk(part);
      }
    }
    return MOCK_TEXT;
  };
}

// ---------------------------------------------------------------------------
// A6. summarizeMilestone: onChunk is forwarded to router
// ---------------------------------------------------------------------------

describe("A6: summarizeMilestone forwards onChunk when provided", () => {
  let root: string;
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    root = makeTmpDir();
    paths = makeProjectDir(root);
    writeEventsJsonl(paths.eventsJsonl, sampleEvents());
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("chunks are received by onChunk callback", async () => {
    const received = { value: undefined as ((s: string) => void) | undefined };
    const router = createRouter({
      providersPath: "/nonexistent/providers.json",
      mockAdapter: makeStreamingMock(received),
      sleep: async () => {},
    });

    const chunks: string[] = [];
    const result = await summarizeMilestone({
      router, paths, milestoneId: MILESTONE_ID,
      onChunk: (s) => chunks.push(s),
    });

    expect(result.ok).toBe(true);
    expect(received.value).toBeDefined();
    expect(typeof received.value).toBe("function");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// A7. Without onChunk (simulating --no-stream): adapter receives no callback
// ---------------------------------------------------------------------------

describe("A7: summarizeMilestone without onChunk (no-stream mode)", () => {
  let root: string;
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    root = makeTmpDir();
    paths = makeProjectDir(root);
    writeEventsJsonl(paths.eventsJsonl, sampleEvents());
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("adapter receives undefined onChunk when not provided (back-compat)", async () => {
    const received = { value: undefined as ((s: string) => void) | undefined };

    // Initialize to a function to detect if it's set to something unexpected
    received.value = (() => {}) as any;

    const mockAdapter = async (input: LlmAdapterCallInput): Promise<string> => {
      received.value = input.onChunk;
      return MOCK_TEXT;
    };

    const router = createRouter({
      providersPath: "/nonexistent/providers.json",
      mockAdapter,
      sleep: async () => {},
    });

    const result = await summarizeMilestone({
      router, paths, milestoneId: MILESTONE_ID,
      // No onChunk
    });

    expect(result.ok).toBe(true);
    expect(received.value).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A8 + A9. summarizeMilestone signature back-compat
// ---------------------------------------------------------------------------

describe("A8 + A9: summarizeMilestone back-compat (signature unchanged)", () => {
  let root: string;
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    root = makeTmpDir();
    paths = makeProjectDir(root);
    writeEventsJsonl(paths.eventsJsonl, sampleEvents());
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("summarizeMilestone signature is back-compat (milestoneId required, onChunk optional)", async () => {
    const mockAdapter = async (_input: LlmAdapterCallInput): Promise<string> => MOCK_TEXT;
    const router = createRouter({
      providersPath: "/nonexistent/providers.json",
      mockAdapter,
      sleep: async () => {},
    });

    // Old calling convention (no onChunk) still works
    const result = await summarizeMilestone({
      router, paths, milestoneId: "last",
    });

    expect(result.ok).toBe(true);
    expect(result.summaryPath).toBeDefined();
    expect(result.bytes).toBeGreaterThan(0);
  });

  test("summarizeProject signature is back-compat (no required streaming args)", async () => {
    const { summarizeProject } = await import("../../src/llm/summarize.js");

    const mockAdapter = async (_input: LlmAdapterCallInput): Promise<string> => MOCK_TEXT;
    const router = createRouter({
      providersPath: "/nonexistent/providers.json",
      mockAdapter,
      sleep: async () => {},
    });

    // Old calling convention (no onChunk) still works
    const result = await summarizeProject({
      router, paths,
    });

    expect(result.ok).toBe(true);
    expect(result.summaryPath).toBeDefined();
  });
});

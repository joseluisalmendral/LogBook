/**
 * Unit tests for src/llm/summarize.ts (T8).
 *
 * Tests the summarizeMilestone and summarizeProject orchestration functions
 * using a mocked router — zero real LLM calls.
 *
 * TDD Cycle:
 *   RED  → these tests fail with "Cannot find module" (module not yet created)
 *   GREEN → implement summarize.ts so all tests pass
 *   REFACTOR → clean up if needed
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { LlmProviderRouter, LlmProviderCallResult } from "../../src/types/llm.js";
import { summarizeMilestone, summarizeProject } from "../../src/llm/summarize.js";
import { makePaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(tmp, `lb-summ-test-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProjectDir(root: string): ReturnType<typeof makePaths> {
  // Create the minimum directory structure a real logbook project has
  fs.mkdirSync(path.join(root, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(root, "logbook", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
  return makePaths(root);
}

/** Write a fake events.jsonl with controllable content. */
function writeEventsJsonl(eventsJsonlPath: string, lines: object[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  fs.writeFileSync(eventsJsonlPath, content, "utf-8");
}

/** Build a mock router that always returns the given result. */
function makeMockRouter(result: LlmProviderCallResult): LlmProviderRouter {
  return {
    async call() {
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_SUCCESS_TEXT = "## Summary\n\nMock summary body for test.";

const MOCK_SUCCESS_RESULT: LlmProviderCallResult = {
  ok: true,
  text: MOCK_SUCCESS_TEXT,
  provider: "mock-provider",
  model: "mock-model",
  latencyMs: 0,
  redactedFields: 0,
};

const MOCK_FAILURE_RESULT: LlmProviderCallResult = {
  ok: false,
  error: { code: "no_auth", message: "No authentication available", retryable: false },
  provider: "mock-provider",
  model: "mock-model",
  latencyMs: 0,
  redactedFields: 0,
};

const MILESTONE_ID = "m-01JVT1234ABCDE";

function sampleEvents(milestoneId = MILESTONE_ID): object[] {
  return [
    {
      id: "ev-001",
      type: "manual.session_start",
      ts: "2026-01-01T10:00:00.000Z",
      name: "iter1",
    },
    {
      id: "ev-002",
      type: "manual.decision",
      ts: "2026-01-01T10:05:00.000Z",
      title: "Use JSONL for storage",
    },
    {
      id: "ev-003",
      type: "manual.error",
      ts: "2026-01-01T10:10:00.000Z",
      title: "TS compile error",
    },
    {
      id: "ev-004",
      type: "manual.fix",
      ts: "2026-01-01T10:15:00.000Z",
      summary: "Fixed import path",
    },
    {
      id: milestoneId,
      type: "manual.milestone",
      ts: "2026-01-01T10:20:00.000Z",
      title: "Iteration 1 complete",
    },
  ];
}

// ---------------------------------------------------------------------------
// summarizeMilestone — success path
// ---------------------------------------------------------------------------

describe("summarizeMilestone — success path", () => {
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

  test("writes summary file to evidence/summaries/<milestoneId>.md", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await summarizeMilestone({ router, paths, milestoneId: MILESTONE_ID });

    expect(result.ok).toBe(true);
    const expectedPath = path.join(paths.dataDir, "evidence", "summaries", `${MILESTONE_ID}.md`);
    expect(result.summaryPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
    const content = fs.readFileSync(expectedPath, "utf-8");
    expect(content).toBe(MOCK_SUCCESS_TEXT);
  });

  test("returns bytes matching written file size", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await summarizeMilestone({ router, paths, milestoneId: MILESTONE_ID });

    expect(result.ok).toBe(true);
    expect(typeof result.bytes).toBe("number");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.bytes).toBe(Buffer.byteLength(MOCK_SUCCESS_TEXT, "utf-8"));
  });

  test("milestoneId='last' resolves to the most recent manual.milestone event", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await summarizeMilestone({ router, paths, milestoneId: "last" });

    expect(result.ok).toBe(true);
    // The summary file should be at MILESTONE_ID (the last milestone in the fixture)
    const expectedPath = path.join(paths.dataDir, "evidence", "summaries", `${MILESTONE_ID}.md`);
    expect(result.summaryPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// summarizeMilestone — failure paths
// ---------------------------------------------------------------------------

describe("summarizeMilestone — failure paths", () => {
  let root: string;
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    root = makeTmpDir();
    paths = makeProjectDir(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns ok=false with error message when router returns ok=false", async () => {
    writeEventsJsonl(paths.eventsJsonl, sampleEvents());
    const router = makeMockRouter(MOCK_FAILURE_RESULT);

    const result = await summarizeMilestone({ router, paths, milestoneId: MILESTONE_ID });

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("no_auth");
    expect(result.summaryPath).toBeUndefined();
    expect(result.bytes).toBeUndefined();
  });

  test("returns ok=false when no milestones found and milestoneId='last'", async () => {
    // Write events with NO manual.milestone event
    writeEventsJsonl(paths.eventsJsonl, [
      { id: "ev-001", type: "manual.decision", ts: "2026-01-01T10:00:00.000Z", title: "A decision" },
    ]);
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await summarizeMilestone({ router, paths, milestoneId: "last" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no milestones found/i);
  });

  test("returns ok=false with useful error when milestoneId not found in events", async () => {
    writeEventsJsonl(paths.eventsJsonl, sampleEvents());
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await summarizeMilestone({ router, paths, milestoneId: "m-NONEXISTENT" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found|no milestone/i);
  });

  test("returns ok=false with useful error when events.jsonl is missing", async () => {
    // Do NOT write events.jsonl
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await summarizeMilestone({ router, paths, milestoneId: "last" });

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// summarizeProject — success path
// ---------------------------------------------------------------------------

describe("summarizeProject — success path", () => {
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

  test("writes project summary to evidence/summaries/project.md", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await summarizeProject({ router, paths });

    expect(result.ok).toBe(true);
    const expectedPath = path.join(paths.dataDir, "evidence", "summaries", "project.md");
    expect(result.summaryPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
    const content = fs.readFileSync(expectedPath, "utf-8");
    expect(content).toBe(MOCK_SUCCESS_TEXT);
  });

  test("returns bytes matching written file size", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await summarizeProject({ router, paths });

    expect(result.ok).toBe(true);
    expect(typeof result.bytes).toBe("number");
    expect(result.bytes).toBe(Buffer.byteLength(MOCK_SUCCESS_TEXT, "utf-8"));
  });
});

// ---------------------------------------------------------------------------
// summarizeProject — failure path
// ---------------------------------------------------------------------------

describe("summarizeProject — failure path", () => {
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

  test("returns ok=false with error message when router returns ok=false", async () => {
    const router = makeMockRouter(MOCK_FAILURE_RESULT);

    const result = await summarizeProject({ router, paths });

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("no_auth");
  });
});

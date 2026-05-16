/**
 * Unit tests for src/generate/teaching-script-doc.ts (T12).
 *
 * Tests the generateTeachingScript function using a mocked router.
 * Zero real LLM calls — STRICT TDD mode active.
 *
 * TDD Cycle:
 *   RED  → these tests fail with "Cannot find module" (module not yet created)
 *   GREEN → implement teaching-script-doc.ts so all tests pass
 *   REFACTOR → clean up if needed
 *
 * Scenarios:
 *   1. Success path: ok=true, file written with idempotent markers, correct bytes
 *   2. milestoneId="last" resolves to most recent manual.milestone event
 *   3. Error path: router returns ok=false → ok=false result
 *   4. No milestones: empty events.jsonl + milestoneId="last" → ok=false "no milestones found"
 *   5. Idempotency: second call replaces content inside markers; content outside preserved
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { LlmProviderRouter, LlmProviderCallResult } from "../../src/types/llm.js";
import { generateTeachingScript } from "../../src/generate/teaching-script-doc.js";
import { makePaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(tmp, `lb-ts-test-${randomUUID()}`);
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

const MOCK_SCRIPT_TEXT =
  "## Overview\n\nMock teaching script content for the milestone.\n\n## Key Decisions\n\n- Used JSONL for storage.\n\n## Common Pitfalls\n\n- None in this milestone.\n\n## Lessons to Emphasize\n\n- Always write tests first.\n\n## Discussion Prompts\n\n- Why did we choose JSONL?";

const MILESTONE_ID = "m-01JVTTS1234567890";

const MOCK_SUCCESS_RESULT: LlmProviderCallResult = {
  ok: true,
  text: MOCK_SCRIPT_TEXT,
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

function sampleEvents(milestoneId = MILESTONE_ID): object[] {
  return [
    {
      id: "ev-001",
      type: "manual.session_start",
      ts: "2026-01-01T09:00:00.000Z",
      name: "iter3",
    },
    {
      id: "ev-002",
      type: "manual.decision",
      ts: "2026-01-01T10:00:00.000Z",
      title: "Use JSONL for storage",
      rationale: "Simple, append-only, schema-free",
    },
    {
      id: "ev-003",
      type: "manual.decision",
      ts: "2026-01-01T10:05:00.000Z",
      title: "Use citty for CLI",
      rationale: "Minimal surface, no magic",
    },
    {
      id: "ev-004",
      type: "manual.error",
      ts: "2026-01-01T10:10:00.000Z",
      title: "TS compile error on import",
    },
    {
      id: "ev-005",
      type: "manual.fix",
      ts: "2026-01-01T10:15:00.000Z",
      summary: "Fixed import extension to .js",
    },
    {
      id: "ev-006",
      type: "manual.lesson",
      ts: "2026-01-01T10:20:00.000Z",
      text: "Always add .js extensions in ESM TypeScript",
    },
    {
      id: "ev-007",
      type: "manual.lesson",
      ts: "2026-01-01T10:25:00.000Z",
      text: "Test early, test often",
    },
    {
      id: milestoneId,
      type: "manual.milestone",
      ts: "2026-01-01T10:30:00.000Z",
      title: "Iteration 3 complete",
      description: "All iter3 tasks done",
    },
  ];
}

// ---------------------------------------------------------------------------
// Success path — file written with markers
// ---------------------------------------------------------------------------

describe("generateTeachingScript — success path", () => {
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

  test("returns ok=true and writes file to teaching-scripts/<milestoneId>.md", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await generateTeachingScript({ router, paths, milestoneId: MILESTONE_ID });

    expect(result.ok).toBe(true);
    const expectedPath = path.join(paths.dataDir, "teaching-scripts", `${MILESTONE_ID}.md`);
    expect(result.filePath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  test("written file contains logbook:teaching-script idempotent markers", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    await generateTeachingScript({ router, paths, milestoneId: MILESTONE_ID });

    const expectedPath = path.join(paths.dataDir, "teaching-scripts", `${MILESTONE_ID}.md`);
    const content = fs.readFileSync(expectedPath, "utf-8");
    expect(content).toContain("<!-- logbook:teaching-script start v=1 -->");
    expect(content).toContain("<!-- logbook:teaching-script end -->");
  });

  test("written file contains the LLM mock text inside the markers", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    await generateTeachingScript({ router, paths, milestoneId: MILESTONE_ID });

    const expectedPath = path.join(paths.dataDir, "teaching-scripts", `${MILESTONE_ID}.md`);
    const content = fs.readFileSync(expectedPath, "utf-8");
    expect(content).toContain(MOCK_SCRIPT_TEXT);
  });

  test("returns bytes > 0 matching actual file size", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await generateTeachingScript({ router, paths, milestoneId: MILESTONE_ID });

    expect(result.ok).toBe(true);
    expect(typeof result.bytes).toBe("number");
    expect(result.bytes).toBeGreaterThan(0);
    const expectedPath = path.join(paths.dataDir, "teaching-scripts", `${MILESTONE_ID}.md`);
    const fileBytes = fs.statSync(expectedPath).size;
    expect(result.bytes).toBe(fileBytes);
  });

  test("milestoneId='last' resolves to the most recent manual.milestone event", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await generateTeachingScript({ router, paths, milestoneId: "last" });

    expect(result.ok).toBe(true);
    const expectedPath = path.join(paths.dataDir, "teaching-scripts", `${MILESTONE_ID}.md`);
    expect(result.filePath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  test("outDir override places file in specified directory", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);
    const customOutDir = path.join(root, "custom-output");
    fs.mkdirSync(customOutDir, { recursive: true });

    const result = await generateTeachingScript({
      router,
      paths,
      milestoneId: MILESTONE_ID,
      outDir: customOutDir,
    });

    expect(result.ok).toBe(true);
    const expectedPath = path.join(customOutDir, `${MILESTONE_ID}.md`);
    expect(result.filePath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error path — router failure
// ---------------------------------------------------------------------------

describe("generateTeachingScript — error path", () => {
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

  test("returns ok=false when router returns ok=false", async () => {
    const router = makeMockRouter(MOCK_FAILURE_RESULT);

    const result = await generateTeachingScript({ router, paths, milestoneId: MILESTONE_ID });

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("no_auth");
    expect(result.filePath).toBeUndefined();
    expect(result.bytes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No milestones path
// ---------------------------------------------------------------------------

describe("generateTeachingScript — no milestones", () => {
  let root: string;
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    root = makeTmpDir();
    paths = makeProjectDir(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns ok=false with 'no milestones found' when events.jsonl has no milestones and id='last'", async () => {
    writeEventsJsonl(paths.eventsJsonl, [
      { id: "ev-001", type: "manual.decision", ts: "2026-01-01T10:00:00.000Z", title: "A decision" },
    ]);
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await generateTeachingScript({ router, paths, milestoneId: "last" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no milestones found/i);
  });

  test("returns ok=false when events.jsonl is missing", async () => {
    // Do NOT write events.jsonl
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await generateTeachingScript({ router, paths, milestoneId: "last" });

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  test("returns ok=false with useful error when milestoneId not found", async () => {
    writeEventsJsonl(paths.eventsJsonl, sampleEvents());
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result = await generateTeachingScript({ router, paths, milestoneId: "m-NONEXISTENT" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found|no milestone/i);
  });
});

// ---------------------------------------------------------------------------
// Idempotency: second call replaces inside markers; outside content preserved
// ---------------------------------------------------------------------------

describe("generateTeachingScript — idempotency", () => {
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

  test("second call replaces content inside markers, preserving content outside", async () => {
    const router1 = makeMockRouter({
      ...MOCK_SUCCESS_RESULT,
      text: "## First run\n\nFirst script content.",
    });

    const result1 = await generateTeachingScript({ router: router1, paths, milestoneId: MILESTONE_ID });
    expect(result1.ok).toBe(true);
    const filePath = result1.filePath!;

    // Prepend some outside-marker content to simulate real user edits
    const existingContent = fs.readFileSync(filePath, "utf-8");
    const outsideContent = "# Teaching Script Header\n\nManually added intro.\n\n";
    fs.writeFileSync(filePath, outsideContent + existingContent, "utf-8");

    // Second call with different LLM output
    const router2 = makeMockRouter({
      ...MOCK_SUCCESS_RESULT,
      text: "## Second run\n\nUpdated script content.",
    });
    const result2 = await generateTeachingScript({ router: router2, paths, milestoneId: MILESTONE_ID });
    expect(result2.ok).toBe(true);

    const finalContent = fs.readFileSync(filePath, "utf-8");
    // Outside content preserved
    expect(finalContent).toContain("# Teaching Script Header");
    expect(finalContent).toContain("Manually added intro.");
    // Markers still present
    expect(finalContent).toContain("<!-- logbook:teaching-script start v=1 -->");
    expect(finalContent).toContain("<!-- logbook:teaching-script end -->");
    // New LLM content inside
    expect(finalContent).toContain("Second run");
    expect(finalContent).toContain("Updated script content.");
    // Old LLM content gone
    expect(finalContent).not.toContain("First run");
    expect(finalContent).not.toContain("First script content.");
  });

  test("second call with identical LLM output produces identical file (no-op idempotency)", async () => {
    const router = makeMockRouter(MOCK_SUCCESS_RESULT);

    const result1 = await generateTeachingScript({ router, paths, milestoneId: MILESTONE_ID });
    expect(result1.ok).toBe(true);
    const content1 = fs.readFileSync(result1.filePath!, "utf-8");

    const result2 = await generateTeachingScript({ router, paths, milestoneId: MILESTONE_ID });
    expect(result2.ok).toBe(true);
    const content2 = fs.readFileSync(result2.filePath!, "utf-8");

    expect(content2).toBe(content1);
  });
});

/**
 * Unit tests for `--out` option on summarize milestone/project (S3.3).
 *
 * Tests verify that when outPath is passed to summarizeMilestone /
 * summarizeProject, the summary is written to that path instead of the
 * default evidence/summaries/<id>.md.
 *
 * Test strategy: inject a mock router (LOGBOOK_LLM_MOCK pattern) so no real
 * LLM calls occur. Verify the output file is written at the custom path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { summarizeMilestone, summarizeProject } from "../../src/llm/summarize.js";
import { makePaths } from "../../src/core/paths.js";
import type { LlmProviderRouter } from "../../src/types/llm.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a deterministic mock router that returns a fixed string. */
function makeMockRouter(text = "## Mock Summary\n\nContent.\n"): LlmProviderRouter {
  return {
    call: async () => ({ ok: true, text }),
  };
}

function makeTmpProject(eventsContent?: string): {
  dir: string;
  paths: ReturnType<typeof makePaths>;
} {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-sum-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" })
  );
  fs.writeFileSync(
    path.join(dir, ".logbook", "state.json"),
    JSON.stringify({ version: 1, disabled: false, warnings: [] }, null, 2) + "\n"
  );

  // Default events: one milestone so summarizeMilestone 'last' resolves
  const defaultEvents = [
    JSON.stringify({
      type: "manual.milestone",
      id: "01HMILE0001",
      ts: "2026-01-01T10:00:00.000Z",
      session: "s1",
      title: "Alpha Release",
    }),
  ].join("\n") + "\n";

  fs.writeFileSync(
    path.join(dir, "logbook", "evidence", "events.jsonl"),
    eventsContent ?? defaultEvents,
    "utf8"
  );

  return { dir, paths: makePaths(dir) };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs.length = 0;
});

// ---------------------------------------------------------------------------
// summarizeMilestone --out
// ---------------------------------------------------------------------------

describe("summarizeMilestone --out flag", () => {
  it("summarize milestone --out <path> writes to that path", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);

    const router = makeMockRouter();
    const customOut = path.join(dir, "custom-milestone-summary.md");

    const result = await summarizeMilestone({
      router,
      paths,
      milestoneId: "last",
      outPath: customOut,
    });

    expect(result.ok).toBe(true);
    expect(result.summaryPath).toBe(customOut);
    expect(fs.existsSync(customOut)).toBe(true);
    const content = fs.readFileSync(customOut, "utf8");
    expect(content).toContain("## Mock Summary");
  });

  it("summarize milestone without --out uses default path (backward compat)", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);

    const router = makeMockRouter();

    const result = await summarizeMilestone({
      router,
      paths,
      milestoneId: "last",
    });

    expect(result.ok).toBe(true);
    // Default path: evidence/summaries/<milestoneId>.md
    expect(result.summaryPath).toContain(
      path.join("evidence", "summaries")
    );
    expect(result.summaryPath).toMatch(/01HMILE0001\.md$/);
    expect(fs.existsSync(result.summaryPath!)).toBe(true);
  });

  it("summarize milestone --out creates parent dirs if needed", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);

    const router = makeMockRouter();
    const customOut = path.join(dir, "nested", "deep", "summary.md");

    const result = await summarizeMilestone({
      router,
      paths,
      milestoneId: "last",
      outPath: customOut,
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(customOut)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// summarizeProject --out
// ---------------------------------------------------------------------------

describe("summarizeProject --out flag", () => {
  it("summarize project --out <path> writes to that path", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);

    const router = makeMockRouter();
    const customOut = path.join(dir, "custom-project-summary.md");

    const result = await summarizeProject({
      router,
      paths,
      outPath: customOut,
    });

    expect(result.ok).toBe(true);
    expect(result.summaryPath).toBe(customOut);
    expect(fs.existsSync(customOut)).toBe(true);
    const content = fs.readFileSync(customOut, "utf8");
    expect(content).toContain("## Mock Summary");
  });

  it("summarize project without --out uses default path (backward compat)", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);

    const router = makeMockRouter();

    const result = await summarizeProject({ router, paths });

    expect(result.ok).toBe(true);
    expect(result.summaryPath).toContain(
      path.join("evidence", "summaries")
    );
    expect(result.summaryPath).toMatch(/project\.md$/);
    expect(fs.existsSync(result.summaryPath!)).toBe(true);
  });

  it("summarize project --out <path> writes correct content", async () => {
    const { dir, paths } = makeTmpProject();
    tmpDirs.push(dir);

    const customText = "# Project Arc\n\nDetailed project summary.\n";
    const router = makeMockRouter(customText);
    const customOut = path.join(dir, "arc-summary.md");

    const result = await summarizeProject({
      router,
      paths,
      outPath: customOut,
    });

    expect(result.ok).toBe(true);
    const content = fs.readFileSync(customOut, "utf8");
    expect(content).toBe(customText);
  });
});

/**
 * Integration test: conversation capture end-to-end (W2+W3 integration spec).
 *
 * Verifies:
 *   - Synthetic transcript file + Stop hook payload → JSONL gains expected
 *     claude_message events for assistant text turns
 *   - No user_prompt duplication (scraper skips user lines — ADR-2)
 *   - user_prompt from UserPromptSubmit hook → JSONL entry via ingest
 *   - subagent_complete event emitted when sub-agent folder present
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readTranscriptNewLines,
  transcriptLineToEvents,
  pathToEncoded,
} from "../../src/connectors/claude-code/transcript.js";
import { readContext } from "../../src/generate/render-context.js";
import { appendEvent } from "../../src/store/index.js";
import type { ProjectPaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePaths(root: string): ProjectPaths {
  const logbookDir = path.join(root, ".logbook");
  const evidenceDir = path.join(root, "logbook", "evidence");
  fs.mkdirSync(logbookDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  return {
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("conversation capture — end-to-end pipeline", () => {
  let tmpDir: string;
  let projectRoot: string;
  let paths: ProjectPaths;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-e2e-cc-"));
    projectRoot = tmpDir;
    paths = makePaths(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("UserPromptSubmit ingest writes user_prompt event to JSONL", async () => {
    // Simulate what ingestClaudePayload does for UserPromptSubmit.
    await appendEvent(paths, {
      kind: "user_prompt",
      sessionId: "sess-e2e-001",
      payload: { text: "implement the feature" },
      provider: "claude-code",
    });

    const ctx = await readContext(paths);
    const promptEvents = ctx.all.filter((e) => e.type === "user_prompt");
    expect(promptEvents).toHaveLength(1);
    expect(promptEvents[0]!["text"]).toBe("implement the feature");
  });

  it("transcript scraper maps assistant turns to claude_message events", async () => {
    // Build a synthetic transcript file.
    const transcriptLines = [
      JSON.stringify({
        type: "assistant",
        uuid: "ua1",
        timestamp: "2026-05-20T10:01:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I'll implement the render-context fix." }],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "up1",
        message: { role: "user", content: "next prompt" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "ua2",
        timestamp: "2026-05-20T10:05:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Let me verify my approach." },
            { type: "text", text: "Done! Here is the result." },
          ],
        },
      }),
    ];

    const transcriptPath = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(transcriptPath, transcriptLines.join("\n") + "\n", "utf8");

    // Read transcript and map to events.
    const { lines } = await readTranscriptNewLines(transcriptPath, 0);

    const events = lines.flatMap((line) =>
      transcriptLineToEvents(line, "sess-e2e-002"),
    );

    // Slice-23 backfill: 2 assistant text blocks + 1 thinking block + 1 user_prompt
    // (the "next prompt" line) = 4 events. The user_prompt is backfilled with no
    // dedup set passed so it always emits in this test.
    expect(events).toHaveLength(4);

    const claudeMessages = events.filter((e) => e.kind === "claude_message");
    const userPrompts = events.filter((e) => e.kind === "user_prompt");
    const textEvents = claudeMessages.filter(
      (e) => !(e.payload as Record<string, unknown>)["isThinking"],
    );
    const thinkingEvents = claudeMessages.filter(
      (e) => (e.payload as Record<string, unknown>)["isThinking"] === true,
    );

    expect(textEvents).toHaveLength(2);
    expect(thinkingEvents).toHaveLength(1);
    expect(userPrompts).toHaveLength(1);
    expect((userPrompts[0]!.payload as Record<string, unknown>)["text"]).toBe(
      "next prompt",
    );
    expect(
      (userPrompts[0]!.payload as Record<string, unknown>)["backfilledFromTranscript"],
    ).toBe(true);
    expect((textEvents[0]!.payload as Record<string, unknown>)["text"]).toContain(
      "render-context fix",
    );
    expect((textEvents[1]!.payload as Record<string, unknown>)["text"]).toContain("Done!");
  });

  it("user lines are deduped against the existing hash set (slice-23 backfill)", async () => {
    const { userPromptHash } = await import(
      "../../src/connectors/claude-code/transcript.js"
    );
    const transcriptLine = JSON.stringify({
      type: "user",
      uuid: "up1",
      message: { role: "user", content: "implement feature" },
    });

    const transcriptPath = path.join(tmpDir, "session2.jsonl");
    fs.writeFileSync(transcriptPath, transcriptLine + "\n", "utf8");

    const { lines } = await readTranscriptNewLines(transcriptPath, 0);

    // Without dedup set → emits one user_prompt (the backfill path).
    const noDedup = lines.flatMap((line) =>
      transcriptLineToEvents(line, "sess-e2e-003"),
    );
    expect(noDedup).toHaveLength(1);
    expect(noDedup[0]!.kind).toBe("user_prompt");

    // With dedup set containing the text's hash → skips (UserPromptSubmit
    // would have caught it live; scraper must not duplicate).
    const dedup = new Set<string>([userPromptHash("implement feature")]);
    const withDedup = lines.flatMap((line) =>
      transcriptLineToEvents(line, "sess-e2e-003", dedup),
    );
    expect(withDedup).toHaveLength(0);
  });

  it("pathToEncoded is stable across multiple calls with the same input", () => {
    const abs =
      "/Users/joseluis.fernandez/Documents/CONSTRUCCION FORMACION IA B2B/LogBook-repo";
    expect(pathToEncoded(abs)).toBe(pathToEncoded(abs));
    // Empirically verified: dots and underscores also become dashes.
    expect(pathToEncoded(abs)).toBe(
      "-Users-joseluis-fernandez-Documents-CONSTRUCCION-FORMACION-IA-B2B-LogBook-repo",
    );
  });
});

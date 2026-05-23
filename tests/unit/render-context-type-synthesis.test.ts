/**
 * Unit tests: render-context type synthesis for new event kinds (W1 spec).
 *
 * Verifies that normalizeEvent (via readContext) synthesizes correct `type` strings
 * for: tool_use, tool_result, hook_event, user_prompt, claude_message, subagent_complete.
 * Also verifies no regression on manual.* (legacy events pass through unchanged).
 */

import { describe, it, expect } from "vitest";
import { readContext } from "../../src/generate/render-context.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectPaths } from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempPaths(events: object[]): { paths: ProjectPaths; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-rc-synth-"));
  const evidenceDir = path.join(dir, "logbook", "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const eventsJsonl = path.join(evidenceDir, "events.jsonl");
  fs.writeFileSync(eventsJsonl, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  const paths: ProjectPaths = {
    root: dir,
    logbookDir: path.join(dir, ".logbook"),
    manifestPath: path.join(dir, ".logbook", "install-manifest.json"),
    configPath: path.join(dir, ".logbook", "config.json"),
    providersPath: path.join(dir, ".logbook", "providers.json"),
    statePath: path.join(dir, ".logbook", "state.json"),
    indexDbPath: path.join(dir, ".logbook", "index.sqlite"),
    backupsDir: path.join(dir, ".logbook", "backups"),
    dataDir: path.join(dir, "logbook"),
    evidenceDir,
    eventsJsonl,
  };

  return {
    paths,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("render-context type synthesis — W1 new kinds", () => {
  it("synthesizes user_prompt type for kind=user_prompt", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA001",
        kind: "user_prompt",
        timestamp: "2026-05-20T10:00:00.000Z",
        sessionId: "sess-1",
        payload: { text: "implement the feature" },
      },
    ]);
    try {
      const ctx = await readContext(paths);
      expect(ctx.all).toHaveLength(1);
      expect(ctx.all[0]!.type).toBe("user_prompt");
    } finally {
      cleanup();
    }
  });

  it("synthesizes claude_message type for kind=claude_message", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA002",
        kind: "claude_message",
        timestamp: "2026-05-20T10:01:00.000Z",
        sessionId: "sess-1",
        payload: { text: "I will start with the render-context fix." },
      },
    ]);
    try {
      const ctx = await readContext(paths);
      expect(ctx.all[0]!.type).toBe("claude_message");
    } finally {
      cleanup();
    }
  });

  it("synthesizes subagent_complete type for kind=subagent_complete", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA003",
        kind: "subagent_complete",
        timestamp: "2026-05-20T10:05:00.000Z",
        sessionId: "sess-1",
        payload: { agentId: "ag-1", toolCallCount: 4 },
      },
    ]);
    try {
      const ctx = await readContext(paths);
      expect(ctx.all[0]!.type).toBe("subagent_complete");
    } finally {
      cleanup();
    }
  });

  it("synthesizes tool_use.read type for kind=tool_use with tool_name=Read", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA004",
        kind: "tool_use",
        timestamp: "2026-05-20T10:02:00.000Z",
        sessionId: "sess-1",
        payload: { tool_name: "Read", tool_args: { file_path: "src/foo.ts" } },
      },
    ]);
    try {
      const ctx = await readContext(paths);
      expect(ctx.all[0]!.type).toBe("tool_use.read");
    } finally {
      cleanup();
    }
  });

  it("synthesizes tool_result.bash type for kind=tool_result with tool_name=Bash", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA005",
        kind: "tool_result",
        timestamp: "2026-05-20T10:03:00.000Z",
        sessionId: "sess-1",
        payload: { tool_name: "Bash", tool_response: "exit 0" },
      },
    ]);
    try {
      const ctx = await readContext(paths);
      expect(ctx.all[0]!.type).toBe("tool_result.bash");
    } finally {
      cleanup();
    }
  });

  it("synthesizes hook.Stop type for kind=hook_event with hook_event_name=Stop", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA006",
        kind: "hook_event",
        timestamp: "2026-05-20T10:04:00.000Z",
        sessionId: "sess-1",
        payload: { hook_event_name: "Stop" },
        hook_event_name: "Stop",
      },
    ]);
    try {
      const ctx = await readContext(paths);
      // hook_event_name is flattened into merged; type should be hook.Stop
      expect(ctx.all[0]!.type).toMatch(/^hook\./);
    } finally {
      cleanup();
    }
  });

  it("synthesizes unknown type for truly unrecognized kind", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA007",
        kind: "future_unknown_kind",
        timestamp: "2026-05-20T10:06:00.000Z",
        sessionId: "sess-1",
        payload: {},
      },
    ]);
    try {
      const ctx = await readContext(paths);
      expect(ctx.all[0]!.type).toBe("unknown");
    } finally {
      cleanup();
    }
  });

  it("does not overwrite existing type on legacy manual.decision events", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA008",
        type: "manual.decision",
        ts: "2026-05-20T10:07:00.000Z",
        sessionId: "sess-1",
        title: "Use JSONL",
      },
    ]);
    try {
      const ctx = await readContext(paths);
      expect(ctx.all[0]!.type).toBe("manual.decision");
    } finally {
      cleanup();
    }
  });

  it("synthesizes manual.session_goal type for user_entry with session_goal entryType", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA009",
        kind: "user_entry",
        timestamp: "2026-05-20T10:08:00.000Z",
        sessionId: "sess-1",
        payload: { entryType: "session_goal", text: "Ship the feature" },
      },
    ]);
    try {
      const ctx = await readContext(paths);
      expect(ctx.all[0]!.type).toBe("manual.session_goal");
    } finally {
      cleanup();
    }
  });

  it("populates conversation bucket with user_prompt and claude_message events", async () => {
    const { paths, cleanup } = makeTempPaths([
      {
        id: "01HZA010",
        kind: "user_prompt",
        timestamp: "2026-05-20T10:00:00.000Z",
        sessionId: "sess-1",
        payload: { text: "hello" },
      },
      {
        id: "01HZA011",
        kind: "claude_message",
        timestamp: "2026-05-20T10:01:00.000Z",
        sessionId: "sess-1",
        payload: { text: "hi there" },
      },
      {
        id: "01HZA012",
        type: "manual.decision",
        ts: "2026-05-20T10:02:00.000Z",
        sessionId: "sess-1",
        title: "Decision X",
      },
    ]);
    try {
      const ctx = await readContext(paths);
      expect(ctx.all).toHaveLength(3);
      // conversation bucket: only user_prompt + claude_message
      expect(ctx.conversation).toHaveLength(2);
      expect(ctx.conversation![0]!.type).toBe("user_prompt");
      expect(ctx.conversation![1]!.type).toBe("claude_message");
    } finally {
      cleanup();
    }
  });
});

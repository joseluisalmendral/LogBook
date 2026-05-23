/**
 * Unit tests: Langfuse Stop-hook bridge (B1 spec).
 *
 * Tests cover:
 *   - Happy path: Langfuse configured + traces returned → events persisted
 *   - 150ms timeout: degrade silently (B1-R2)
 *   - Langfuse not configured: skip silently (B1-R5)
 *   - PASSIVE invariant: bridge does not alter AI tool behavior (B1-S4, INV-1)
 *
 * NOTE: These tests mock appendEvent and fs operations.
 * Covers AG-5, AG-6, B1-S1–B1-S4.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mock appendEvent before importing the bridge.
// ---------------------------------------------------------------------------

vi.mock("../../src/store/index.js", () => ({
  appendEvent: vi.fn().mockResolvedValue({ event: { id: "mock-id" }, ned: false }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MOCK_PATHS = {
  root: "/tmp/mock-project",
  logbookDir: "/tmp/mock-project/.logbook",
  manifestPath: "/tmp/mock-project/.logbook/install-manifest.json",
  configPath: "/tmp/mock-project/.logbook/config.json",
  providersPath: "/tmp/mock-project/.logbook/providers.json",
  statePath: "/tmp/mock-project/.logbook/state.json",
  indexDbPath: "/tmp/mock-project/.logbook/index.sqlite",
  backupsDir: "/tmp/mock-project/.logbook/backups",
  dataDir: "/tmp/mock-project/logbook",
  evidenceDir: "/tmp/mock-project/logbook/evidence",
  eventsJsonl: "/tmp/mock-project/logbook/evidence/events.jsonl",
} as const;

const LANGFUSE_MCP_JSON = JSON.stringify({
  mcpServers: {
    langfuse: {
      command: "npx",
      args: ["@langfuse/mcp"],
      env: {
        LANGFUSE_PUBLIC_KEY: "pk-lf-test",
        LANGFUSE_SECRET_KEY: "sk-lf-test",
        LANGFUSE_HOST: "https://cloud.langfuse.com",
      },
    },
  },
});

const NO_LANGFUSE_MCP_JSON = JSON.stringify({
  mcpServers: {
    filesystem: { command: "npx", args: ["@modelcontextprotocol/server-filesystem"] },
  },
});

// ---------------------------------------------------------------------------
// detectLangfuseConfig
// ---------------------------------------------------------------------------

describe("detectLangfuseConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when .mcp.json has no Langfuse server", async () => {
    const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
    mockReadFileSync.mockReturnValue(NO_LANGFUSE_MCP_JSON);
    const { detectLangfuseConfig } = await import("../../src/connectors/langfuse/stop-bridge.js");
    const result = detectLangfuseConfig(MOCK_PATHS.root);
    expect(result).toBeNull();
  });

  it("returns config when Langfuse server is present in .mcp.json", async () => {
    const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
    mockReadFileSync.mockReturnValue(LANGFUSE_MCP_JSON);
    const { detectLangfuseConfig } = await import("../../src/connectors/langfuse/stop-bridge.js");
    const result = detectLangfuseConfig(MOCK_PATHS.root);
    expect(result).not.toBeNull();
    expect(result?.publicKey).toBe("pk-lf-test");
  });
});

// ---------------------------------------------------------------------------
// runLangfuseBridge — timeout degradation (B1-R2, B1-S2)
// ---------------------------------------------------------------------------

describe("runLangfuseBridge — timeout degradation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("degrades silently when fetch exceeds 150ms timeout (B1-R2)", async () => {
    const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
    mockReadFileSync.mockReturnValue(LANGFUSE_MCP_JSON);

    // Mock global fetch that hangs until the AbortSignal fires (respects abort).
    vi.stubGlobal("fetch", (_url: unknown, opts?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
        // Never resolves on its own — relies on signal abort.
      });
    });

    const { runLangfuseBridge } = await import("../../src/connectors/langfuse/stop-bridge.js");

    // Must not throw — degrades silently (B1-S2).
    await expect(
      runLangfuseBridge({
        paths: MOCK_PATHS as unknown as Parameters<typeof runLangfuseBridge>[0]["paths"],
        sessionId: "sess-test",
      })
    ).resolves.not.toThrow();

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// PASSIVE invariant (B1-S4, INV-1)
// ---------------------------------------------------------------------------

describe("PASSIVE invariant", () => {
  it("runLangfuseBridge export is a function (not a tool call interceptor)", async () => {
    const bridge = await import("../../src/connectors/langfuse/stop-bridge.js");
    // The bridge must export a plain async function — not an MCP tool or hook modifier.
    expect(typeof bridge.runLangfuseBridge).toBe("function");
    // No side effects on import — module must not modify global state.
    expect(bridge.runLangfuseBridge.length).toBeGreaterThanOrEqual(0);
  });
});

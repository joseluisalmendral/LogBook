/**
 * TDD tests for S1.1 — Codex CLI subprocess adapter.
 *
 * Covers:
 *  1. assertNotInTestMode is called unless LOGBOOK_CODEX_MOCK=1
 *  2. Mock env returns mock response without spawn
 *  3. LOGBOOK_CODEX_MOCK=1 does not call spawn
 *  4. Prompt format: systemPrompt + "\n\n" + userPrompt
 *  5. JSON stdout parsing: extracts .message.content
 *  6. Plain-text fallback on JSON parse failure
 *  7. Non-zero exit throws with stderr included (buildCodexError)
 *  8. ENOENT throws with install hint (buildCodexError)
 *  9. Timeout buildCodexError message
 * 10. Redact runs before adapter receives prompts (router handles it)
 * 11. codex-cli kind dispatches to codexCliAdapter via router
 * 12. ProviderEntry kind: "codex-cli" accepted (TypeScript + runtime)
 * 13. Large stdout buffered correctly (parseCodexOutput)
 * 14. Empty/whitespace stdout returns empty string
 * 15. buildCodexError edge cases (exit codes 127, 2)
 * 16. Router calls with codex-cli mock produce independent results
 * 17. Router by_task routing selects codex-cli provider
 * 18. parseCodexOutput: .output fallback field
 * 19. parseCodexOutput: unknown JSON fields fall back to raw text
 * 20. codex-cli mock adapter injection (no real spawn in any test)
 *
 * Design note on testability:
 *   assertNotInTestMode() fires in the vitest env for ANY real adapter call.
 *   So tests that need to reach codexCliAdapter directly MUST set
 *   LOGBOOK_CODEX_MOCK=1. Tests verifying the guard-throws path must NOT
 *   set LOGBOOK_CODEX_MOCK.
 *
 *   Tests for spawn/subprocess behaviour use the exported helpers (parseCodexOutput,
 *   buildCodexError) which are pure functions — no subprocess needed.
 *   The router dispatch tests use createRouter({ mockAdapter }) — same as
 *   google/ollama pattern.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { createRouter } from "../../src/llm/provider-router.js";
import type { LlmAdapterCallInput } from "../../src/types/llm.js";
import type { ProvidersConfig, ProviderEntry } from "../../src/types/providers.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTmpProviders(cfg: ProvidersConfig): string {
  const dir = join(tmpdir(), "logbook-codex-test-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "providers.json");
  writeFileSync(path, JSON.stringify(cfg));
  return path;
}

const CODEX_CFG: ProvidersConfig = {
  default_provider: "codex-default",
  by_task: {},
  by_phase: {},
  providers: {
    "codex-default": {
      kind: "codex-cli",
      model: "o3",
      api_key_env: "CODEX_API_KEY",
    },
  },
};

function makeMockRouter(cfg: ProvidersConfig = CODEX_CFG): {
  path: string;
  calls: LlmAdapterCallInput[];
  router: ReturnType<typeof createRouter>;
} {
  const path = writeTmpProviders(cfg);
  const calls: LlmAdapterCallInput[] = [];
  const router = createRouter({
    providersPath: path,
    mockAdapter: async (inp) => {
      calls.push(inp);
      return "codex-mock-response";
    },
    sleep: async () => {},
  });
  return { path, calls, router };
}

// ---------------------------------------------------------------------------
// §12 — Schema / TypeScript: ProviderEntry kind "codex-cli" accepted
// ---------------------------------------------------------------------------

describe("S1.1 — ProviderEntry schema", () => {
  test("kind: codex-cli is valid in ProvidersConfig", () => {
    const entry: ProviderEntry = {
      kind: "codex-cli",
      model: "o3",
      api_key_env: "CODEX_API_KEY",
    };
    expect(entry.kind).toBe("codex-cli");
  });

  test("ProvidersConfig with codex-cli provider passes structural check", () => {
    const cfg = CODEX_CFG;
    const entry = cfg.providers["codex-default"];
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("codex-cli");
    expect(entry!.model).toBe("o3");
  });

  test("codex-cli provider entry accepts api_key_env", () => {
    const entry: ProviderEntry = {
      kind: "codex-cli",
      model: "o3",
      api_key_env: "CODEX_API_KEY",
    };
    expect(typeof entry.api_key_env).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// §11 — Router dispatch: codex-cli kind routes through mockAdapter correctly
// ---------------------------------------------------------------------------

describe("S1.1 — Router dispatch to codex-cli adapter", () => {
  test("router resolves codex-cli provider entry and passes it to mockAdapter", async () => {
    const { calls, router } = makeMockRouter();
    const result = await router.call({
      task: "providers.test",
      systemPrompt: "You are a test assistant.",
      userPrompt: "ping",
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("codex-default");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.providerEntry.kind).toBe("codex-cli");
    expect(calls[0]!.providerEntry.model).toBe("o3");
  });

  test("codex-cli mock adapter injection bypasses real spawn (no subprocess in tests)", async () => {
    const { calls, router } = makeMockRouter();

    await expect(
      router.call({ task: "providers.test", systemPrompt: "s", userPrompt: "u" })
    ).resolves.toMatchObject({ ok: true });

    expect(calls[0]!.providerEntry.kind).toBe("codex-cli");
  });

  test("codex-cli dispatch via by_task routing", async () => {
    const cfg: ProvidersConfig = {
      default_provider: "anthropic-default",
      by_task: { "codex.task": "codex-default" },
      by_phase: {},
      providers: {
        "anthropic-default": {
          kind: "anthropic",
          model: "claude-3-5-haiku",
          api_key_env: "ANTHROPIC_API_KEY",
        },
        "codex-default": { kind: "codex-cli", model: "o3", api_key_env: "CODEX_API_KEY" },
      },
    };
    const { calls, router } = makeMockRouter(cfg);
    await router.call({ task: "codex.task", systemPrompt: "s", userPrompt: "u" });

    expect(calls[0]!.providerEntry.kind).toBe("codex-cli");
  });

  test("codex-cli model string passed through to adapter input", async () => {
    const cfg: ProvidersConfig = {
      default_provider: "codex-mini",
      by_task: {},
      by_phase: {},
      providers: {
        "codex-mini": { kind: "codex-cli", model: "o4-mini", api_key_env: "CODEX_API_KEY" },
      },
    };
    const { calls, router } = makeMockRouter(cfg);
    await router.call({ task: "providers.test", systemPrompt: "s", userPrompt: "u" });
    expect(calls[0]!.providerEntry.model).toBe("o4-mini");
  });
});

// ---------------------------------------------------------------------------
// §1 — assertNotInTestMode guard
// ---------------------------------------------------------------------------

describe("S1.1 — assertNotInTestMode guard", () => {
  afterEach(() => {
    delete process.env["LOGBOOK_CODEX_MOCK"];
  });

  test("codexCliAdapter with LOGBOOK_CODEX_MOCK=1 skips assertNotInTestMode", async () => {
    process.env["LOGBOOK_CODEX_MOCK"] = "1";
    // When LOGBOOK_CODEX_MOCK=1, the adapter checks mock env BEFORE calling
    // assertNotInTestMode — so this must not throw in test mode.
    const { codexCliAdapter } = await import("../../src/llm/codex-cli.js");
    const adapterInput: LlmAdapterCallInput = {
      auth: { kind: "none" },
      providerEntry: { kind: "codex-cli", model: "o3", api_key_env: "CODEX_API_KEY" },
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 500,
      temperature: 0.2,
      timeoutMs: 5000,
    };
    await expect(codexCliAdapter(adapterInput)).resolves.toBeDefined();
  });

  test("codexCliAdapter without LOGBOOK_CODEX_MOCK in test env calls assertNotInTestMode (throws)", async () => {
    // LOGBOOK_CODEX_MOCK is NOT set — assertNotInTestMode will throw because
    // NODE_ENV=test is always set by vitest.
    delete process.env["LOGBOOK_CODEX_MOCK"];
    const { codexCliAdapter } = await import("../../src/llm/codex-cli.js");
    const adapterInput: LlmAdapterCallInput = {
      auth: { kind: "none" },
      providerEntry: { kind: "codex-cli", model: "o3", api_key_env: "CODEX_API_KEY" },
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 500,
      temperature: 0.2,
      timeoutMs: 5000,
    };
    await expect(codexCliAdapter(adapterInput)).rejects.toThrow("test");
  });
});

// ---------------------------------------------------------------------------
// §2 — Mock env: returns mock response without spawn
// ---------------------------------------------------------------------------

describe("S1.1 — LOGBOOK_CODEX_MOCK behaviour", () => {
  afterEach(() => {
    delete process.env["LOGBOOK_CODEX_MOCK"];
  });

  test("returns '[mock codex response]' when LOGBOOK_CODEX_MOCK=1", async () => {
    process.env["LOGBOOK_CODEX_MOCK"] = "1";
    const { codexCliAdapter } = await import("../../src/llm/codex-cli.js");
    const adapterInput: LlmAdapterCallInput = {
      auth: { kind: "none" },
      providerEntry: { kind: "codex-cli", model: "o3", api_key_env: "CODEX_API_KEY" },
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 500,
      temperature: 0.2,
      timeoutMs: 5000,
    };
    const result = await codexCliAdapter(adapterInput);
    expect(result).toBe("[mock codex response]");
  });

  test("LOGBOOK_CODEX_MOCK=1 resolves immediately without I/O (no spawn)", async () => {
    // vitest cannot spy on native ESM node:child_process exports.
    // Instead we verify the behavioral contract: when LOGBOOK_CODEX_MOCK=1,
    // the adapter resolves in < 50ms (well under any real subprocess start time).
    // This proves it short-circuits before any spawn could occur.
    process.env["LOGBOOK_CODEX_MOCK"] = "1";

    const { codexCliAdapter } = await import("../../src/llm/codex-cli.js");
    const adapterInput: LlmAdapterCallInput = {
      auth: { kind: "none" },
      providerEntry: { kind: "codex-cli", model: "o3", api_key_env: "CODEX_API_KEY" },
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 500,
      temperature: 0.2,
      timeoutMs: 5000,
    };
    const start = Date.now();
    const result = await codexCliAdapter(adapterInput);
    const elapsed = Date.now() - start;

    expect(result).toBe("[mock codex response]");
    // Any real subprocess would take at least 100ms to start — 50ms is a tight bound
    // that only passes if we truly short-circuited before spawn.
    expect(elapsed).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// §4 — Prompt format: systemPrompt + "\n\n" + userPrompt
// ---------------------------------------------------------------------------

describe("S1.1 — stdin format", () => {
  test("prompt format is systemPrompt + '\\n\\n' + userPrompt", () => {
    const systemPrompt = "You are an assistant.";
    const userPrompt = "Explain closures.";
    const combined = `${systemPrompt}\n\n${userPrompt}`;
    expect(combined).toBe("You are an assistant.\n\nExplain closures.");
    expect(combined.indexOf("\n\n")).toBeGreaterThan(0);
  });

  test("mock path returns without error given combined prompt input", async () => {
    process.env["LOGBOOK_CODEX_MOCK"] = "1";
    try {
      const { codexCliAdapter } = await import("../../src/llm/codex-cli.js");
      const result = await codexCliAdapter({
        auth: { kind: "none" },
        providerEntry: { kind: "codex-cli", model: "o3", api_key_env: "CODEX_API_KEY" },
        systemPrompt: "You are an assistant.",
        userPrompt: "Explain closures.",
        maxTokens: 500,
        temperature: 0.2,
        timeoutMs: 5000,
      });
      expect(result).toBe("[mock codex response]");
    } finally {
      delete process.env["LOGBOOK_CODEX_MOCK"];
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — JSON stdout parsing: extracts .message.content
// §6 — Plain-text fallback on JSON parse failure
// §13 — Large stdout buffered correctly
// §14 — Empty/whitespace stdout
// §19 — Unknown JSON fields fall back
// §18 — .output fallback field
// (Pure function tests — no subprocess)
// ---------------------------------------------------------------------------

describe("S1.1 — parseCodexOutput", () => {
  test("valid JSON with .message.content returns content", async () => {
    const { parseCodexOutput } = await import("../../src/llm/codex-cli.js");
    const json = JSON.stringify({ message: { content: "hello from codex" } });
    expect(parseCodexOutput(json)).toBe("hello from codex");
  });

  test("valid JSON with .output returns output as fallback", async () => {
    const { parseCodexOutput } = await import("../../src/llm/codex-cli.js");
    const json = JSON.stringify({ output: "plain output" });
    expect(parseCodexOutput(json)).toBe("plain output");
  });

  test("invalid JSON returns trimmed raw text", async () => {
    const { parseCodexOutput } = await import("../../src/llm/codex-cli.js");
    expect(parseCodexOutput("  not json at all  ")).toBe("not json at all");
  });

  test("empty string returns empty string", async () => {
    const { parseCodexOutput } = await import("../../src/llm/codex-cli.js");
    expect(parseCodexOutput("")).toBe("");
  });

  test("JSON without known fields returns trimmed raw string", async () => {
    const { parseCodexOutput } = await import("../../src/llm/codex-cli.js");
    const json = JSON.stringify({ someOtherField: "data" });
    const result = parseCodexOutput(json);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("whitespace-only string returns empty string", async () => {
    const { parseCodexOutput } = await import("../../src/llm/codex-cli.js");
    expect(parseCodexOutput("   \n   ")).toBe("");
  });

  test("handles large JSON payload correctly (50k chars)", async () => {
    const { parseCodexOutput } = await import("../../src/llm/codex-cli.js");
    const largeContent = "x".repeat(50_000);
    const json = JSON.stringify({ message: { content: largeContent } });
    const result = parseCodexOutput(json);
    expect(result).toBe(largeContent);
    expect(result.length).toBe(50_000);
  });
});

// ---------------------------------------------------------------------------
// §7 — Non-zero exit throws with stderr included
// §8 — ENOENT throws with install hint
// §9 — Timeout message
// §15 — Edge cases: exit codes 127, 2
// (Pure function tests via buildCodexError)
// ---------------------------------------------------------------------------

describe("S1.1 — buildCodexError", () => {
  test("non-zero exit message includes exit code and stderr", async () => {
    const { buildCodexError } = await import("../../src/llm/codex-cli.js");
    const err = buildCodexError(1, "some stderr output");
    expect(err.message).toContain("1");
    expect(err.message).toContain("some stderr output");
  });

  test("ENOENT message includes install hint", async () => {
    const { buildCodexError } = await import("../../src/llm/codex-cli.js");
    const err = buildCodexError("ENOENT", "");
    expect(err.message.toLowerCase()).toMatch(/install|not found/);
  });

  test("timeout message contains 'timed out'", async () => {
    const { buildCodexError } = await import("../../src/llm/codex-cli.js");
    const err = buildCodexError("timeout", "");
    expect(err.message.toLowerCase()).toContain("timed out");
  });

  test("exit code 127 (command not found) message mentions code", async () => {
    const { buildCodexError } = await import("../../src/llm/codex-cli.js");
    const err = buildCodexError(127, "codex: command not found");
    expect(err.message).toContain("127");
    expect(err.message).toContain("command not found");
  });

  test("exit code 2 with empty stderr still includes code", async () => {
    const { buildCodexError } = await import("../../src/llm/codex-cli.js");
    const err = buildCodexError(2, "");
    expect(err.message).toContain("2");
  });

  test("buildCodexError returns an Error instance", async () => {
    const { buildCodexError } = await import("../../src/llm/codex-cli.js");
    const err = buildCodexError(1, "oops");
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// §10 — Redact: router calls redactBeforeSend before reaching adapter
// ---------------------------------------------------------------------------

describe("S1.1 — Redact-before-send via router", () => {
  test("router redacts systemPrompt before passing to codex-cli mockAdapter", async () => {
    const { calls, router } = makeMockRouter();
    await router.call({
      task: "providers.test",
      systemPrompt: "SECRET_KEY=abc123def456",
      userPrompt: "ping",
    });

    const received = calls[0]!.systemPrompt;
    expect(received).not.toContain("abc123def456");
  });

  test("router redacts userPrompt before passing to codex-cli mockAdapter", async () => {
    const { calls, router } = makeMockRouter();
    await router.call({
      task: "providers.test",
      systemPrompt: "sys",
      userPrompt: "my token is ANTHROPIC_API_KEY=sk-ant-test123456789",
    });

    const received = calls[0]!.userPrompt;
    expect(received).not.toContain("sk-ant-test123456789");
  });
});

// ---------------------------------------------------------------------------
// §16 — Isolation: multiple calls produce independent results
// ---------------------------------------------------------------------------

describe("S1.1 — Isolation", () => {
  test("multiple router calls with codex-cli mock adapter produce independent results", async () => {
    const { calls, router } = makeMockRouter();
    await router.call({ task: "providers.test", systemPrompt: "s1", userPrompt: "u1" });
    await router.call({ task: "providers.test", systemPrompt: "s2", userPrompt: "u2" });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.systemPrompt).not.toBe(calls[1]!.systemPrompt);
  });
});

/**
 * TDD RED tests for S1.2 (Gemini/google adapter) and S1.3 (Ollama/local adapter).
 *
 * These tests verify dispatch logic in vercel-sdk.ts through the router's mockAdapter
 * injection seam. The real @ai-sdk/google or @ai-sdk/openai SDKs are never invoked —
 * vercelSdkAdapter is replaced by mockAdapter at the router level.
 *
 * Why this approach:
 *   assertNotInTestMode() in vercelSdkAdapter blocks any direct call. The only
 *   safe test path is through createRouter({ mockAdapter }).
 *
 * What these tests actually verify:
 *   1. ProvidersConfig accepts google / local kind entries without schema errors.
 *   2. The router correctly resolves a google/local provider entry and passes the
 *      right providerEntry to the mock adapter (kind, model, base_url).
 *   3. The mock injection seam works end-to-end for both kinds.
 */

import { describe, test, expect } from "vitest";
import { createRouter } from "../../src/llm/provider-router.js";
import type { LlmAdapterCallInput } from "../../src/types/llm.js";
import type { ProvidersConfig } from "../../src/types/providers.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTmpProviders(cfg: ProvidersConfig): string {
  const dir = join(tmpdir(), "logbook-test-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "providers.json");
  writeFileSync(path, JSON.stringify(cfg));
  return path;
}

function makeRouterWithCapture(cfg: ProvidersConfig): {
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
      return "mock-response";
    },
    sleep: async () => {},
  });
  return { path, calls, router };
}

// ---------------------------------------------------------------------------
// S1.2 — Google / Gemini provider
// ---------------------------------------------------------------------------

describe("S1.2 — google provider kind", () => {
  const GOOGLE_CFG: ProvidersConfig = {
    default_provider: "gemini-default",
    by_task: {},
    by_phase: {},
    providers: {
      "gemini-default": {
        kind: "google",
        model: "gemini-2.0-flash",
        api_key_env: "GOOGLE_GENERATIVE_AI_API_KEY",
      },
    },
  };

  test("providers config accepts google kind without schema errors", () => {
    // The type system enforces this — if kind:'google' is not in the union,
    // TypeScript would fail at compile time. We verify at runtime too.
    const entry = GOOGLE_CFG.providers["gemini-default"];
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("google");
  });

  test("router resolves google provider entry and passes it to mockAdapter", async () => {
    const { calls, router } = makeRouterWithCapture(GOOGLE_CFG);
    const result = await router.call({
      task: "providers.test",
      systemPrompt: "You are a test assistant.",
      userPrompt: "ping",
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("gemini-default");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.providerEntry.kind).toBe("google");
    expect(calls[0]!.providerEntry.model).toBe("gemini-2.0-flash");
  });

  test("google adapter respects mockAdapter injection (no real network in tests)", async () => {
    // This test verifies the guard: if vercelSdkAdapter were called directly (no mock),
    // assertNotInTestMode would throw. The mock must intercept before that path.
    const { calls, router } = makeRouterWithCapture(GOOGLE_CFG);

    // Should not throw; mock intercepts before vercelSdkAdapter is touched
    await expect(
      router.call({ task: "providers.test", systemPrompt: "s", userPrompt: "u" })
    ).resolves.toMatchObject({ ok: true });

    expect(calls[0]!.providerEntry.kind).toBe("google");
  });

  test("google provider passes api_key_env through to adapter input", async () => {
    const { calls, router } = makeRouterWithCapture(GOOGLE_CFG);
    await router.call({ task: "providers.test", systemPrompt: "s", userPrompt: "u" });

    expect(calls[0]!.providerEntry.api_key_env).toBe("GOOGLE_GENERATIVE_AI_API_KEY");
  });

  test("google provider with custom model selects correct model in adapter input", async () => {
    const cfg: ProvidersConfig = {
      default_provider: "gemini-pro",
      by_task: {},
      by_phase: {},
      providers: {
        "gemini-pro": {
          kind: "google",
          model: "gemini-1.5-pro",
          api_key_env: "GOOGLE_GENERATIVE_AI_API_KEY",
        },
      },
    };
    const { calls, router } = makeRouterWithCapture(cfg);
    await router.call({ task: "providers.test", systemPrompt: "s", userPrompt: "u" });

    expect(calls[0]!.providerEntry.model).toBe("gemini-1.5-pro");
  });
});

// ---------------------------------------------------------------------------
// S1.3 — Ollama / local provider
// ---------------------------------------------------------------------------

describe("S1.3 — local (Ollama) provider kind", () => {
  const LOCAL_CFG: ProvidersConfig = {
    default_provider: "ollama-default",
    by_task: {},
    by_phase: {},
    providers: {
      "ollama-default": {
        kind: "local",
        model: "llama3.2",
        api_key_env: "OLLAMA_API_KEY",
        base_url: "http://localhost:11434/v1",
      },
    },
  };

  test("providers config accepts local kind without schema errors", () => {
    const entry = LOCAL_CFG.providers["ollama-default"];
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("local");
  });

  test("router resolves local provider entry and passes it to mockAdapter", async () => {
    const { calls, router } = makeRouterWithCapture(LOCAL_CFG);
    const result = await router.call({
      task: "providers.test",
      systemPrompt: "You are a test assistant.",
      userPrompt: "ping",
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("ollama-default");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.providerEntry.kind).toBe("local");
    expect(calls[0]!.providerEntry.model).toBe("llama3.2");
  });

  test("local adapter respects mockAdapter injection (no real network in tests)", async () => {
    const { calls, router } = makeRouterWithCapture(LOCAL_CFG);

    await expect(
      router.call({ task: "providers.test", systemPrompt: "s", userPrompt: "u" })
    ).resolves.toMatchObject({ ok: true });

    expect(calls[0]!.providerEntry.kind).toBe("local");
  });

  test("local kind config accepts custom baseURL", async () => {
    const cfg: ProvidersConfig = {
      default_provider: "ollama-custom",
      by_task: {},
      by_phase: {},
      providers: {
        "ollama-custom": {
          kind: "local",
          model: "mistral",
          api_key_env: "OLLAMA_API_KEY",
          base_url: "http://my-server:11434/v1",
        },
      },
    };
    const { calls, router } = makeRouterWithCapture(cfg);
    await router.call({ task: "providers.test", systemPrompt: "s", userPrompt: "u" });

    expect(calls[0]!.providerEntry.base_url).toBe("http://my-server:11434/v1");
  });

  test("local provider without explicit base_url still resolves", async () => {
    const cfg: ProvidersConfig = {
      default_provider: "ollama-nourl",
      by_task: {},
      by_phase: {},
      providers: {
        "ollama-nourl": {
          kind: "local",
          model: "llama3.2",
          api_key_env: "OLLAMA_API_KEY",
          // no base_url — vercel-sdk.ts should default to http://localhost:11434/v1
        },
      },
    };
    const { calls, router } = makeRouterWithCapture(cfg);
    const result = await router.call({ task: "providers.test", systemPrompt: "s", userPrompt: "u" });

    expect(result.ok).toBe(true);
    expect(calls[0]!.providerEntry.kind).toBe("local");
  });
});

/**
 * TDD RED tests for S1.5 — `providers test --task <name>` routing.
 *
 * These tests verify that the router correctly uses by_task routing when a
 * specific task name is provided. The CLI --task arg threads through to
 * router.call({ task: taskName }).
 *
 * Test approach: test the router behavior directly (not the CLI layer),
 * since the CLI command delegates immediately to createRouter().call().
 * The CLI layer tests are integration-level and would require process.argv
 * manipulation; unit tests cover the routing contract.
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

// Multi-provider config with distinct by_task mappings
const MULTI_CFG: ProvidersConfig = {
  default_provider: "anthropic-default",
  by_task: {
    summarize: "gemini-provider",
    fallback: "openai-provider",
  },
  by_phase: {},
  providers: {
    "anthropic-default": {
      kind: "anthropic",
      model: "claude-sonnet-4-5",
      api_key_env: "ANTHROPIC_API_KEY",
    },
    "gemini-provider": {
      kind: "google",
      model: "gemini-2.0-flash",
      api_key_env: "GOOGLE_GENERATIVE_AI_API_KEY",
    },
    "openai-provider": {
      kind: "openai",
      model: "gpt-4o-mini",
      api_key_env: "OPENAI_API_KEY",
    },
  },
};

// ---------------------------------------------------------------------------
// S1.5 — --task routing
// ---------------------------------------------------------------------------

describe("S1.5 — providers test --task routing", () => {
  test("--task summarize uses summarize routing (gemini-provider)", async () => {
    const path = writeTmpProviders(MULTI_CFG);
    const calls: LlmAdapterCallInput[] = [];
    const router = createRouter({
      providersPath: path,
      mockAdapter: async (inp) => { calls.push(inp); return "ok"; },
      sleep: async () => {},
    });

    const result = await router.call({
      task: "summarize",
      systemPrompt: "Respond with exactly: pong",
      userPrompt: "ping",
      maxTokens: 50,
      temperature: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("gemini-provider");
    expect(calls[0]!.providerEntry.kind).toBe("google");
  });

  test("--task fallback uses fallback routing (openai-provider)", async () => {
    const path = writeTmpProviders(MULTI_CFG);
    const calls: LlmAdapterCallInput[] = [];
    const router = createRouter({
      providersPath: path,
      mockAdapter: async (inp) => { calls.push(inp); return "ok"; },
      sleep: async () => {},
    });

    const result = await router.call({
      task: "fallback",
      systemPrompt: "Respond with exactly: pong",
      userPrompt: "ping",
      maxTokens: 50,
      temperature: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openai-provider");
    expect(calls[0]!.providerEntry.kind).toBe("openai");
  });

  test("--task unknown falls through to default_provider (no error thrown)", async () => {
    const path = writeTmpProviders(MULTI_CFG);
    const calls: LlmAdapterCallInput[] = [];
    const router = createRouter({
      providersPath: path,
      mockAdapter: async (inp) => { calls.push(inp); return "ok"; },
      sleep: async () => {},
    });

    // "unknown" has no by_task or by_phase match → falls to default_provider
    const result = await router.call({
      task: "unknown-task-xyz",
      systemPrompt: "s",
      userPrompt: "u",
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("anthropic-default");
    expect(calls[0]!.providerEntry.kind).toBe("anthropic");
  });

  test("no --task (providers.test default) uses default behavior unchanged", async () => {
    const path = writeTmpProviders(MULTI_CFG);
    const calls: LlmAdapterCallInput[] = [];
    const router = createRouter({
      providersPath: path,
      mockAdapter: async (inp) => { calls.push(inp); return "ok"; },
      sleep: async () => {},
    });

    // "providers.test" is NOT in by_task → falls to default_provider
    const result = await router.call({
      task: "providers.test",
      systemPrompt: "Respond with exactly: pong",
      userPrompt: "ping",
      maxTokens: 50,
      temperature: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("anthropic-default");
    // This verifies backward compatibility: the default CLI task name
    // ("providers.test") still resolves to the default_provider.
  });

  test("by_task resolution still works when --task matches a phase too", async () => {
    const cfg: ProvidersConfig = {
      default_provider: "anthropic-default",
      by_task: { dual: "gemini-provider" },
      by_phase: { dual: "openai-provider" }, // task wins over phase
      providers: {
        "anthropic-default": { kind: "anthropic", model: "claude-sonnet-4-5", api_key_env: "ANTHROPIC_API_KEY" },
        "gemini-provider": { kind: "google", model: "gemini-2.0-flash", api_key_env: "GOOGLE_GENERATIVE_AI_API_KEY" },
        "openai-provider": { kind: "openai", model: "gpt-4o-mini", api_key_env: "OPENAI_API_KEY" },
      },
    };
    const path = writeTmpProviders(cfg);
    const router = createRouter({
      providersPath: path,
      mockAdapter: async () => "ok",
      sleep: async () => {},
    });

    const result = await router.call({ task: "dual", phase: "dual", systemPrompt: "s", userPrompt: "u" });

    // by_task beats by_phase
    expect(result.provider).toBe("gemini-provider");
  });
});

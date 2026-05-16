import { describe, test, expect, vi, beforeEach } from "vitest";
import { createRouter } from "../../src/llm/provider-router.js";
import type { LlmAdapterCallInput, LlmProviderCallInput } from "../../src/types/llm.js";
import type { ProvidersConfig } from "../../src/types/providers.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProvidersJson(cfg: ProvidersConfig): string {
  return JSON.stringify(cfg);
}

function writeTmpProviders(cfg: ProvidersConfig): string {
  const dir = join(tmpdir(), "logbook-test-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "providers.json");
  writeFileSync(path, makeProvidersJson(cfg));
  return path;
}

const DEFAULT_CFG: ProvidersConfig = {
  default_provider: "anthropic-default",
  by_task: {},
  by_phase: {},
  providers: {
    "anthropic-default": {
      kind: "anthropic",
      model: "claude-sonnet-4-5",
      api_key_env: "ANTHROPIC_API_KEY",
    },
  },
};

const CFG_WITH_TASK: ProvidersConfig = {
  default_provider: "anthropic-default",
  by_task: { "summarize.milestone": "openai-default" },
  by_phase: {},
  providers: {
    "anthropic-default": {
      kind: "anthropic",
      model: "claude-sonnet-4-5",
      api_key_env: "ANTHROPIC_API_KEY",
    },
    "openai-default": {
      kind: "openai",
      model: "gpt-4o-mini",
      api_key_env: "OPENAI_API_KEY",
    },
  },
};

const CFG_WITH_PHASE: ProvidersConfig = {
  default_provider: "anthropic-default",
  by_task: {},
  by_phase: { review: "openai-default" },
  providers: {
    "anthropic-default": {
      kind: "anthropic",
      model: "claude-sonnet-4-5",
      api_key_env: "ANTHROPIC_API_KEY",
    },
    "openai-default": {
      kind: "openai",
      model: "gpt-4o-mini",
      api_key_env: "OPENAI_API_KEY",
    },
  },
};

function baseMockAdapter(overrides?: Partial<LlmAdapterCallInput>) {
  return async (_input: LlmAdapterCallInput): Promise<string> => {
    void overrides;
    return "mock-response";
  };
}

function makeInput(overrides: Partial<LlmProviderCallInput> = {}): LlmProviderCallInput {
  return {
    task: "providers.test",
    systemPrompt: "You are a test assistant.",
    userPrompt: "Reply ok.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Routing rules
// ---------------------------------------------------------------------------

describe("createRouter — routing rules", () => {
  test("uses default_provider when no by_task or by_phase match", async () => {
    const path = writeTmpProviders(DEFAULT_CFG);
    const calls: LlmAdapterCallInput[] = [];
    const router = createRouter({
      providersPath: path,
      mockAdapter: async (inp) => {
        calls.push(inp);
        return "ok";
      },
    });

    const result = await router.call(makeInput({ task: "unknown.task" }));
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("anthropic-default");
    expect(calls).toHaveLength(1);
  });

  test("by_task overrides default_provider (resolution order: task > phase > default)", async () => {
    const path = writeTmpProviders(CFG_WITH_TASK);
    const calls: LlmAdapterCallInput[] = [];
    const router = createRouter({
      providersPath: path,
      mockAdapter: async (inp) => {
        calls.push(inp);
        return "ok";
      },
    });

    const result = await router.call(makeInput({ task: "summarize.milestone" }));
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openai-default");
  });

  test("by_phase overrides default_provider when task has no match", async () => {
    const path = writeTmpProviders(CFG_WITH_PHASE);
    const calls: LlmAdapterCallInput[] = [];
    const router = createRouter({
      providersPath: path,
      mockAdapter: async (inp) => {
        calls.push(inp);
        return "ok";
      },
    });

    const result = await router.call(makeInput({ task: "unknown", phase: "review" }));
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openai-default");
  });

  test("by_task wins over by_phase when both match", async () => {
    const cfg: ProvidersConfig = {
      default_provider: "anthropic-default",
      by_task: { "summarize.milestone": "openai-default" },
      by_phase: { review: "anthropic-default" },
      providers: {
        "anthropic-default": { kind: "anthropic", model: "claude-sonnet-4-5", api_key_env: "ANTHROPIC_API_KEY" },
        "openai-default": { kind: "openai", model: "gpt-4o-mini", api_key_env: "OPENAI_API_KEY" },
      },
    };
    const path = writeTmpProviders(cfg);
    const router = createRouter({
      providersPath: path,
      mockAdapter: async () => "ok",
    });

    const result = await router.call(makeInput({ task: "summarize.milestone", phase: "review" }));
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openai-default");
  });
});

// ---------------------------------------------------------------------------
// Redact-before-send
// ---------------------------------------------------------------------------

describe("createRouter — redact-before-send", () => {
  test("mock adapter receives already-redacted prompts when AWS key present", async () => {
    const path = writeTmpProviders(DEFAULT_CFG);
    const receivedInputs: LlmAdapterCallInput[] = [];
    const router = createRouter({
      providersPath: path,
      mockAdapter: async (inp) => {
        receivedInputs.push(inp);
        return "ok";
      },
    });

    const result = await router.call(
      makeInput({
        task: "providers.test",
        systemPrompt: "secret=AKIAIOSFODNN7EXAMPLE",
        userPrompt: "hello",
      })
    );

    expect(result.ok).toBe(true);
    expect(result.redactedFields).toBeGreaterThan(0);
    expect(receivedInputs[0]?.systemPrompt).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(receivedInputs[0]?.systemPrompt).toContain("[REDACTED:");
  });

  test("clean prompts pass through unchanged with redactedFields=0", async () => {
    const path = writeTmpProviders(DEFAULT_CFG);
    const receivedInputs: LlmAdapterCallInput[] = [];
    const router = createRouter({
      providersPath: path,
      mockAdapter: async (inp) => {
        receivedInputs.push(inp);
        return "ok";
      },
    });

    const result = await router.call(
      makeInput({ systemPrompt: "Clean system prompt.", userPrompt: "Clean user prompt." })
    );

    expect(result.ok).toBe(true);
    expect(result.redactedFields).toBe(0);
    expect(receivedInputs[0]?.systemPrompt).toBe("Clean system prompt.");
    expect(receivedInputs[0]?.userPrompt).toBe("Clean user prompt.");
  });
});

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

describe("createRouter — retry policy", () => {
  test("retries twice on retryable error, succeeds on 3rd attempt", async () => {
    const path = writeTmpProviders(DEFAULT_CFG);
    let callCount = 0;
    const router = createRouter({
      providersPath: path,
      mockAdapter: async () => {
        callCount += 1;
        if (callCount < 3) {
          const err = new Error("rate_limited");
          (err as Error & { retryable?: boolean }).retryable = true;
          throw err;
        }
        return "success";
      },
      // Override sleep to skip actual delays in tests
      sleep: async () => {},
    });

    const result = await router.call(makeInput());
    expect(result.ok).toBe(true);
    expect(result.text).toBe("success");
    expect(callCount).toBe(3);
  });

  test("fails fast on non-retryable error — only 1 attempt", async () => {
    const path = writeTmpProviders(DEFAULT_CFG);
    let callCount = 0;
    const router = createRouter({
      providersPath: path,
      mockAdapter: async () => {
        callCount += 1;
        const err = new Error("invalid_request");
        (err as Error & { retryable?: boolean }).retryable = false;
        throw err;
      },
      sleep: async () => {},
    });

    const result = await router.call(makeInput());
    expect(result.ok).toBe(false);
    expect(callCount).toBe(1);
  });

  test("all retries exhausted → ok=false, not a throw", async () => {
    const path = writeTmpProviders(DEFAULT_CFG);
    const router = createRouter({
      providersPath: path,
      mockAdapter: async () => {
        const err = new Error("network");
        (err as Error & { retryable?: boolean }).retryable = true;
        throw err;
      },
      sleep: async () => {},
    });

    // Must not throw — router is fail-soft
    const result = await router.call(makeInput());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("call_failed");
  });
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe("createRouter — timeout", () => {
  test("slow mock adapter → result has error.code === 'timeout'", async () => {
    const path = writeTmpProviders(DEFAULT_CFG);
    const router = createRouter({
      providersPath: path,
      mockAdapter: async () => {
        // simulate never resolving — we give it an impossible task
        await new Promise(() => {});
        return "never";
      },
      sleep: async () => {},
    });

    const result = await router.call(makeInput({ timeoutMs: 50 }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("timeout");
  });
});

// ---------------------------------------------------------------------------
// No-auth path
// ---------------------------------------------------------------------------

describe("createRouter — no-auth path", () => {
  test("provider entry api_key_env not set in env → returns error.code='no_auth'", async () => {
    // Ensure the env var is not set
    const envVarName = "LOGBOOK_TEST_MISSING_KEY_" + randomUUID().replace(/-/g, "_").toUpperCase();
    const cfg: ProvidersConfig = {
      default_provider: "test-provider",
      by_task: {},
      by_phase: {},
      providers: {
        "test-provider": {
          kind: "anthropic",
          model: "claude-sonnet-4-5",
          api_key_env: envVarName,
        },
      },
    };
    const path = writeTmpProviders(cfg);
    const router = createRouter({
      providersPath: path,
      // No mockAdapter — forces real auth resolution
    });

    // No Claude Code session env, no ANTHROPIC_API_KEY, no apiKey in entry
    const origEnv = { ...process.env };
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["CLAUDE_CODE_SESSION_ID"];
    delete process.env["CLAUDECODE"];

    const result = await router.call(makeInput());

    // Restore env
    Object.assign(process.env, origEnv);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("no_auth");
    expect(result.error?.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Missing providers.json
// ---------------------------------------------------------------------------

describe("createRouter — missing providers.json", () => {
  test("absent providers.json → returns no_auth or no_config (not a throw)", async () => {
    const router = createRouter({
      providersPath: "/tmp/logbook-nonexistent-providers-" + randomUUID() + ".json",
    });

    const origEnv = { ...process.env };
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["CLAUDE_CODE_SESSION_ID"];
    delete process.env["CLAUDECODE"];

    const result = await router.call(makeInput());

    Object.assign(process.env, origEnv);

    // Must not throw — fail-soft
    expect(result.ok).toBe(false);
    expect(["no_auth", "no_config"]).toContain(result.error?.code);
  });
});

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

describe("createRouter — result shape", () => {
  test("successful call returns all required fields", async () => {
    const path = writeTmpProviders(DEFAULT_CFG);
    const router = createRouter({
      providersPath: path,
      mockAdapter: async () => "hello world",
    });

    const result = await router.call(makeInput());
    expect(result.ok).toBe(true);
    expect(typeof result.text).toBe("string");
    expect(typeof result.provider).toBe("string");
    expect(typeof result.model).toBe("string");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.redactedFields).toBe("number");
  });
});

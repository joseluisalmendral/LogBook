/**
 * LLM Provider Router — injectable, fail-soft, retry-aware.
 *
 * Design §4: tasks > phases > default cascade; redact-before-send;
 * 3 retries with 1s/2s/4s backoff; 30s per-attempt timeout; no throws past router.
 *
 * Key injectability seams (for tests):
 *   mockAdapter — replaces ALL real SDK adapter calls
 *   sleep       — replaces real delay; set to () => {} in tests
 *
 * Auth resolution order (design §4.3):
 *   1. Claude Code session marker env  → claude-sdk.ts adapter
 *   2. ANTHROPIC_API_KEY env          → vercel-sdk.ts (Anthropic)
 *   3. OPENAI_API_KEY env             → vercel-sdk.ts (OpenAI), only for openai kind
 *   4. providers.json inline api_key  → vercel-sdk.ts (warn: not recommended)
 *   5. none                           → { ok:false, error:{code:"no_auth"} }
 */

import { readFileSync, existsSync } from "node:fs";
import { redactBeforeSend } from "./redact-before-send.js";
import type {
  LlmProviderRouter,
  LlmProviderCallInput,
  LlmProviderCallResult,
  LlmAdapterCallInput,
  LlmAuthResolution,
  LlmErrorCode,
} from "../types/llm.js";
import type { ProvidersConfig, ProviderEntry } from "../types/providers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateRouterOpts {
  /** Absolute path to .logbook/providers.json */
  providersPath: string;
  /**
   * Injected mock adapter — when provided, ALL real SDK adapter calls are replaced.
   * The mock may throw errors (with optional `.retryable: boolean` property) or
   * resolve to a string. Used exclusively in tests.
   */
  mockAdapter?: (input: LlmAdapterCallInput) => Promise<string>;
  /**
   * Injectable sleep — replaces real delay in retry backoff.
   * Set to `async () => {}` in tests to skip actual waits.
   */
  sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 1500;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/** Claude Code session marker env vars (either presence indicates SDK auth). */
const CLAUDE_SESSION_ENV_VARS = ["CLAUDE_CODE_SESSION_ID", "CLAUDECODE"] as const;

/** Safe fallback config used when providers.json is missing. */
const FALLBACK_PROVIDERS_CONFIG: ProvidersConfig = {
  default_provider: "anthropic-claude-sdk",
  by_task: {},
  by_phase: {},
  providers: {
    "anthropic-claude-sdk": {
      kind: "anthropic",
      model: "claude-sonnet-4-5",
      api_key_env: "ANTHROPIC_API_KEY",
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadProvidersConfig(filePath: string): ProvidersConfig | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ProvidersConfig;
  } catch {
    return null;
  }
}

function resolveProviderKey(
  cfg: ProvidersConfig,
  task: string,
  phase?: string
): string {
  return (
    cfg.by_task[task] ??
    (phase !== undefined && phase !== "" ? cfg.by_phase[phase] : undefined) ??
    cfg.default_provider
  );
}

function resolveAuth(providerEntry: ProviderEntry): LlmAuthResolution {
  // 1. Claude Code session present → use claude-agent-sdk (no API key)
  for (const envVar of CLAUDE_SESSION_ENV_VARS) {
    const val = process.env[envVar];
    if (val !== undefined && val !== "") {
      return { kind: "claude-agent-sdk", sessionMarker: envVar };
    }
  }

  // 2. ANTHROPIC_API_KEY → vercel-sdk with Anthropic
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  if (anthropicKey !== undefined && anthropicKey !== "") {
    return { kind: "api-key", envVar: "ANTHROPIC_API_KEY", value: anthropicKey };
  }

  // 3a. OPENAI_API_KEY → vercel-sdk with OpenAI (only for openai/azure kind providers)
  if (providerEntry.kind === "openai" || providerEntry.kind === "azure") {
    const openaiKey = process.env["OPENAI_API_KEY"];
    if (openaiKey !== undefined && openaiKey !== "") {
      return { kind: "api-key", envVar: "OPENAI_API_KEY", value: openaiKey };
    }
  }

  // 3b. GOOGLE_GENERATIVE_AI_API_KEY → vercel-sdk with Google (only for google kind)
  if (providerEntry.kind === "google") {
    const googleKey = process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
    if (googleKey !== undefined && googleKey !== "") {
      return { kind: "api-key", envVar: "GOOGLE_GENERATIVE_AI_API_KEY", value: googleKey };
    }
  }

  // 3c. local kind (Ollama) — no real API key required; use placeholder if no env var
  if (providerEntry.kind === "local") {
    // Ollama runs locally — auth.value is passed as a placeholder to @ai-sdk/openai
    // but is not sent over the network. We still resolve through api_key_env so the
    // user can override if a remote Ollama instance requires a key.
    const localKey = providerEntry.api_key_env ? process.env[providerEntry.api_key_env] : undefined;
    const resolvedKey = localKey ?? "ollama";
    return { kind: "api-key", envVar: providerEntry.api_key_env ?? "OLLAMA_API_KEY", value: resolvedKey };
  }

  // 4. Inline key from providers.json (api_key_env points to env var)
  if (providerEntry.api_key_env) {
    const inlineKey = process.env[providerEntry.api_key_env];
    if (inlineKey !== undefined && inlineKey !== "") {
      return { kind: "api-key", envVar: providerEntry.api_key_env, value: inlineKey };
    }
  }

  // 5. No auth found
  return { kind: "none" };
}

/**
 * Returns true for errors that should trigger a retry:
 * rate-limit (429), server errors (5xx), network/timeout errors.
 * Returns false for client errors (4xx validation, auth) — fail fast.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const retryableProp = (err as Error & { retryable?: unknown }).retryable;
    if (retryableProp !== undefined) {
      return Boolean(retryableProp);
    }
    const msg = err.message.toLowerCase();
    return (
      msg.includes("rate") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504")
    );
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`LLM call timed out after ${ms}ms`);
      (err as Error & { retryable?: boolean; code?: string }).code = "timeout";
      (err as Error & { retryable?: boolean; code?: string }).retryable = false;
      reject(err);
    }, ms);

    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function makeErrorResult(
  code: LlmErrorCode,
  message: string,
  retryable: boolean,
  provider: string,
  model: string,
  latencyMs: number
): LlmProviderCallResult {
  return {
    ok: false,
    error: { code, message, retryable },
    provider,
    model,
    latencyMs,
    redactedFields: 0,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRouter(opts: CreateRouterOpts): LlmProviderRouter {
  const sleep = opts.sleep ?? defaultSleep;

  return {
    async call(input: LlmProviderCallInput): Promise<LlmProviderCallResult> {
      const startMs = Date.now();

      // ------ 1. Load config -----------------------------------------------
      const cfg = loadProvidersConfig(opts.providersPath) ?? FALLBACK_PROVIDERS_CONFIG;

      // ------ 2. Resolve provider key --------------------------------------
      const providerKey = resolveProviderKey(cfg, input.task, input.phase);
      const providerEntry: ProviderEntry | undefined = cfg.providers[providerKey];

      if (providerEntry === undefined) {
        return makeErrorResult(
          "no_config",
          `Provider key '${providerKey}' not found in providers config`,
          false,
          providerKey,
          "unknown",
          Date.now() - startMs
        );
      }

      // ------ 3. Resolve auth ----------------------------------------------
      const auth = resolveAuth(providerEntry);

      if (auth.kind === "none" && opts.mockAdapter === undefined) {
        return makeErrorResult(
          "no_auth",
          "No authentication available: set ANTHROPIC_API_KEY, OPENAI_API_KEY, or run inside Claude Code",
          false,
          providerKey,
          providerEntry.model,
          Date.now() - startMs
        );
      }

      // ------ 4. Redact-before-send ----------------------------------------
      const { redactedSystem, redactedUser, count: redactedFields } = redactBeforeSend({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
      });

      // ------ 5. Build adapter input ----------------------------------------
      const timeoutMs =
        input.timeoutMs ?? Number(process.env["LOGBOOK_LLM_TIMEOUT_MS"] ?? DEFAULT_TIMEOUT_MS);

      const adapterInput: LlmAdapterCallInput = {
        auth,
        providerEntry,
        systemPrompt: redactedSystem,
        userPrompt: redactedUser,
        maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: input.temperature ?? DEFAULT_TEMPERATURE,
        timeoutMs,
      };

      // ------ 6. Retry loop (3 attempts) ------------------------------------
      let lastError: unknown;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const callFn = opts.mockAdapter
            ? () => opts.mockAdapter!(adapterInput)
            : () => selectAdapter(auth)(adapterInput);

          const text = await withTimeout(callFn(), timeoutMs);

          return {
            ok: true,
            text,
            provider: providerKey,
            model: providerEntry.model,
            latencyMs: Date.now() - startMs,
            redactedFields,
          };
        } catch (err) {
          lastError = err;

          // Check for timeout error code
          const asErr = err as Error & { code?: string };
          if (asErr?.code === "timeout") {
            return makeErrorResult(
              "timeout",
              asErr.message,
              false,
              providerKey,
              providerEntry.model,
              Date.now() - startMs
            );
          }

          if (!isRetryable(err)) {
            break;
          }

          if (attempt < 2) {
            const delay = RETRY_DELAYS_MS[attempt] ?? 1_000;
            await sleep(delay);
          }
        }
      }

      // ------ 7. Final failure (fail-soft — no throw) ----------------------
      return makeErrorResult(
        "call_failed",
        lastError instanceof Error ? lastError.message : String(lastError),
        true,
        providerKey,
        providerEntry.model,
        Date.now() - startMs
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter selector
// ---------------------------------------------------------------------------

/**
 * Selects the appropriate real SDK adapter based on auth resolution.
 * Note: this is NOT called when opts.mockAdapter is provided.
 */
function selectAdapter(
  auth: LlmAuthResolution
): (input: LlmAdapterCallInput) => Promise<string> {
  if (auth.kind === "claude-agent-sdk") {
    return async (input: LlmAdapterCallInput) => {
      const { claudeSdkAdapter } = await import("./claude-sdk.js");
      return claudeSdkAdapter(input);
    };
  }
  // api-key → vercel-sdk
  return async (input: LlmAdapterCallInput) => {
    const { vercelSdkAdapter } = await import("./vercel-sdk.js");
    return vercelSdkAdapter(input);
  };
}

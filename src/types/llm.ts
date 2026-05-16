import type { ProviderEntry } from "./providers.js";

export interface LlmProviderCallInput {
  task: string;              // e.g. "summarize.milestone", "teaching-script", "providers.test"
  phase?: string;            // optional context for routing
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;        // default 1500
  temperature?: number;      // default 0.2
  timeoutMs?: number;        // default 30000; env override LOGBOOK_LLM_TIMEOUT_MS
}

export interface LlmProviderCallError {
  code: LlmErrorCode;
  message: string;
  retryable: boolean;
}

export interface LlmProviderCallResult {
  ok: boolean;
  text?: string;                // populated when ok === true
  error?: LlmProviderCallError;
  provider: string;             // resolved provider id (e.g. "anthropic-claude-sonnet")
  model: string;                // resolved model identifier
  latencyMs: number;
  redactedFields: number;       // count of fields redacted before send (audit metric)
}

export type LlmErrorCode =
  | "no_auth"          // neither claude-agent-sdk nor API key available
  | "no_config"        // providers.json missing AND no default resolvable
  | "timeout"
  | "rate_limited"
  | "network"
  | "invalid_response"
  | "call_failed";

export interface LlmProviderRouter {
  call(input: LlmProviderCallInput): Promise<LlmProviderCallResult>;
}

// Internal dep injection seam — allows tests to skip ALL adapter loading.
export interface InternalCallParams {
  providerEntry: ProviderEntry;
  auth: LlmAuthResolution;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

export interface LlmProviderRouterDeps {
  resolveClient?: (providerKey: string) => unknown;       // injectable for tests
  callLLM?: (params: InternalCallParams) => Promise<string>; // injectable mock
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

// Adapter contract (what each adapter exports for the router to call).
export interface LlmAdapterCallInput {
  auth: LlmAuthResolution;
  providerEntry: ProviderEntry;
  systemPrompt: string;         // already redacted by router
  userPrompt: string;           // already redacted by router
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

export type LlmAuthResolution =
  | { kind: "claude-agent-sdk"; sessionMarker: string }
  | { kind: "api-key"; envVar: string; value: string }
  | { kind: "none" };

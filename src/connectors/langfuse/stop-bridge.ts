/**
 * Langfuse Stop-hook bridge (B1).
 *
 * PASSIVE RULE (INV-1, B1-S4):
 *   This module runs ONLY from the Stop hook, NEVER during live tool calls.
 *   It queries Langfuse AFTER the Claude session completes and writes events
 *   to JSONL. It does NOT modify any runtime AI behavior.
 *
 * Behaviour:
 *   1. Check if a Langfuse MCP server entry exists in .mcp.json (B1-R5).
 *      If not present, exit immediately with no-op.
 *   2. Query Langfuse for traces in the session time window using a hard
 *      150ms timeout (B1-R2, INV-3).
 *   3. On timeout or error, write a degradation note to state.json and return.
 *   4. For each trace, validate with LangfuseTracePayloadSchema (INV-7) and
 *      persist via appendEvent (redaction automatic — INV-8).
 *
 * The Langfuse MCP "langfuse_list_traces" tool signature is called via stdin/
 * stdout MCP protocol if we can identify the server. However, given that the
 * MCP runtime is managed by Claude Code (not logbook), we cannot call the
 * Langfuse MCP tool from within the Stop hook.
 *
 * Alternative implementation: read trace data from a known Langfuse REST API
 * endpoint using the configured API keys from .mcp.json env block. This is
 * the practical approach that satisfies the spec without requiring the MCP
 * SDK to be running at Stop hook time.
 *
 * API shape (from Langfuse v2 REST):
 *   GET /api/public/traces?sessionId=<sid>&limit=50 → { data: Trace[] }
 *
 * Keys from .mcp.json langfuse server env:
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST (optional)
 */

import * as fs from "node:fs";
import { appendEvent } from "../../store/index.js";
import { readState, writeState } from "../../core/state.js";
import { LangfuseTracePayloadSchema } from "../../events/schemas.js";
import * as v from "valibot";
import type { ProjectPaths } from "../../core/paths.js";

// ---------------------------------------------------------------------------
// MCP config detection
// ---------------------------------------------------------------------------

interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

/** Langfuse connection config extracted from .mcp.json. */
export interface LangfuseDetectedConfig {
  publicKey: string;
  secretKey: string;
  host: string;
  env: Record<string, string>;
}

/**
 * Read .mcp.json from projectRoot and check if a Langfuse server is registered.
 *
 * Langfuse detection heuristic: server name contains "langfuse" (case-insensitive),
 * or env block contains LANGFUSE_PUBLIC_KEY.
 *
 * Returns a structured config with extracted keys, or null if Langfuse is not configured.
 * Never throws — returns null on any I/O or parse failure.
 * Exported for unit testing (B1-S1).
 */
export function detectLangfuseConfig(root: string): LangfuseDetectedConfig | null {
  const mcpPath = `${root}/.mcp.json`;
  try {
    const raw = fs.readFileSync(mcpPath, "utf8");
    const config = JSON.parse(raw) as McpConfig;
    const servers = config.mcpServers ?? {};

    for (const [name, server] of Object.entries(servers)) {
      const envBlock = server.env ?? {};
      const isLangfuse =
        name.toLowerCase().includes("langfuse") ||
        typeof envBlock["LANGFUSE_PUBLIC_KEY"] === "string";

      if (isLangfuse) {
        const publicKey = envBlock["LANGFUSE_PUBLIC_KEY"] ?? "";
        const secretKey = envBlock["LANGFUSE_SECRET_KEY"] ?? "";
        const host = envBlock["LANGFUSE_HOST"] ?? "https://cloud.langfuse.com";
        return { publicKey, secretKey, host, env: envBlock };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Langfuse REST query
// ---------------------------------------------------------------------------

interface LangfuseTrace {
  id: string;
  sessionId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  /** Usage object from Langfuse trace response. */
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    unit?: string;
    inputCost?: number;
    outputCost?: number;
    totalCost?: number;
  };
  /** Model name, if available. */
  model?: string;
}

interface LangfuseTracesResponse {
  data: LangfuseTrace[];
  meta?: { page: number; limit: number; totalItems: number; totalPages: number };
}

/**
 * Query Langfuse REST API for traces in a session time window.
 *
 * @param sessionId   Logbook sessionId to correlate with Langfuse sessions.
 * @param fromTs      ISO8601 start of window (session start timestamp).
 * @param toTs        ISO8601 end of window (stop hook timestamp).
 * @param env         Langfuse env block from .mcp.json.
 * @param timeoutMs   Hard timeout in ms (default 150ms per B1-R2).
 *
 * Returns an array of traces or null on timeout/error.
 * Never throws.
 */
async function fetchLangfuseTraces(
  sessionId: string,
  fromTs: string,
  toTs: string,
  config: LangfuseDetectedConfig,
  timeoutMs: number = 150,
): Promise<LangfuseTrace[] | null> {
  const { publicKey, secretKey, host } = config;

  if (!publicKey || !secretKey) {
    return null;
  }

  const url = new URL("/api/public/traces", host);
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("fromTimestamp", fromTs);
  url.searchParams.set("toTimestamp", toTs);
  url.searchParams.set("limit", "50");

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as LangfuseTracesResponse;
    return data.data ?? [];
  } catch {
    // Timeout or network error — degrade silently.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LangfuseBridgeOptions {
  paths: ProjectPaths;
  sessionId: string;
  /** Session start timestamp (ISO8601). Falls back to 1 hour before stop time. */
  sessionStartTs?: string;
  /** Stop hook timestamp (ISO8601). Defaults to now. */
  stopTs?: string;
}

export interface LangfuseBridgeResult {
  /** Number of langfuse_trace events written. */
  written: number;
  /** True if query was skipped (Langfuse not configured). */
  skipped: boolean;
  /** True if query timed out or errored. */
  degraded: boolean;
}

/**
 * Run the Langfuse bridge at Stop hook time.
 *
 * PASSIVE (INV-1): runs post-session, never during live AI tool calls.
 * TIMEOUT (INV-3): hard 150ms timeout on the REST query.
 *
 * @returns counters for observability; never throws.
 */
export async function runLangfuseBridge(
  opts: LangfuseBridgeOptions,
): Promise<LangfuseBridgeResult> {
  const { paths, sessionId } = opts;

  // 1. Detect Langfuse configuration.
  const langfuseEnv = detectLangfuseConfig(paths.root);
  if (!langfuseEnv) {
    // B1-R5: not configured — exit immediately, no log entry.
    return { written: 0, skipped: true, degraded: false };
  }

  const stopTs = opts.stopTs ?? new Date().toISOString();
  // Default session window: 2 hours before stop time (conservative estimate).
  const fromTs =
    opts.sessionStartTs ?? new Date(new Date(stopTs).getTime() - 2 * 3_600_000).toISOString();

  // 2. Query with hard 150ms timeout.
  const traces = await fetchLangfuseTraces(sessionId, fromTs, stopTs, langfuseEnv, 150);

  if (traces === null) {
    // B1-R2: timed out or errored — write degradation note to state.json.
    try {
      const state = readState(paths.statePath);
      const warnings = state.warnings ?? [];
      warnings.push(`langfuse-bridge: query timed out or failed at ${stopTs}`);
      state.warnings = warnings.slice(-50);
      writeState(paths.statePath, state);
    } catch {
      // State write failure — degrade silently.
    }
    return { written: 0, skipped: false, degraded: true };
  }

  // 3. Persist each trace as a langfuse_trace event.
  let written = 0;
  for (const trace of traces) {
    const payload = {
      entryType: "langfuse_trace" as const,
      traceId: trace.id,
      ...(trace.sessionId !== undefined && { langfuseSessionId: trace.sessionId }),
      ...(trace.model !== undefined && { model: trace.model }),
      ...(trace.usage?.totalCost !== undefined && { totalCost: trace.usage.totalCost }),
      ...(trace.usage?.input !== undefined && { inputTokens: trace.usage.input }),
      ...(trace.usage?.output !== undefined && { outputTokens: trace.usage.output }),
    };

    // INV-7: validate before persistence.
    let validated: v.InferOutput<typeof LangfuseTracePayloadSchema>;
    try {
      validated = v.parse(LangfuseTracePayloadSchema, payload);
    } catch {
      // Schema validation failed — skip this trace.
      continue;
    }

    try {
      await appendEvent(paths, {
        kind: "langfuse_trace",
        sessionId,
        provider: "langfuse",
        payload: validated as Record<string, unknown>,
        ...(trace.createdAt !== undefined && { timestamp: trace.createdAt }),
      });
      written++;
    } catch {
      // appendEvent failed — degrade silently.
    }
  }

  return { written, skipped: false, degraded: false };
}

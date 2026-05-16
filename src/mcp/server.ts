/**
 * LogBook MCP server — stdio lifecycle + tool dispatcher.
 *
 * SDK version: @modelcontextprotocol/sdk@1.29.0 (exact pin).
 *
 * API choice: low-level Server + setRequestHandler.
 * Rationale: McpServer (high-level) requires Zod schemas for tool registration.
 * LogBook uses valibot; using Server directly avoids a second schema library.
 *
 * Dispatcher pipeline (dispatchToolCall — extracted for testability):
 *   Step 1. rate-limit gate           → throw -32000 if exceeded
 *   Step 2. payload size pre-check    → throw -32002 if raw JSON > 8192 bytes
 *   Step 3. valibot strict validation → throw -32600 on any issue
 *   Step 4. path confinement          → throw -32001 (only for tools with pathFields)
 *   Step 5. redact deeply             → secrets replaced; didRedact captured
 *   Step 6. audit BEFORE effect       → writeAuditEvent() persisted to events.jsonl
 *   Step 7. handler call              → domain writes (JSONL + SQLite + optional files)
 *   Step 8. map throws                → JSON-RPC error envelopes (never crashes process)
 *
 * Error code map:
 *   -32000  rate_limited         > 20 calls/sec/tool
 *   -32001  path_escape          path argument resolves outside project root
 *   -32002  payload_too_large    raw input JSON > 8192 bytes
 *   -32600  invalid_input        valibot fail (unknown fields, missing required, maxLength)
 *   -32601  method_not_found     unknown tool name
 *   -32603  internal             uncaught throw in handler
 *
 * CJS bundle note:
 *   tsup compiles this entry to CJS (dist/mcp/server.cjs). __dirname is
 *   available. import.meta is NOT available in pure CJS output.
 *
 * Logging: ALWAYS stderr only. stdout is the JSON-RPC channel.
 *
 * Signal handling: SIGTERM → process.exit(0). Per-call fdatasync ensures
 * no data loss before exit.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as v from "valibot";
import { readFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { bootstrapMcpContext, type MCPContext } from "./context.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import { writeAuditEvent } from "./audit.js";
import { redactDeep } from "./redact.js";
import { ALL_TOOLS, type ToolDef } from "./tools/index.js";

// ---------------------------------------------------------------------------
// Package version
// ---------------------------------------------------------------------------

function readPackageVersion(): string {
  try {
    // __dirname available in CJS; tsup does NOT provide import.meta.url in CJS.
    const pkgPath = join(__dirname, "..", "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// Path confinement
// ---------------------------------------------------------------------------

/**
 * Throw -32001 if `filePath` resolves outside the project `root`.
 * Only called for tools that declare `pathFields`.
 */
function assertWithinProject(root: string, filePath: unknown): void {
  if (typeof filePath !== "string") return;
  const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const normalizedRoot = resolve(root);
  if (!abs.startsWith(normalizedRoot + "/") && abs !== normalizedRoot) {
    const err: { code: number; message: string; data?: unknown } = {
      code: -32001,
      message: "path_escape",
      data: { path: filePath, root },
    };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Dispatcher (extracted for testability — T8a requirement)
// ---------------------------------------------------------------------------

export interface DispatchResult {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Full dispatcher pipeline: rate-limit → size → validate → path-confine →
 * redact → audit → handler → map errors.
 *
 * Returns { result } on success or { error } on any rejection.
 * NEVER throws — all errors are caught and returned as { error }.
 */
export async function dispatchToolCall(
  ctx: MCPContext,
  limiter: SlidingWindowLimiter,
  toolName: string,
  rawInput: Record<string, unknown>,
): Promise<DispatchResult> {
  // Step 1: Look up tool.
  const tool = ALL_TOOLS.find((t) => t.name === toolName) as
    | ToolDef<unknown, unknown>
    | undefined;

  if (!tool) {
    // -32601: method not found.
    return {
      error: { code: -32601, message: "method_not_found", data: { tool: toolName } },
    };
  }

  // Step 2: Rate-limit gate (cheapest rejection path).
  if (!limiter.allow(toolName)) {
    return {
      error: {
        code: -32000,
        message: "rate_limited",
        data: { tool: toolName, windowMs: 1000, limit: 20 },
      },
    };
  }

  // Step 3: Payload size pre-check (before any allocation-heavy work).
  const rawJson = JSON.stringify(rawInput);
  if (rawJson.length > 8192) {
    return {
      error: {
        code: -32002,
        message: "payload_too_large",
        data: { bytes: rawJson.length, max: 8192 },
      },
    };
  }

  // Step 4: Valibot strict validation (rejects unknown fields, enforces maxLength).
  let validated: unknown;
  try {
    validated = v.parse(tool.valibotSchema, rawInput);
  } catch (e) {
    const issues = e instanceof v.ValiError ? e.issues : [];
    return {
      error: {
        code: -32600,
        message: "invalid_input",
        data: { issues },
      },
    };
  }

  // Step 5: Path confinement (only for tools with pathFields; none in T8a).
  if (tool.pathFields) {
    const validatedObj = validated as Record<string, unknown>;
    for (const field of tool.pathFields) {
      try {
        assertWithinProject(ctx.projectRoot, validatedObj[field]);
      } catch (pathErr) {
        const e = pathErr as { code?: number; message?: string; data?: unknown };
        return {
          error: {
            code: e.code ?? -32001,
            message: e.message ?? "path_escape",
            data: e.data,
          },
        };
      }
    }
  }

  // Step 6: Redact deeply — replace secrets before audit + handler receive input.
  const { value: safeInput, didRedact } = redactDeep(
    validated as Record<string, unknown>,
  );

  // Step 7: AUDIT BEFORE EFFECT — persist before any domain write.
  // If the handler throws after this point, the audit record is still there.
  try {
    // ctx.state.session is typed in T8b (LogBookState now has session?: string).
    await writeAuditEvent(ctx.paths, {
      tool: toolName,
      rawInput: rawJson,
      redacted: didRedact,
      ...(ctx.state.session !== undefined ? { sessionId: ctx.state.session } : {}),
    });
  } catch (auditErr) {
    // Audit failure is logged but non-fatal — we do NOT abort the call.
    // A missing audit is better than a failed tool call from the client's perspective.
    process.stderr.write(
      `[logbook-mcp] audit write failed (non-fatal): ${auditErr instanceof Error ? auditErr.message : String(auditErr)}\n`,
    );
  }

  // Step 8: Call handler — domain writes happen here.
  try {
    const result = await (tool.handler as (ctx: MCPContext, input: unknown) => Promise<unknown>)(
      ctx,
      safeInput,
    );
    return { result };
  } catch (handlerErr) {
    // Any uncaught throw from the handler maps to -32603 internal error.
    process.stderr.write(
      `[logbook-mcp] handler '${toolName}' threw (mapped to -32603): ${handlerErr instanceof Error ? handlerErr.message : String(handlerErr)}\n`,
    );
    return {
      error: {
        code: -32603,
        message: "internal",
        data: { tool: toolName },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const ctx = await bootstrapMcpContext();
  const version = readPackageVersion();

  const server = new Server(
    { name: "logbook-mcp", version },
    { capabilities: { tools: {} } },
  );

  const limiter = new SlidingWindowLimiter(20, 1000);

  // tools/list — advertise all registered tools with their JSON Schema.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // tools/call — run the full dispatcher pipeline.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

    const dispatched = await dispatchToolCall(ctx, limiter, toolName, rawArgs);

    if (dispatched.error) {
      // Propagate as a JSON-RPC error — the SDK wraps this in the error envelope.
      throw dispatched.error;
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(dispatched.result) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.once("SIGTERM", () => {
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(
    `[logbook-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});

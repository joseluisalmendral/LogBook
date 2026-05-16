/**
 * Tool registry barrel.
 *
 * T7 scaffold: ALL_TOOLS was empty (0 tools).
 * T8a: populated with 4 tools — decision, error, fix, lesson.
 * T8b: added 5 more tools — resource, milestone, phase, suggest, state.
 * Total: 9 tools (matches mcp-boot.test.ts assertion and design §4 table).
 *
 * ToolDef interface:
 *  - name: tool name registered in the MCP protocol (e.g. "logbook_decision")
 *  - description: human-readable, ≤14 words (token budget §4)
 *  - inputSchema: plain JSON Schema object advertised to MCP clients (protocol level)
 *  - valibotSchema: valibot BaseSchema used by the dispatcher for strict field-level
 *    validation. Runs AFTER the SDK receives the request, before any side effect.
 *  - handler: async function; receives an already-validated, already-redacted input
 *    plus the shared MCPContext. Must NOT write to stdout (it is the JSON-RPC wire).
 *
 * Dispatcher pipeline (enforced in server.ts dispatchToolCall):
 *   1. rate-limit      → -32000 if exceeded
 *   2. payload size    → -32002 if raw JSON > 8192 bytes
 *   3. valibot strict  → -32600 if validation fails (unknown fields, type mismatch, etc.)
 *   4. path confinement→ -32001 (only for tools with pathFields; none in T8a)
 *   5. redact          → secrets replaced before audit + handler receive input
 *   6. audit BEFORE effect → writeAuditEvent() → events.jsonl
 *   7. handler call    → domain writes (JSONL + SQLite)
 *   8. map throws      → JSON-RPC error envelopes
 */

import * as v from "valibot";
import type { MCPContext } from "../context.js";
import { decisionTool } from "./decision.js";
import { errorTool } from "./error.js";
import { fixTool } from "./fix.js";
import { lessonTool } from "./lesson.js";
import { resourceTool } from "./resource.js";
import { milestoneTool } from "./milestone.js";
import { phaseTool } from "./phase.js";
import { suggestTool } from "./suggest.js";
import { stateTool } from "./state.js";

/**
 * JSON Schema object shape accepted by the MCP protocol for input advertisement.
 * Tools use a plain JSON Schema (not Zod) because our validation layer is valibot.
 */
export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Contract for a single MCP tool registration.
 *
 * Two schemas serve different roles:
 *  - `inputSchema` (JsonSchemaObject): advertised to MCP clients; used only for
 *    protocol-level documentation. Does NOT drive server-side validation.
 *  - `valibotSchema`: used by the dispatcher for actual strict validation.
 *    v.strictObject rejects unknown fields (§31 requirement).
 *
 * `pathFields` lists input field names that hold file paths. If provided, the
 * dispatcher runs assertWithinProject on each. None of T8a's 4 tools use paths.
 */
export interface ToolDef<TInput = unknown, TOutput = unknown> {
  /** Tool name as registered in the MCP protocol. */
  name: string;
  /** Short human-readable description. Keep ≤14 words (token budget §4). */
  description: string;
  /** JSON Schema for MCP protocol advertisement only. */
  inputSchema: JsonSchemaObject;
  /**
   * Valibot schema for strict server-side validation.
   * Must use v.strictObject (rejects extra fields per spec §31).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  valibotSchema: v.BaseSchema<unknown, TInput, v.BaseIssue<unknown>>;
  /**
   * Input field names that contain file paths. The dispatcher calls
   * assertWithinProject on each before invoking the handler.
   * Omit or leave undefined for tools with no path inputs.
   */
  pathFields?: string[];
  /**
   * Async handler for the tool's side effects.
   *
   * Contract:
   *  - Input is already validated (valibotSchema passed) AND redacted.
   *  - The audit event is written BEFORE this handler is called.
   *  - Handler MUST NOT write to stdout (it is the JSON-RPC wire).
   *  - Throwing causes the dispatcher to return a -32603 internal error.
   */
  handler: (ctx: MCPContext, input: TInput) => Promise<TOutput>;
}

/**
 * All registered MCP tools. 9 tools total (T8a: 4 + T8b: 5).
 *
 * Order matches the design §4 table (tool #1–#9):
 *   1. decision   2. error   3. fix   4. lesson
 *   5. resource   6. milestone   7. phase   8. suggest   9. state
 *
 * Combined description token budget: each ≤14 words; 9 × avg ~6 tokens ≈ 54 tokens.
 * Well within the 120-token allocation (proposal locked choice #11).
 */
export const ALL_TOOLS: ToolDef<unknown, unknown>[] = [
  decisionTool as ToolDef<unknown, unknown>,
  errorTool as ToolDef<unknown, unknown>,
  fixTool as ToolDef<unknown, unknown>,
  lessonTool as ToolDef<unknown, unknown>,
  resourceTool as ToolDef<unknown, unknown>,
  milestoneTool as ToolDef<unknown, unknown>,
  phaseTool as ToolDef<unknown, unknown>,
  suggestTool as ToolDef<unknown, unknown>,
  stateTool as ToolDef<unknown, unknown>,
];

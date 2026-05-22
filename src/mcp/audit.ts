/**
 * MCP audit trail writer.
 *
 * Writes a `mcp.tool_call` event to events.jsonl BEFORE any tool side effect
 * is applied. The pre-effect record ensures that even if the handler crashes,
 * the call is still audited.
 *
 * Fields:
 *  - id: ULID — sortable, globally unique
 *  - type: literal "mcp.tool_call"
 *  - tool: tool name as provided to the handler
 *  - ts: RFC3339 UTC timestamp (millisecond precision)
 *  - redacted: true if redactDeep() found secrets in the raw input
 *  - inputHash: sha256 of the raw input JSON (before redaction) — for traceability
 *    without storing the original data
 *  - sessionId: optional; forwarded from the MCP context if available
 */

import type { ProjectPaths } from "../core/paths.js";
import { appendEvent } from "../store/index.js";
import { sha256 } from "../util/hash.js";
import { generateUlid } from "../util/ulid.js";

export interface AuditEvent {
  id: string;             // ULID
  type: "mcp.tool_call";
  tool: string;           // tool name
  ts: string;             // RFC3339 UTC
  redacted: boolean;
  inputHash: string;      // sha256 hex of raw input JSON
  sessionId?: string;
}

export interface WriteAuditEventOptions {
  tool: string;
  rawInput: string;
  redacted: boolean;
  sessionId?: string;
}

/**
 * Append a `mcp.tool_call` audit event to the project's events.jsonl.
 * Routes through appendEvent so redaction and Shape-A schema are enforced.
 * Returns an AuditEvent-compatible object so callers can reference the id.
 */
export async function writeAuditEvent(
  paths: ProjectPaths,
  opts: WriteAuditEventOptions,
): Promise<AuditEvent> {
  const id = generateUlid();
  const ts = new Date().toISOString();

  const { event } = await appendEvent(paths, {
    id,
    kind: "system",
    sessionId: opts.sessionId ?? "",
    provider: "logbook-mcp",
    payload: {
      entryType: "mcp_audit",
      tool: opts.tool,
      inputHash: sha256(opts.rawInput),
    },
    timestamp: ts,
  });

  // Return a backward-compat AuditEvent shape so existing callers work unchanged.
  return {
    id: event.id,
    type: "mcp.tool_call",
    tool: opts.tool,
    ts: event.timestamp,
    redacted: event.redacted,
    inputHash: sha256(opts.rawInput),
    ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
  };
}

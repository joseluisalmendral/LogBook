/**
 * logbook_error — Log a didactic error.
 *
 * Persists:
 *  1. events.jsonl: `manual.error` event (canonical event log).
 *  2. SQLite `errors` table: indexed row for fast lookup.
 *
 * SQLite errors table columns (from schema.ts):
 *   id TEXT, session_id TEXT, timestamp TEXT, kind TEXT, message TEXT,
 *   source TEXT, related_event_id TEXT, resolved INTEGER, fix_id TEXT
 *
 * Mapping from MCP input to schema:
 *   title   → message (title is user-facing; message is schema column)
 *   symptom → (appended to message or stored; no dedicated column for symptom)
 *   kind    → "manual" (this is a manually captured error)
 *   source  → "mcp" (captured via MCP tool call)
 *   resolved → 0 (default; toggled by logbook_fix)
 */

import * as v from "valibot";
import { generateUlid } from "../../util/ulid.js";
import { appendEvent } from "../../store/index.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";

const ErrorInputSchema = v.strictObject({
  title: v.pipe(v.string(), v.maxLength(500)),
  symptom: v.optional(v.string()),
});

type ErrorInput = v.InferOutput<typeof ErrorInputSchema>;

interface ErrorOutput {
  id: string;
}

export const errorTool: ToolDef<ErrorInput, ErrorOutput> = {
  name: "logbook_error",
  // ≤14 words; measured: 4 words / ~5 tokens
  description: "Log a didactic error.",

  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 500 },
      symptom: { type: "string" },
    },
    required: ["title"],
    additionalProperties: false,
  },

  valibotSchema: ErrorInputSchema,

  handler: async (ctx: MCPContext, input: ErrorInput): Promise<ErrorOutput> => {
    // ctx.state.session is typed in T8b (LogBookState now has session?: string).
    const sessionId = ctx.state.session ?? "";

    // Write through appendEvent (redaction + Shape-A enforced).
    const { event } = await appendEvent(ctx.paths, {
      kind: "user_entry",
      sessionId,
      provider: "logbook-mcp",
      payload: {
        entryType: "error",
        title: input.title,
        ...(input.symptom !== undefined && { symptom: input.symptom }),
      },
    });
    const id = event.id;
    const ts = event.timestamp;

    try {
      ctx.db
        .prepare(
          `INSERT INTO errors (id, session_id, timestamp, kind, message, source, resolved)
           VALUES (?, ?, ?, 'manual', ?, 'mcp', 0)`,
        )
        .run(id, sessionId, ts, input.title);
    } catch (err) {
      process.stderr.write(
        `[logbook-mcp] error SQLite index failed (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    return { id };
  },
};

/**
 * logbook_fix — Link a fix to an error.
 *
 * Persists:
 *  1. events.jsonl: `manual.fix` event (canonical event log).
 *  2. SQLite `fixes` table: fix row.
 *  3. SQLite `errors` table: if errorId is provided, UPDATE errors SET resolved=1.
 *
 * SQLite fixes table columns (from schema.ts):
 *   id TEXT, error_id TEXT, timestamp TEXT, verified INTEGER
 *
 * The `verified` column defaults to 0. The MCP schema does not include a
 * `verified` flag (spec §13 table row 3 — input shape has summary + errorId only).
 * verified=1 is set by the CLI `logbook fix --verified` flag (T10b).
 */

import * as v from "valibot";
import { generateUlid } from "../../util/ulid.js";
import { appendJsonl } from "../../store/jsonl.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";

const FixInputSchema = v.strictObject({
  summary: v.pipe(v.string(), v.maxLength(500)),
  errorId: v.optional(v.string()),
});

type FixInput = v.InferOutput<typeof FixInputSchema>;

interface FixOutput {
  id: string;
  errorId?: string;
}

export const fixTool: ToolDef<FixInput, FixOutput> = {
  name: "logbook_fix",
  // ≤14 words; measured: 5 words / ~6 tokens
  description: "Link a fix to an error.",

  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", maxLength: 500 },
      errorId: { type: "string" },
    },
    required: ["summary"],
    additionalProperties: false,
  },

  valibotSchema: FixInputSchema,

  handler: async (ctx: MCPContext, input: FixInput): Promise<FixOutput> => {
    const id = generateUlid();
    const ts = new Date().toISOString();

    // Backward compat: iter2-era MCP events used { payload: {...} } wrapper.
    // Iter3+ writes top-level fields (MONITOR-1 closure).
    const event = {
      id,
      type: "manual.fix",
      ts,
      summary: input.summary,
      ...(input.errorId !== undefined && { errorId: input.errorId }),
    };
    await appendJsonl(ctx.paths.eventsJsonl, JSON.stringify(event));

    // Insert into fixes table and optionally toggle errors.resolved.
    try {
      ctx.db
        .prepare(
          `INSERT INTO fixes (id, error_id, timestamp, verified) VALUES (?, ?, ?, 0)`,
        )
        .run(id, input.errorId ?? "", ts);

      // If errorId is provided, mark the error as resolved.
      if (input.errorId) {
        ctx.db
          .prepare(`UPDATE errors SET resolved=1, fix_id=? WHERE id=?`)
          .run(id, input.errorId);
      }
    } catch (err) {
      process.stderr.write(
        `[logbook-mcp] fix SQLite index failed (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    const result: FixOutput = { id };
    if (input.errorId !== undefined) {
      result.errorId = input.errorId;
    }
    return result;
  },
};

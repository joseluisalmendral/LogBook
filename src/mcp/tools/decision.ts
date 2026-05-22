/**
 * logbook_decision — Log an architectural decision.
 *
 * T9 note: this handler was extended from the T8a stub to:
 *   1. Write the JSONL `manual.decision` event (audit-before-effect preserved)
 *   2. Write a SQLite index row in the `decisions` table
 *   3. Call writeAdrFile() to atomically increment adrCounter and write
 *      logbook/decisions/NNNN-<slug>.md via proper-lockfile on state.json
 *   4. Return { id, counter, adrPath } — adrPath is relative to project root
 *
 * Atomicity: the lock acquisition in writeAdrFile() serialises concurrent
 * decision calls so the adrCounter is strictly monotonic (no duplicates).
 *
 * SQLite decisions table columns (from schema.ts):
 *   id TEXT, session_id TEXT, timestamp TEXT, title TEXT,
 *   status TEXT, chosen TEXT, supersedes TEXT, tags_json TEXT
 *
 * We insert with placeholder values for required fields not in the MCP input:
 *   session_id → ctx.state.session ?? ""
 *   status     → input.status ?? "Proposed"
 *   chosen     → input.why ?? ""   (closest mapping to "chosen reason")
 *   supersedes → NULL
 *   tags_json  → NULL
 */

import { relative } from "node:path";
import * as v from "valibot";
import { generateUlid } from "../../util/ulid.js";
import { appendEvent } from "../../store/index.js";
import { writeAdrFile } from "../../generate/adr.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";

// ---------------------------------------------------------------------------
// Input schema — v.strictObject rejects unknown fields (§31 requirement).
// ---------------------------------------------------------------------------

const DecisionInputSchema = v.strictObject({
  title: v.pipe(v.string(), v.maxLength(500)),
  alternatives: v.optional(v.string()),
  why: v.optional(v.string()),
  status: v.optional(v.string()),
  context: v.optional(v.string()),
});

type DecisionInput = v.InferOutput<typeof DecisionInputSchema>;

interface DecisionOutput {
  id: string;
  /** Monotonic counter assigned to this ADR (atomically incremented). */
  counter: number;
  /** ADR file path relative to the project root (e.g. logbook/decisions/0001-use-postgres.md). */
  adrPath: string;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const decisionTool: ToolDef<DecisionInput, DecisionOutput> = {
  name: "logbook_decision",
  // ≤14 words; measured: 5 words / ~6 tokens
  description: "Log an architectural decision.",

  // JSON Schema for MCP protocol advertisement (not used for validation).
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 500 },
      alternatives: { type: "string" },
      why: { type: "string" },
      status: { type: "string" },
      context: { type: "string" },
    },
    required: ["title"],
    additionalProperties: false,
  },

  // Valibot schema used by the dispatcher for strict field-level validation.
  valibotSchema: DecisionInputSchema,

  handler: async (ctx: MCPContext, input: DecisionInput): Promise<DecisionOutput> => {
    const id = generateUlid();
    // ctx.state.session is typed in T8b (LogBookState now has session?: string).
    // Empty string placeholder is safe for SQLite NOT NULL column until T10 sets it.
    const sessionId = ctx.state.session ?? "";

    // Write JSONL event through appendEvent (redaction + Shape-A enforced).
    const { event } = await appendEvent(ctx.paths, {
      id,
      kind: "user_entry",
      sessionId,
      provider: "logbook-mcp",
      payload: {
        entryType: "decision",
        title: input.title,
        ...(input.alternatives !== undefined && { alternatives: input.alternatives }),
        ...(input.why !== undefined && { why: input.why }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.context !== undefined && { context: input.context }),
      },
    });
    const ts = event.timestamp;

    // Best-effort SQLite index row.
    // Non-fatal: if the schema or DB state is unexpected, log to stderr and continue.
    try {
      ctx.db
        .prepare(
          `INSERT INTO decisions (id, session_id, timestamp, title, status, chosen, supersedes, tags_json)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .run(
          id,
          sessionId,
          ts,
          input.title,
          input.status ?? "Proposed",
          input.why ?? "",
        );
    } catch (err) {
      process.stderr.write(
        `[logbook-mcp] decision SQLite index failed (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    // Write ADR file atomically.
    // writeAdrFile acquires a proper-lockfile on state.json before incrementing
    // adrCounter, ensuring counters are strictly monotonic under concurrency.
    // The audit event above has already been written (audit-before-effect contract).
    // Build AdrInput without spreading undefined optional fields (exactOptionalPropertyTypes).
    const adrInput = {
      title: input.title,
      ...(input.context !== undefined && { context: input.context }),
      ...(input.why !== undefined && { chosen: input.why }),
      ...(input.alternatives !== undefined && { alternatives: input.alternatives }),
      ...(input.status !== undefined && { status: input.status }),
    };
    const adrResult = await writeAdrFile(ctx.paths, adrInput);

    // Return adrPath relative to project root for portability.
    const adrPath = relative(ctx.paths.root, adrResult.filepath);

    return { id, counter: adrResult.counter, adrPath };
  },
};

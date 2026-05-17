/**
 * logbook_state — Get current phase, session, pending.
 *
 * READ-ONLY: this tool body writes nothing to disk. The dispatcher's audit
 * pipeline still writes a universal `mcp.tool_call` event before invoking this
 * handler — that is expected and correct. The tool body itself is purely read-only.
 *
 * Reads:
 *  1. ctx.paths.statePath (state.json) → currentPhase, session
 *  2. <.logbook>/pending-suggestions.jsonl → count lines for `pending`
 *
 * Output contract: { phase?, session?, pending: number }
 * Response must stringify to ≤ 120 chars (≤ 30 tokens budget).
 * Fields phase and session are OMITTED (not null) when absent.
 *
 * Design §4 tool #9. Description: "Get current phase, session, pending." — 6 words / ~7 tokens.
 */

import * as v from "valibot";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { readState } from "../../core/state.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";

// Empty strict object — logbook_state accepts no inputs.
const StateInputSchema = v.strictObject({});

type StateInput = v.InferOutput<typeof StateInputSchema>;

interface StateOutput {
  phase?: string;
  session?: string;
  pending: number;
}

/**
 * Count non-empty lines in a JSONL file. Returns 0 if the file does not exist.
 * Synchronous read is acceptable here: state is read per-call and the file is
 * small (one suggestion per line; bounded by human review cadence).
 */
function countPendingSuggestions(pendingPath: string): number {
  if (!existsSync(pendingPath)) return 0;
  try {
    const content = readFileSync(pendingPath, "utf8");
    return content.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

export const stateTool: ToolDef<StateInput, StateOutput> = {
  name: "logbook_state",
  // ≤14 words; measured: 5 words / ~7 tokens (SG0: shortened from "Get current phase, session, pending.")
  description: "Get phase, session, pending.",

  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },

  valibotSchema: StateInputSchema,

  handler: async (ctx: MCPContext, _input: StateInput): Promise<StateOutput> => {
    // Re-read state from disk to get the freshest values.
    const currentState = readState(ctx.paths.statePath);

    const pendingPath = join(ctx.paths.logbookDir, "pending-suggestions.jsonl");
    const pending = countPendingSuggestions(pendingPath);

    // Build output — omit fields that are absent to minimize token usage.
    const output: StateOutput = { pending };
    if (currentState.currentPhase !== undefined) {
      output.phase = currentState.currentPhase;
    }
    if (currentState.session !== undefined) {
      output.session = currentState.session;
    }

    return output;
  },
};

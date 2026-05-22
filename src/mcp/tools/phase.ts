/**
 * logbook_phase — Switch active phase.
 *
 * Side effects:
 *  1. events.jsonl: `manual.phase` event (canonical event log).
 *  2. state.json: writes `currentPhase = input.name` atomically via writeState.
 *
 * The state read-modify-write uses the existing readState/writeState primitives.
 * There is no additional lock around the read-modify-write because:
 *  - The MCP server is a single process (no parallel dispatchers).
 *  - Phase changes are rare and idempotent if repeated.
 *  - T9 introduces proper-lockfile for ADR counter; phase does not need it.
 *
 * Design §4 tool #7. Description: "Switch active phase." — 3 words / ~4 tokens.
 */

import * as v from "valibot";
import { appendEvent } from "../../store/index.js";
import { readState, writeState } from "../../core/state.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";

const PhaseInputSchema = v.strictObject({
  name: v.pipe(v.string(), v.maxLength(500)),
});

type PhaseInput = v.InferOutput<typeof PhaseInputSchema>;

interface PhaseOutput {
  phase: string;
}

export const phaseTool: ToolDef<PhaseInput, PhaseOutput> = {
  name: "logbook_phase",
  // ≤14 words; measured: 3 words / ~4 tokens
  description: "Switch active phase.",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", maxLength: 500 },
    },
    required: ["name"],
    additionalProperties: false,
  },

  valibotSchema: PhaseInputSchema,

  handler: async (ctx: MCPContext, input: PhaseInput): Promise<PhaseOutput> => {
    const sessionId = ctx.state.session ?? "";

    // Write through appendEvent (redaction + Shape-A enforced).
    // kind=system: phase changes are system lifecycle events, not user-authored data.
    await appendEvent(ctx.paths, {
      kind: "system",
      sessionId,
      provider: "logbook-mcp",
      payload: {
        entryType: "phase_change",
        phase: input.name,
      },
    });

    // Write state.currentPhase atomically. Re-read from disk to avoid stale ctx.state.
    try {
      const currentState = readState(ctx.paths.statePath);
      currentState.currentPhase = input.name;
      writeState(ctx.paths.statePath, currentState);
    } catch (err) {
      process.stderr.write(
        `[logbook-mcp] phase state write failed (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    return { phase: input.name };
  },
};

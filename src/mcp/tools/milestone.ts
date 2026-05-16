/**
 * logbook_milestone — Close a phase with a milestone.
 *
 * Persists:
 *  1. events.jsonl: `manual.milestone` event (canonical event log).
 *
 * Design §4 tool #6. Description: "Close a phase with a milestone." — 7 words / ~8 tokens.
 */

import * as v from "valibot";
import { generateUlid } from "../../util/ulid.js";
import { appendJsonl } from "../../store/jsonl.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";

const MilestoneInputSchema = v.strictObject({
  title: v.pipe(v.string(), v.maxLength(500)),
  next: v.optional(v.string()),
});

type MilestoneInput = v.InferOutput<typeof MilestoneInputSchema>;

interface MilestoneOutput {
  id: string;
}

export const milestoneTool: ToolDef<MilestoneInput, MilestoneOutput> = {
  name: "logbook_milestone",
  // ≤14 words; measured: 7 words / ~8 tokens
  description: "Close a phase with a milestone.",

  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 500 },
      next: { type: "string" },
    },
    required: ["title"],
    additionalProperties: false,
  },

  valibotSchema: MilestoneInputSchema,

  handler: async (ctx: MCPContext, input: MilestoneInput): Promise<MilestoneOutput> => {
    const id = generateUlid();
    const ts = new Date().toISOString();

    // Backward compat: iter2-era MCP events used { payload: {...} } wrapper.
    // Iter3+ writes top-level fields (MONITOR-1 closure).
    const event = {
      id,
      type: "manual.milestone",
      ts,
      title: input.title,
      ...(input.next !== undefined && { next: input.next }),
    };
    await appendJsonl(ctx.paths.eventsJsonl, JSON.stringify(event));

    return { id };
  },
};

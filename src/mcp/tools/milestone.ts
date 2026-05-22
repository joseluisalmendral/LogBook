/**
 * logbook_milestone — Close a phase with a milestone.
 *
 * Persists:
 *  1. events.jsonl: `manual.milestone` event (canonical event log).
 *
 * Design §4 tool #6. Description: "Close a phase with a milestone." — 7 words / ~8 tokens.
 */

import * as v from "valibot";
import { appendEvent } from "../../store/index.js";
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
    const sessionId = ctx.state.session ?? "";

    // Write through appendEvent (redaction + Shape-A enforced).
    const { event } = await appendEvent(ctx.paths, {
      kind: "user_entry",
      sessionId,
      provider: "logbook-mcp",
      payload: {
        entryType: "milestone",
        title: input.title,
        ...(input.next !== undefined && { next: input.next }),
      },
    });

    return { id: event.id };
  },
};

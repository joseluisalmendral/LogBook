/**
 * logbook_resource — Log an external resource.
 *
 * Persists:
 *  1. events.jsonl: `manual.resource` event (canonical event log).
 *
 * Design §4 tool #5. Description: "Log an external resource." — 5 words / ~6 tokens.
 */

import * as v from "valibot";
import { appendEvent } from "../../store/index.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";

const ResourceInputSchema = v.strictObject({
  url: v.string(),
  note: v.optional(v.string()),
});

type ResourceInput = v.InferOutput<typeof ResourceInputSchema>;

interface ResourceOutput {
  id: string;
}

export const resourceTool: ToolDef<ResourceInput, ResourceOutput> = {
  name: "logbook_resource",
  // ≤14 words; measured: 5 words / ~6 tokens
  description: "Log an external resource.",

  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      note: { type: "string" },
    },
    required: ["url"],
    additionalProperties: false,
  },

  valibotSchema: ResourceInputSchema,

  handler: async (ctx: MCPContext, input: ResourceInput): Promise<ResourceOutput> => {
    const sessionId = ctx.state.session ?? "";

    // Write through appendEvent (redaction + Shape-A enforced).
    const { event } = await appendEvent(ctx.paths, {
      kind: "user_entry",
      sessionId,
      provider: "logbook-mcp",
      payload: {
        entryType: "resource",
        url: input.url,
        ...(input.note !== undefined && { note: input.note }),
      },
    });

    return { id: event.id };
  },
};

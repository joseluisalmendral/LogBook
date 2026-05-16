/**
 * logbook_resource — Log an external resource.
 *
 * Persists:
 *  1. events.jsonl: `manual.resource` event (canonical event log).
 *
 * Design §4 tool #5. Description: "Log an external resource." — 5 words / ~6 tokens.
 */

import * as v from "valibot";
import { generateUlid } from "../../util/ulid.js";
import { appendJsonl } from "../../store/jsonl.js";
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
    const id = generateUlid();
    const ts = new Date().toISOString();

    // Backward compat: iter2-era MCP events used { payload: {...} } wrapper.
    // Iter3+ writes top-level fields (MONITOR-1 closure).
    const event = {
      id,
      type: "manual.resource",
      ts,
      url: input.url,
      ...(input.note !== undefined && { note: input.note }),
    };
    await appendJsonl(ctx.paths.eventsJsonl, JSON.stringify(event));

    return { id };
  },
};

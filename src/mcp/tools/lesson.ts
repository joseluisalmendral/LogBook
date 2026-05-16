/**
 * logbook_lesson — Log a lesson learned (human-authored).
 *
 * Persists:
 *  1. events.jsonl: `manual.lesson` event (canonical event log).
 *
 * Note: the design §9 table lists a `lessons` SQLite table, but the spec §13
 * row 4 says the MCP side effect is "events JSONL" only (unlike decisions/errors
 * which have explicit SQLite side effects in the 9-tools table).
 * Keeping this consistent with the spec — lessons SQLite indexing is deferred
 * to the CLI command in T10b which has richer metadata (title, body, tags, promotable).
 *
 * Design §4 description: "Log a lesson learned (human-authored)." — 8 words.
 * Token budget: ≤14 words.
 */

import * as v from "valibot";
import { generateUlid } from "../../util/ulid.js";
import { appendJsonl } from "../../store/jsonl.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";

const LessonInputSchema = v.strictObject({
  text: v.pipe(v.string(), v.maxLength(500)),
  linkTo: v.optional(v.string()),
});

type LessonInput = v.InferOutput<typeof LessonInputSchema>;

interface LessonOutput {
  id: string;
}

export const lessonTool: ToolDef<LessonInput, LessonOutput> = {
  name: "logbook_lesson",
  // ≤14 words; measured: 6 words / ~7 tokens
  description: "Log a lesson learned (human-authored).",

  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", maxLength: 500 },
      linkTo: { type: "string" },
    },
    required: ["text"],
    additionalProperties: false,
  },

  valibotSchema: LessonInputSchema,

  handler: async (ctx: MCPContext, input: LessonInput): Promise<LessonOutput> => {
    const id = generateUlid();
    const ts = new Date().toISOString();

    // Backward compat: iter2-era MCP events used { payload: {...} } wrapper.
    // Iter3+ writes top-level fields (MONITOR-1 closure).
    const event = {
      id,
      type: "manual.lesson",
      ts,
      text: input.text,
      ...(input.linkTo !== undefined && { linkTo: input.linkTo }),
    };
    await appendJsonl(ctx.paths.eventsJsonl, JSON.stringify(event));

    return { id };
  },
};

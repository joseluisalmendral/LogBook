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
import { appendEvent } from "../../store/index.js";
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
  // ≤14 words; measured: 4 words / ~6 tokens (SG0: shortened from "Log a lesson learned (human-authored).")
  description: "Log a lesson learned.",

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
    const sessionId = ctx.state.session ?? "";

    // Write through appendEvent (redaction + Shape-A enforced).
    const { event } = await appendEvent(ctx.paths, {
      kind: "user_entry",
      sessionId,
      provider: "logbook-mcp",
      payload: {
        entryType: "lesson",
        text: input.text,
        ...(input.linkTo !== undefined && { linkTo: input.linkTo }),
      },
    });

    return { id: event.id };
  },
};

/**
 * logbook_suggest — Queue a suggestion for human review.
 *
 * Persists:
 *  1. <.logbook>/pending-suggestions.jsonl: one line per suggestion.
 *     Uses appendJsonl (proper-lockfile + fdatasync) for safe concurrent appends.
 *
 * Path note: pending-suggestions.jsonl lives in .logbook/ (alongside state.json and
 * index.sqlite). ProjectPaths does not expose this path explicitly; we derive it
 * locally from paths.logbookDir. T10/T13 will refactor into ProjectPaths if needed.
 *
 * Design §4 tool #8. Description: "Queue a suggestion for human review." — 6 words / ~7 tokens.
 */

import * as v from "valibot";
import { join } from "node:path";
import { generateUlid } from "../../util/ulid.js";
// EXCEPTION: non-events.jsonl write — pending-suggestions.jsonl (not subject to appendEvent boundary)
import { appendJsonl } from "../../store/jsonl.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";

const SuggestInputSchema = v.strictObject({
  type: v.string(),
  payload: v.record(v.string(), v.unknown()),
});

type SuggestInput = v.InferOutput<typeof SuggestInputSchema>;

interface SuggestOutput {
  id: string;
}

export const suggestTool: ToolDef<SuggestInput, SuggestOutput> = {
  name: "logbook_suggest",
  // ≤14 words; measured: 6 words / ~7 tokens
  description: "Queue a suggestion for human review.",

  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string" },
      payload: { type: "object" },
    },
    required: ["type", "payload"],
    additionalProperties: false,
  },

  valibotSchema: SuggestInputSchema,

  handler: async (ctx: MCPContext, input: SuggestInput): Promise<SuggestOutput> => {
    const id = generateUlid();
    const ts = new Date().toISOString();

    const pendingSuggestionsPath = join(ctx.paths.logbookDir, "pending-suggestions.jsonl");

    const line = JSON.stringify({ id, ts, ...input });
    await appendJsonl(pendingSuggestionsPath, line);

    return { id };
  },
};

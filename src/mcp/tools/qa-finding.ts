/**
 * logbook_qa_finding — Log a QA finding (B5).
 *
 * Token budget (INV-2, B5-R4):
 *   Tool description: "Log a QA finding." = 4 words / ~5 tokens.
 *   Current combined tool budget before adding this tool: ~54 tokens (9 tools × ~6).
 *   After adding (10 tools × ~5.5 average): ~55 tokens.
 *   Well within the 120-token tool allocation. pnpm doctor --measure verifies total.
 *
 * Validation pipeline (B5-R2):
 *   valibot strict schema rejects: unknown severity, unknown layer, missing required fields.
 *   Invalid inputs → MCP error response, NO JSONL write.
 *
 * stdio only; no outbound network (B5-R6).
 */

import * as v from "valibot";
import { appendEvent } from "../../store/index.js";
import type { MCPContext } from "../context.js";
import type { ToolDef } from "./index.js";
import { QaFindingPayloadSchema } from "../../events/schemas.js";

// ---------------------------------------------------------------------------
// Input schema — mirrors QaFindingPayloadSchema minus the entryType discriminant.
// The dispatcher injects entryType="qa_finding" before persistence.
// ---------------------------------------------------------------------------

const QaFindingInputSchema = v.strictObject({
  severity: v.picklist(["critical", "high", "medium", "low"]),
  layer: v.picklist(["seo", "geo", "perf", "a11y", "functional"]),
  description: v.pipe(v.string(), v.minLength(1), v.maxLength(5000)),
  fix: v.optional(v.pipe(v.string(), v.maxLength(5000))),
});

type QaFindingInput = v.InferOutput<typeof QaFindingInputSchema>;

interface QaFindingOutput {
  id: string;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const qaFindingTool: ToolDef<QaFindingInput, QaFindingOutput> = {
  name: "logbook_qa_finding",
  // ≤6 tokens as required by B5-R4 / INV-2: measured ~5 tokens.
  description: "Log a QA finding.",

  // JSON Schema for MCP protocol advertisement.
  inputSchema: {
    type: "object",
    properties: {
      severity: {
        type: "string",
        enum: ["critical", "high", "medium", "low"],
      },
      layer: {
        type: "string",
        enum: ["seo", "geo", "perf", "a11y", "functional"],
      },
      description: { type: "string", maxLength: 5000 },
      fix: { type: "string", maxLength: 5000 },
    },
    required: ["severity", "layer", "description"],
    additionalProperties: false,
  },

  // Valibot schema for strict server-side validation (INV-7).
  valibotSchema: QaFindingInputSchema,

  handler: async (ctx: MCPContext, input: QaFindingInput): Promise<QaFindingOutput> => {
    const sessionId = ctx.state.session ?? "";

    // Build full payload with entryType discriminant.
    const fullPayload = {
      entryType: "qa_finding" as const,
      severity: input.severity,
      layer: input.layer,
      description: input.description,
      ...(input.fix !== undefined && { fix: input.fix }),
    };

    // INV-7: validate the full payload against the canonical schema.
    // (The handler input is already validated, but we validate the composed
    // payload too to catch any logic errors in our construction above.)
    v.parse(QaFindingPayloadSchema, fullPayload);

    // INV-8: appendEvent applies Gitleaks-derived redaction automatically.
    // B5-R6: stdio transport only; no outbound network here.
    const { event } = await appendEvent(ctx.paths, {
      kind: "qa_finding",
      sessionId,
      provider: "logbook-mcp",
      payload: fullPayload as Record<string, unknown>,
    });

    return { id: event.id };
  },
};

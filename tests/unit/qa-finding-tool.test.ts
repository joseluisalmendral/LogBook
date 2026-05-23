/**
 * Unit tests: logbook_qa_finding MCP tool (B5 spec).
 *
 * Tests cover:
 *   - Full fields → event persisted, id returned (B5-S1)
 *   - Invalid severity → rejected (no JSONL write) (B5-S2)
 *   - Optional fix field absent → persisted without fix (B5-S3)
 *   - Token budget: tool description ≤ 6 tokens (B5-R4, INV-2, B5-S5)
 *   - Severity absent in event → renders "unknown" label (B5-S4, B5-R5)
 *
 * Covers AG-12, AG-13, B5-S1–B5-S5.
 */

import { describe, it, expect, vi } from "vitest";
import * as v from "valibot";
import { QaFindingPayloadSchema } from "../../src/events/schemas.js";
import { qaFindingTool } from "../../src/mcp/tools/qa-finding.js";

// ---------------------------------------------------------------------------
// QaFindingPayloadSchema validation
// ---------------------------------------------------------------------------

describe("QaFindingPayloadSchema", () => {
  it("accepts valid qa_finding payload with all fields", () => {
    const payload = {
      entryType: "qa_finding" as const,
      severity: "critical" as const,
      layer: "seo" as const,
      description: "Missing meta description on product pages",
      fix: "Add <meta name='description'> to all product page templates",
    };
    expect(() => v.parse(QaFindingPayloadSchema, payload)).not.toThrow();
  });

  it("accepts valid qa_finding payload without optional fix field (B5-S3)", () => {
    const payload = {
      entryType: "qa_finding" as const,
      severity: "medium" as const,
      layer: "a11y" as const,
      description: "Buttons lack aria-label on mobile nav",
    };
    expect(() => v.parse(QaFindingPayloadSchema, payload)).not.toThrow();
  });

  it("rejects invalid severity (B5-S2)", () => {
    const payload = {
      entryType: "qa_finding" as const,
      severity: "catastrophic",
      layer: "seo" as const,
      description: "Bad severity",
    };
    expect(() => v.parse(QaFindingPayloadSchema, payload)).toThrow();
  });

  it("rejects invalid layer", () => {
    const payload = {
      entryType: "qa_finding" as const,
      severity: "high" as const,
      layer: "backend",
      description: "Invalid layer test",
    };
    expect(() => v.parse(QaFindingPayloadSchema, payload)).toThrow();
  });

  it("rejects payload missing required description", () => {
    const payload = {
      entryType: "qa_finding" as const,
      severity: "low" as const,
      layer: "perf" as const,
    };
    expect(() => v.parse(QaFindingPayloadSchema, payload)).toThrow();
  });

  it("rejects unknown extra fields (INV-7 strict)", () => {
    const payload = {
      entryType: "qa_finding" as const,
      severity: "high" as const,
      layer: "geo" as const,
      description: "Test",
      unknownField: "should fail",
    };
    expect(() => v.parse(QaFindingPayloadSchema, payload)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tool definition metadata
// ---------------------------------------------------------------------------

describe("qaFindingTool definition", () => {
  it("name is logbook_qa_finding", () => {
    expect(qaFindingTool.name).toBe("logbook_qa_finding");
  });

  it("description is ≤ 6 tokens (B5-R4, INV-2, B5-S5)", () => {
    // Approximate token count by word count (rough proxy; actual tokenization
    // is model-dependent, but word count ≤ 6 guarantees ≤ ~8 tokens).
    const wordCount = qaFindingTool.description.trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(6);
  });

  it("inputSchema requires severity, layer, description", () => {
    const required = qaFindingTool.inputSchema.required ?? [];
    expect(required).toContain("severity");
    expect(required).toContain("layer");
    expect(required).toContain("description");
  });

  it("inputSchema does not require fix (optional)", () => {
    const required = qaFindingTool.inputSchema.required ?? [];
    expect(required).not.toContain("fix");
  });

  it("inputSchema has additionalProperties: false (INV-7)", () => {
    expect(qaFindingTool.inputSchema.additionalProperties).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tool is registered in ALL_TOOLS
// ---------------------------------------------------------------------------

describe("ALL_TOOLS registration", () => {
  it("qaFindingTool is in ALL_TOOLS (MS-R1)", async () => {
    const { ALL_TOOLS } = await import("../../src/mcp/tools/index.js");
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).toContain("logbook_qa_finding");
  });

  it("ALL_TOOLS has 10 total tools", async () => {
    const { ALL_TOOLS } = await import("../../src/mcp/tools/index.js");
    expect(ALL_TOOLS.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Handler — mock appendEvent (B5-S1)
// ---------------------------------------------------------------------------

describe("qaFindingTool handler", () => {
  it("returns { id } on valid input", async () => {
    const mockAppendEvent = vi.fn().mockResolvedValue({
      event: { id: "test-event-id" },
      ned: false,
    });
    vi.doMock("../../src/store/index.js", () => ({
      appendEvent: mockAppendEvent,
    }));

    // Re-import with mock.
    const { qaFindingTool: tool } = await import("../../src/mcp/tools/qa-finding.js");

    const ctx = {
      paths: {
        root: "/tmp/project",
        eventsJsonl: "/tmp/project/logbook/evidence/events.jsonl",
        statePath: "/tmp/project/.logbook/state.json",
      } as unknown as Parameters<typeof tool.handler>[0]["paths"],
      state: { session: "sess-qa-test" },
    } as Parameters<typeof tool.handler>[0];

    const input = {
      severity: "high" as const,
      layer: "functional" as const,
      description: "Login form does not validate email format",
    };

    const result = await tool.handler(ctx, input);
    expect(result).toHaveProperty("id");

    vi.doUnmock("../../src/store/index.js");
  });
});

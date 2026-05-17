/**
 * Unit test: mcp-descriptions-sync (SG0 — T13.D1).
 *
 * Asserts that the MCP_TOOL_DESCRIPTIONS constant in src/core/token-measure.ts
 * matches the actual `description` fields from each registered MCP tool in
 * src/mcp/tools/index.ts, in the same order.
 *
 * This test prevents drift between the static baked-in constant (used by
 * doctor --measure without spawning the MCP server) and the live tool
 * registrations (served to MCP clients at runtime).
 *
 * Also enforces that the total token cost of all MCP tool descriptions stays
 * within the v1.1 defensive budget ceiling of 495 tokens (total fixed context).
 *
 * Decision T13.D1: descriptions are duplicated as a static constant to avoid
 * circular dep risks at doctor runtime. This test is the synchronization
 * gatekeeper — same pattern as inline-css-sync.test.ts (T12.D1).
 */

import { describe, it, expect } from "vitest";
import { MCP_TOOL_DESCRIPTIONS } from "../../src/core/token-measure.js";
import { ALL_TOOLS } from "../../src/mcp/tools/index.js";

describe("mcp-descriptions-sync", () => {
  it("MCP_TOOL_DESCRIPTIONS count matches ALL_TOOLS count", () => {
    expect(MCP_TOOL_DESCRIPTIONS.length).toBe(ALL_TOOLS.length);
  });

  it("MCP_TOOL_DESCRIPTIONS matches ALL_TOOLS descriptions in order (character-for-character)", () => {
    const liveDescriptions = ALL_TOOLS.map((t) => t.description);
    expect(Array.from(MCP_TOOL_DESCRIPTIONS)).toEqual(liveDescriptions);
  });

  it("each MCP_TOOL_DESCRIPTIONS entry matches its corresponding ALL_TOOLS description", () => {
    for (let i = 0; i < ALL_TOOLS.length; i++) {
      expect(MCP_TOOL_DESCRIPTIONS[i]).toBe(ALL_TOOLS[i]!.description);
    }
  });

  it("total token cost of all MCP tool descriptions is ≤ 62 (v1.1 per-category ceiling after SG0 shortening)", () => {
    // Token formula: Math.ceil(desc.length / 4) per description, summed.
    // Baseline (v1.0): 68 tokens. SG0 target: shorten ≥2 descriptions to save ≥5 tokens.
    // Ceiling after SG0: 62 tokens (68 - 6 margin with logbook_lesson + logbook_state shortened).
    const totalTokens = MCP_TOOL_DESCRIPTIONS.reduce(
      (sum, desc) => sum + Math.ceil(desc.length / 4),
      0,
    );
    expect(totalTokens).toBeLessThanOrEqual(62);
  });
});

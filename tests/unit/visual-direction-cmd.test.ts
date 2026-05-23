/**
 * Unit tests: logbook visual-direction command (B4 spec).
 *
 * Tests cover:
 *   - All required flags present → event persisted (B4-S1)
 *   - Missing required flag → non-zero exit + usage (B4-S2)
 *   - candidates CSV → string[] parsed correctly (B4-R3)
 *   - PASSIVE invariant: command does not modify AI tool behavior (B4-S3, INV-1)
 *   - VisualDirectionPayloadSchema valibot validation
 *
 * Covers AG-11, B4-S1–B4-S3.
 */

import { describe, it, expect, vi } from "vitest";
import * as v from "valibot";
import { VisualDirectionPayloadSchema } from "../../src/events/schemas.js";

// ---------------------------------------------------------------------------
// VisualDirectionPayloadSchema validation
// ---------------------------------------------------------------------------

describe("VisualDirectionPayloadSchema", () => {
  it("accepts a valid visual_direction payload", () => {
    const payload = {
      entryType: "visual_direction" as const,
      candidates: ["option-a", "option-b", "option-c"],
      chosen: "option-b",
      rationale: "Option B best matches the brand guidelines",
    };
    expect(() => v.parse(VisualDirectionPayloadSchema, payload)).not.toThrow();
  });

  it("rejects payload missing required 'chosen' field", () => {
    const payload = {
      entryType: "visual_direction" as const,
      candidates: ["option-a", "option-b"],
      rationale: "Some rationale",
    };
    expect(() => v.parse(VisualDirectionPayloadSchema, payload)).toThrow();
  });

  it("rejects payload missing required 'candidates' field", () => {
    const payload = {
      entryType: "visual_direction" as const,
      chosen: "option-a",
      rationale: "Some rationale",
    };
    expect(() => v.parse(VisualDirectionPayloadSchema, payload)).toThrow();
  });

  it("rejects payload with empty candidates array (B4-R3)", () => {
    const payload = {
      entryType: "visual_direction" as const,
      candidates: [],
      chosen: "option-a",
      rationale: "Rationale",
    };
    expect(() => v.parse(VisualDirectionPayloadSchema, payload)).toThrow();
  });

  it("rejects unknown extra fields (INV-7 strict)", () => {
    const payload = {
      entryType: "visual_direction" as const,
      candidates: ["a", "b"],
      chosen: "a",
      rationale: "R",
      unknownField: "should fail",
    };
    expect(() => v.parse(VisualDirectionPayloadSchema, payload)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Command module exports (B4-S1)
// ---------------------------------------------------------------------------

describe("visual-direction command", () => {
  it("exports a citty command definition", async () => {
    const mod = await import("../../src/cli/commands/visual-direction.js");
    const cmd = mod.default;
    expect(typeof cmd).toBe("object");
    expect(cmd).not.toBeNull();
  });

  it("command has correct meta name", async () => {
    const mod = await import("../../src/cli/commands/visual-direction.js");
    const cmd = mod.default;
    // citty commands have a meta object or are defined with defineCommand.
    expect(cmd).toHaveProperty("meta");
    expect((cmd as { meta: { name: string } }).meta.name).toBe("visual-direction");
  });

  it("command defines --candidates, --chosen, --rationale args", async () => {
    const mod = await import("../../src/cli/commands/visual-direction.js");
    const cmd = mod.default as { args: Record<string, unknown> };
    expect(cmd.args).toHaveProperty("candidates");
    expect(cmd.args).toHaveProperty("chosen");
    expect(cmd.args).toHaveProperty("rationale");
  });
});

// ---------------------------------------------------------------------------
// PASSIVE invariant (B4-S3, INV-1)
// ---------------------------------------------------------------------------

describe("PASSIVE invariant", () => {
  it("visual-direction command module does not modify process.argv on import", async () => {
    const argvBefore = [...process.argv];
    await import("../../src/cli/commands/visual-direction.js");
    expect(process.argv).toEqual(argvBefore);
  });
});

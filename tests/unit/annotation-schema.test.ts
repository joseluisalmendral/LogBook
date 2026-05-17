/**
 * Unit tests for manual.annotation Valibot schema (S6.1).
 *
 * Verifies:
 * - Valid annotation event passes schema
 * - Empty note is rejected
 * - Note exceeding 2000 chars is rejected
 * - Malformed ULID in id/relatedEventId is rejected
 * - Schema accepts optional gitSha (40 hex chars)
 * - Schema rejects malformed gitSha
 *
 * RED phase: written before implementation.
 */

import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { AnnotationEventSchema } from "../../src/cli/commands/annotate.js";

/** Valid ULID-shaped strings for testing (Crockford base32: 0-9, A-H, J-N, P-T, V-Z — no I, L, O, U). */
const VALID_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const VALID_ULID_2 = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

describe("AnnotationEventSchema (S6.1)", () => {
  it("accepts a valid annotation event with all required fields", () => {
    const input = {
      id: VALID_ULID,
      type: "manual.annotation" as const,
      ts: new Date().toISOString(),
      relatedEventId: VALID_ULID_2,
      note: "This is a valid note.",
    };
    const result = v.safeParse(AnnotationEventSchema, input);
    expect(result.success).toBe(true);
  });

  it("accepts optional gitSha (40 hex chars)", () => {
    const input = {
      id: VALID_ULID,
      type: "manual.annotation" as const,
      ts: new Date().toISOString(),
      relatedEventId: VALID_ULID_2,
      note: "Note with git sha.",
      gitSha: "a".repeat(40),
    };
    const result = v.safeParse(AnnotationEventSchema, input);
    expect(result.success).toBe(true);
  });

  it("rejects an empty note", () => {
    const input = {
      id: VALID_ULID,
      type: "manual.annotation" as const,
      ts: new Date().toISOString(),
      relatedEventId: VALID_ULID_2,
      note: "",
    };
    const result = v.safeParse(AnnotationEventSchema, input);
    expect(result.success).toBe(false);
  });

  it("rejects a note exceeding 2000 characters", () => {
    const input = {
      id: VALID_ULID,
      type: "manual.annotation" as const,
      ts: new Date().toISOString(),
      relatedEventId: VALID_ULID_2,
      note: "a".repeat(2001),
    };
    const result = v.safeParse(AnnotationEventSchema, input);
    expect(result.success).toBe(false);
  });

  it("rejects a malformed id (not a ULID pattern)", () => {
    const input = {
      id: "not-a-ulid",
      type: "manual.annotation" as const,
      ts: new Date().toISOString(),
      relatedEventId: VALID_ULID_2,
      note: "Valid note.",
    };
    const result = v.safeParse(AnnotationEventSchema, input);
    expect(result.success).toBe(false);
  });

  it("rejects a malformed relatedEventId", () => {
    const input = {
      id: VALID_ULID,
      type: "manual.annotation" as const,
      ts: new Date().toISOString(),
      relatedEventId: "bad-id",
      note: "Valid note.",
    };
    const result = v.safeParse(AnnotationEventSchema, input);
    expect(result.success).toBe(false);
  });

  it("rejects malformed gitSha (not 40 hex chars)", () => {
    const input = {
      id: VALID_ULID,
      type: "manual.annotation" as const,
      ts: new Date().toISOString(),
      relatedEventId: VALID_ULID_2,
      note: "Note.",
      gitSha: "notahexsha",
    };
    const result = v.safeParse(AnnotationEventSchema, input);
    expect(result.success).toBe(false);
  });

  it("rejects wrong type discriminant", () => {
    const input = {
      id: VALID_ULID,
      type: "manual.snapshot" as const,
      ts: new Date().toISOString(),
      relatedEventId: VALID_ULID_2,
      note: "Note.",
    };
    const result = v.safeParse(AnnotationEventSchema, input as never);
    expect(result.success).toBe(false);
  });
});

/**
 * Unit tests for OTel normalizer: normalizeOtelEnvelope.
 *
 * Tests run against the pure function — no I/O, no side effects.
 * All edge cases (missing fields, empty arrays, malformed input) must
 * return empty arrays and NEVER throw.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { normalizeOtelEnvelope } from "../../src/otel/normalize.js";
import type { Event } from "../../src/types/event.js";

const FIXTURES = path.resolve(__dirname, "../fixtures/otel");

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

function firstEvent(envelope: unknown): Event {
  const events = normalizeOtelEnvelope(envelope);
  expect(events.length).toBeGreaterThan(0);
  const ev = events[0];
  if (!ev) throw new Error("No event returned");
  return ev;
}

// ---------------------------------------------------------------------------
// sample-chat-span.json — single span with gen_ai attributes
// ---------------------------------------------------------------------------

describe("normalizeOtelEnvelope — sample-chat-span.json", () => {
  it("parses fixture and returns exactly 1 event", () => {
    const envelope = loadFixture("sample-chat-span.json");
    expect(normalizeOtelEnvelope(envelope)).toHaveLength(1);
  });

  it("event has provider=anthropic from gen_ai.system", () => {
    expect(firstEvent(loadFixture("sample-chat-span.json")).provider).toBe("anthropic");
  });

  it("event has model from gen_ai.request.model", () => {
    expect(firstEvent(loadFixture("sample-chat-span.json")).model).toBe(
      "claude-3-7-sonnet-20250219",
    );
  });

  it("event kind maps chat operation to assistant_response", () => {
    expect(firstEvent(loadFixture("sample-chat-span.json")).kind).toBe("assistant_response");
  });

  it("event tokens.in = 142 from gen_ai.usage.prompt_tokens", () => {
    expect(firstEvent(loadFixture("sample-chat-span.json")).tokens?.in).toBe(142);
  });

  it("event tokens.out = 78 from gen_ai.usage.completion_tokens", () => {
    expect(firstEvent(loadFixture("sample-chat-span.json")).tokens?.out).toBe(78);
  });

  it("event latencyMs = 1500 derived from (endTime - startTime) in ms", () => {
    // 1747382401500000000 - 1747382400000000000 = 1500000000 ns = 1500 ms
    expect(firstEvent(loadFixture("sample-chat-span.json")).latencyMs).toBe(1500);
  });

  it("event has schemaVersion=3", () => {
    expect(firstEvent(loadFixture("sample-chat-span.json")).schemaVersion).toBe(3);
  });

  it("event has id (non-empty string)", () => {
    const id = firstEvent(loadFixture("sample-chat-span.json")).id;
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("event has redacted=false initially", () => {
    expect(firstEvent(loadFixture("sample-chat-span.json")).redacted).toBe(false);
  });

  it("event traceId matches OTel traceId from span", () => {
    expect(firstEvent(loadFixture("sample-chat-span.json")).traceId).toBe(
      "abc123def456abc123def456abc12301",
    );
  });

  it("event spanId matches OTel spanId from span", () => {
    expect(firstEvent(loadFixture("sample-chat-span.json")).spanId).toBe("abc123def456abc1");
  });
});

// ---------------------------------------------------------------------------
// unknown gen_ai attribute → meta
// ---------------------------------------------------------------------------

describe("normalizeOtelEnvelope — unknown gen_ai attribute lands in meta", () => {
  it("gen_ai.custom.tag from fixture lands in meta", () => {
    const line2 = fs
      .readFileSync(path.join(FIXTURES, "multi-span.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())[1];
    const envelope = JSON.parse(line2!);
    const events = normalizeOtelEnvelope(envelope);
    expect(events).toHaveLength(1);
    const ev = events[0];
    if (!ev) throw new Error("No event returned");
    // gen_ai.custom.tag is not a mapped field → falls into meta
    expect(ev.meta?.["gen_ai.custom.tag"]).toBe("my-custom-value");
  });
});

// ---------------------------------------------------------------------------
// Missing gen_ai.system → fallback provider
// ---------------------------------------------------------------------------

describe("normalizeOtelEnvelope — missing gen_ai.system falls back to otel", () => {
  it("returns provider=otel when gen_ai.system is absent", () => {
    const envelope = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "trace001",
                  spanId: "span001",
                  name: "some.operation",
                  startTimeUnixNano: "1000000000",
                  endTimeUnixNano: "2000000000",
                  attributes: [
                    { key: "gen_ai.request.model", value: { stringValue: "gpt-4o" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const events = normalizeOtelEnvelope(envelope);
    expect(events).toHaveLength(1);
    const ev = events[0];
    if (!ev) throw new Error("No event");
    expect(ev.provider).toBe("otel");
  });

  it("includes note about missing gen_ai.system in meta", () => {
    const envelope = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "trace001",
                  spanId: "span001",
                  name: "some.operation",
                  startTimeUnixNano: "1000000000",
                  endTimeUnixNano: "2000000000",
                  attributes: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const events = normalizeOtelEnvelope(envelope);
    expect(events).toHaveLength(1);
    const ev = events[0];
    if (!ev) throw new Error("No event");
    expect(ev.meta?.["otel.note"]).toContain("gen_ai.system");
  });
});

// ---------------------------------------------------------------------------
// Empty resourceSpans → empty array
// ---------------------------------------------------------------------------

describe("normalizeOtelEnvelope — empty inputs return empty array", () => {
  it("empty resourceSpans returns []", () => {
    expect(normalizeOtelEnvelope({ resourceSpans: [] })).toHaveLength(0);
  });

  it("resourceSpans with empty scopeSpans returns []", () => {
    expect(normalizeOtelEnvelope({ resourceSpans: [{ scopeSpans: [] }] })).toHaveLength(0);
  });

  it("scopeSpans with empty spans returns []", () => {
    expect(
      normalizeOtelEnvelope({
        resourceSpans: [{ scopeSpans: [{ spans: [] }] }],
      }),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Malformed / totally wrong input → empty array, NEVER throws
// ---------------------------------------------------------------------------

describe("normalizeOtelEnvelope — malformed input never throws", () => {
  it("null input returns []", () => {
    expect(() => normalizeOtelEnvelope(null)).not.toThrow();
    expect(normalizeOtelEnvelope(null)).toHaveLength(0);
  });

  it("undefined input returns []", () => {
    expect(() => normalizeOtelEnvelope(undefined)).not.toThrow();
    expect(normalizeOtelEnvelope(undefined)).toHaveLength(0);
  });

  it("string input returns []", () => {
    expect(() => normalizeOtelEnvelope("bad input")).not.toThrow();
    expect(normalizeOtelEnvelope("bad input")).toHaveLength(0);
  });

  it("number input returns []", () => {
    expect(() => normalizeOtelEnvelope(42)).not.toThrow();
    expect(normalizeOtelEnvelope(42)).toHaveLength(0);
  });

  it("empty object {} returns []", () => {
    expect(normalizeOtelEnvelope({})).toHaveLength(0);
  });

  it("resourceSpans is a string (not array) returns []", () => {
    expect(normalizeOtelEnvelope({ resourceSpans: "oops" })).toHaveLength(0);
  });

  it("span with no attributes returns 1 event with fallback values", () => {
    const envelope = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "t1",
                  spanId: "s1",
                  name: "some.op",
                  startTimeUnixNano: "0",
                  endTimeUnixNano: "0",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => normalizeOtelEnvelope(envelope)).not.toThrow();
    expect(normalizeOtelEnvelope(envelope)).toHaveLength(1);
  });
});

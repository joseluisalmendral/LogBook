/**
 * OTel GenAI normalizer — OTLP-JSON envelope → LogBook Event[].
 *
 * Supports the OTel GenAI semantic conventions (gen_ai.*).
 * Design: purely defensive — never throws on malformed input.
 * Unknown attributes fall into event.meta.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */

import { randomUUID } from "node:crypto";
import type { Event, EventKind, EventTokens } from "../types/event.js";

// ---------------------------------------------------------------------------
// Types for defensive OTLP-JSON envelope parsing
// ---------------------------------------------------------------------------

/** One OTel attribute key-value pair (partial — only what we need). */
interface OtlpAttributeValue {
  stringValue?: string;
  intValue?: number;
  doubleValue?: number;
  boolValue?: boolean;
  [k: string]: unknown;
}

interface OtlpAttribute {
  key: string;
  value?: OtlpAttributeValue;
}

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: OtlpAttribute[];
  [k: string]: unknown;
}

interface OtlpScopeSpan {
  spans?: unknown[];
  [k: string]: unknown;
}

interface OtlpResourceSpan {
  scopeSpans?: unknown[];
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Gen AI attribute keys we handle explicitly
// ---------------------------------------------------------------------------

const MAPPED_GEN_AI_KEYS = new Set([
  "gen_ai.system",
  "gen_ai.request.model",
  "gen_ai.operation.name",
  "gen_ai.usage.prompt_tokens",
  "gen_ai.usage.completion_tokens",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract a scalar value from an OTLP attribute value object.
 * Returns undefined when the structure is missing or unrecognized.
 */
function extractAttrValue(
  v: OtlpAttributeValue | undefined,
): string | number | boolean | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v.stringValue === "string") return v.stringValue;
  if (typeof v.intValue === "number") return v.intValue;
  // OTLP JSON may encode intValue as a string (e.g. "142") — normalize that.
  if (typeof v.intValue === "string") {
    const n = Number(v.intValue);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v.doubleValue === "number") return v.doubleValue;
  if (typeof v.boolValue === "boolean") return v.boolValue;
  return undefined;
}

/**
 * Parse a nanosecond timestamp (string or number) into milliseconds.
 * Returns 0 when unparseable.
 */
function nanoToMs(nano: string | number | undefined): number {
  if (nano === undefined || nano === null) return 0;
  // Use BigInt to avoid float precision loss with 64-bit nanosecond values.
  try {
    return Number(BigInt(nano) / BigInt(1_000_000));
  } catch {
    return 0;
  }
}

/**
 * Map an OTel operation name (or span name) to an EventKind.
 *
 * Mapping rules:
 *   "chat" | contains "chat" → "assistant_response"
 *   "embeddings" | contains "embed" → "tool_use"
 *   everything else → "hook_event" (generic OTel event)
 */
function mapOtelKind(operationName: string | undefined, spanName: string | undefined): EventKind {
  const target = (operationName ?? spanName ?? "").toLowerCase();
  if (target.includes("chat") || target.includes("message") || target.includes("complete")) {
    return "assistant_response";
  }
  if (target.includes("embed")) {
    return "tool_use";
  }
  return "hook_event";
}

/**
 * Safely cast an unknown value to OtlpSpan when it looks like an object.
 * Returns undefined otherwise.
 */
function asSpan(raw: unknown): OtlpSpan | undefined {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as OtlpSpan;
  }
  return undefined;
}

/**
 * Normalize a single OTLP span into a LogBook Event.
 * Returns undefined when the span is completely unsalvageable.
 */
function normalizeSpan(rawSpan: unknown): Event | undefined {
  const span = asSpan(rawSpan);
  if (!span) return undefined;

  // Build attribute map from the span's attributes array.
  const attrMap: Record<string, string | number | boolean> = {};
  const unmappedMeta: Record<string, unknown> = {};

  if (Array.isArray(span.attributes)) {
    for (const attr of span.attributes) {
      if (!attr || typeof attr.key !== "string") continue;
      const val = extractAttrValue(attr.value);
      if (val === undefined) continue;
      attrMap[attr.key] = val;
    }
  }

  // Extract mapped gen_ai fields.
  const genAiSystem = typeof attrMap["gen_ai.system"] === "string"
    ? (attrMap["gen_ai.system"] as string)
    : undefined;

  const genAiModel = typeof attrMap["gen_ai.request.model"] === "string"
    ? (attrMap["gen_ai.request.model"] as string)
    : undefined;

  const genAiOperation = typeof attrMap["gen_ai.operation.name"] === "string"
    ? (attrMap["gen_ai.operation.name"] as string)
    : undefined;

  const promptTokens =
    typeof attrMap["gen_ai.usage.prompt_tokens"] === "number"
      ? attrMap["gen_ai.usage.prompt_tokens"]
      : undefined;

  const completionTokens =
    typeof attrMap["gen_ai.usage.completion_tokens"] === "number"
      ? attrMap["gen_ai.usage.completion_tokens"]
      : undefined;

  // Collect unmapped attributes into meta.
  for (const [k, v] of Object.entries(attrMap)) {
    if (!MAPPED_GEN_AI_KEYS.has(k)) {
      unmappedMeta[k] = v;
    }
  }

  // Compute latency.
  const startMs = nanoToMs(span.startTimeUnixNano);
  const endMs = nanoToMs(span.endTimeUnixNano);
  const latencyMs = endMs > startMs ? endMs - startMs : undefined;

  // Build tokens (only when at least one is present).
  const tokens: EventTokens | undefined =
    promptTokens !== undefined || completionTokens !== undefined
      ? {
          ...(promptTokens !== undefined && { in: promptTokens }),
          ...(completionTokens !== undefined && { out: completionTokens }),
        }
      : undefined;

  // Build provider, with note when missing.
  const provider = genAiSystem ?? "otel";
  if (!genAiSystem) {
    unmappedMeta["otel.note"] = "gen_ai.system not present; provider defaulted to 'otel'";
  }

  // Kind mapping.
  const kind = mapOtelKind(genAiOperation, typeof span.name === "string" ? span.name : undefined);

  // Build the Event.
  const event: Event = {
    schemaVersion: 3,
    id: randomUUID(),
    traceId: typeof span.traceId === "string" ? span.traceId : randomUUID(),
    spanId: typeof span.spanId === "string" ? span.spanId : randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: typeof span.traceId === "string" ? span.traceId : "otel",
    provider,
    kind,
    redacted: false,
    payload: {
      raw: rawSpan,
    },
    ...(genAiModel !== undefined && { model: genAiModel }),
    ...(tokens !== undefined && { tokens }),
    ...(latencyMs !== undefined && { latencyMs }),
    ...(Object.keys(unmappedMeta).length > 0 && { meta: unmappedMeta }),
  };

  return event;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an OTLP-JSON envelope and return a normalized Event[] for every
 * span that carries gen_ai.* attributes (or any span — defensive).
 *
 * Never throws. Returns [] on any structural problem.
 */
export function normalizeOtelEnvelope(envelope: unknown): Event[] {
  try {
    if (envelope === null || envelope === undefined) return [];
    if (typeof envelope !== "object" || Array.isArray(envelope)) return [];

    const env = envelope as Record<string, unknown>;
    const resourceSpans = env["resourceSpans"];
    if (!Array.isArray(resourceSpans)) return [];

    const events: Event[] = [];

    for (const rs of resourceSpans) {
      if (!rs || typeof rs !== "object") continue;
      const rsObj = rs as OtlpResourceSpan;
      const scopeSpans = rsObj.scopeSpans;
      if (!Array.isArray(scopeSpans)) continue;

      for (const ss of scopeSpans) {
        if (!ss || typeof ss !== "object") continue;
        const ssObj = ss as OtlpScopeSpan;
        const spans = ssObj.spans;
        if (!Array.isArray(spans)) continue;

        for (const span of spans) {
          const event = normalizeSpan(span);
          if (event) events.push(event);
        }
      }
    }

    return events;
  } catch {
    // Absolute last-resort guard — never let anything escape.
    return [];
  }
}

/**
 * Event-level redaction helper for the store persistence boundary.
 *
 * `redactEventDeep` walks the entire Event object and applies the redaction
 * pipeline to every string-valued leaf, EXCEPT a structural-scalar whitelist
 * that MUST NOT be touched (ULIDs, enum strings, ISO timestamps, numbers).
 *
 * Whitelist (top-level keys only):
 *   schemaVersion, id, traceId, spanId, parentId, timestamp, sessionId,
 *   provider, model, kind, phase, redacted, latencyMs
 *
 * Inside `payload`, `meta`, and `tokens`, every string is redactable.
 *
 * Exported only for use by src/store/index.ts. Do NOT import this from
 * outside src/store/.
 */

import { redact } from "../redact/index.js";
import type { Event } from "../types/event.js";

// Keys that are structurally safe — never contain user content or secrets.
const STRUCTURAL_SCALARS = new Set<string>([
  "schemaVersion",
  "id",
  "traceId",
  "spanId",
  "parentId",
  "timestamp",
  "sessionId",
  "provider",
  "model",
  "kind",
  "phase",
  "redacted",
  "latencyMs",
]);

// ULID-shaped strings are structural reference identifiers, not secrets.
// Crockford base32: digits 0-9, letters A-H, J-N, P-T, V-Z (no I, L, O, U). Length: 26.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// Structural file-path or identifier-derived names that embed a ULID anywhere
// and are otherwise composed of filename-safe chars only. These are derived
// from structural IDs (e.g. adrPath "adrs/01H...J-use-vanilla-js.md") and are
// NOT user secrets. The strict filename-safe charset prevents a leaked secret
// from sneaking through alongside a ULID-shaped prefix.
const STRUCTURAL_PATH_RE =
  /^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]*[0-9A-HJKMNP-TV-Z]{26}[a-zA-Z0-9_.-]*$/;

/**
 * Recursively walk a value tree and apply redact() to every string.
 * Returns the redacted tree and a boolean indicating whether any hit fired.
 *
 * @internal Called by redactEventDeep — not exported directly.
 */
function walkDeep(value: unknown): { value: unknown; redactedAny: boolean } {
  if (typeof value === "string") {
    // ULID-shaped reference IDs (errorId, relatedEventId, eventId, etc.) are
    // structural identifiers with high entropy by design — skip redaction.
    if (ULID_RE.test(value)) {
      return { value, redactedAny: false };
    }
    // Structural paths that embed a ULID (e.g. adrPath "adrs/01H...J-foo.md")
    // are also derived from IDs, not secrets.
    if (STRUCTURAL_PATH_RE.test(value)) {
      return { value, redactedAny: false };
    }
    const result = redact(value);
    return { value: result.redacted, redactedAny: result.hits.length > 0 };
  }

  if (Array.isArray(value)) {
    let redactedAny = false;
    const next = value.map((item) => {
      const r = walkDeep(item);
      if (r.redactedAny) redactedAny = true;
      return r.value;
    });
    return { value: next, redactedAny };
  }

  if (value !== null && typeof value === "object") {
    let redactedAny = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = walkDeep(v);
      if (r.redactedAny) redactedAny = true;
      next[k] = r.value;
    }
    return { value: next, redactedAny };
  }

  // Primitives (number, boolean, null, undefined) — pass through unchanged.
  return { value, redactedAny: false };
}

/**
 * Redact the entire Event object before persistence.
 *
 * Top-level structural scalars (see STRUCTURAL_SCALARS) are passed through
 * unchanged. All other top-level keys (payload, meta, tokens, and any
 * unknown future keys) are walked recursively by `walkDeep`.
 *
 * Returns the mutated event and a flag indicating whether any redaction fired.
 */
export function redactEventDeep(event: Event): { event: Event; redactedAny: boolean } {
  let redactedAny = false;

  const eventRecord = event as unknown as Record<string, unknown>;
  for (const key of Object.keys(eventRecord)) {
    if (STRUCTURAL_SCALARS.has(key)) {
      // Leave structural scalars untouched.
      continue;
    }

    const r = walkDeep(eventRecord[key]);
    if (r.redactedAny) redactedAny = true;
    eventRecord[key] = r.value;
  }

  return { event, redactedAny };
}

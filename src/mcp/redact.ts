/**
 * MCP redaction helper — deep redaction for tool inputs.
 *
 * Applies the iter1 `redact` pipeline to the full JSON serialization of
 * the validated input object, then parses the redacted JSON back into an
 * object so handlers receive a clean, already-redacted value.
 *
 * The approach (JSON stringify → redact string → JSON parse) is safe because:
 *  - All tool inputs are validated valibot objects (no circular refs, no Date).
 *  - The redact function operates on the string representation, which is what
 *    ultimately gets persisted in JSONL events.
 *  - If a regex replacement breaks JSON parsability (edge case: redacted span
 *    crosses a JSON structural character), we fall back to a per-field string
 *    redaction approach where we only process string values.
 *
 * Reference fields exemption:
 *   Fields whose names end in "Id" or match known reference field names (e.g.
 *   "linkTo", "errorId") are SKIPPED by the entropy pass because they hold
 *   ULIDs or other internal identifiers — not secrets. The rule-based pass
 *   (Gitleaks patterns) still applies to these fields. This prevents ULIDs
 *   from being falsely flagged by the high-entropy heuristic.
 *
 * Usage in dispatcher:
 *   const { value: safeInput, didRedact } = redactDeep(validated);
 *   // pass safeInput to audit + handler; use didRedact for audit.redacted flag.
 */

import { redact } from "../redact/index.js";

export interface RedactDeepResult<T> {
  /** The input with secrets replaced by [REDACTED:<ruleId>] tokens. */
  value: T;
  /** True if at least one field was redacted. */
  didRedact: boolean;
}

/**
 * Field names that hold internal reference IDs (ULIDs, slugs) and must not
 * be subject to the entropy-based redaction pass. The Gitleaks rule-based
 * pass still applies — only the entropy heuristic is bypassed for these.
 */
const REFERENCE_FIELDS = new Set([
  "errorId",
  "linkTo",
  // Add more reference field names here as new tools are added (T8b, T10).
]);

/**
 * Return true for field names that hold internal identifiers, not secrets.
 * These fields are excluded from per-field entropy redaction.
 */
function isReferenceField(fieldName: string): boolean {
  // Convention: fields ending in "Id" are reference fields (errorId, sessionId, etc.)
  if (fieldName.endsWith("Id") || fieldName.endsWith("_id")) return true;
  return REFERENCE_FIELDS.has(fieldName);
}

/**
 * Deep-redact a validated tool input object.
 *
 * Strategy: redact each field individually so we can skip reference fields
 * (ULIDs, IDs) that would otherwise be flagged by the entropy heuristic.
 * This is safer than full-JSON redaction which cannot distinguish field names.
 */
export function redactDeep<T extends Record<string, unknown>>(
  input: T,
): RedactDeepResult<T> {
  const result: Record<string, unknown> = {};
  let anyRedacted = false;

  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") {
      if (isReferenceField(k)) {
        // Apply only rule-based redaction (skip entropy pass) for reference fields.
        // Use a narrow entropy threshold that won't fire on ULIDs.
        const r = redact(v, { entropyThreshold: 999 }); // effectively disable entropy for IDs
        result[k] = r.redacted;
        if (r.count > 0) anyRedacted = true;
      } else {
        // Full redaction (rules + entropy) for content fields.
        const r = redact(v);
        result[k] = r.redacted;
        if (r.count > 0) anyRedacted = true;
      }
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      // Recurse into nested objects.
      const nested = redactDeep(v as Record<string, unknown>);
      result[k] = nested.value;
      if (nested.didRedact) anyRedacted = true;
    } else {
      result[k] = v;
    }
  }

  return { value: result as T, didRedact: anyRedacted };
}

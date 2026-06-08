/**
 * narrative-kinds.ts — Single source of truth for the event kinds that belong
 * on the narrative timeline (slice 21 / INV-20).
 *
 * IMPORTANT: this file MUST be kept byte-identical with
 *   apps/export-ui/src/lib/types/narrative-kinds.ts
 * The duplication is intentional (ADR-SN-A1): the export-ui bundle is built in
 * isolation and `vite-plugin-singlefile` inlines it; reaching outside that
 * package would break the bundle's self-contained contract. Drift is detected
 * by `tests/unit/narrative-kinds-sync.test.ts`.
 *
 * To edit: change THIS file first, then copy the contents byte-for-byte into
 * the UI mirror. The sync test fails otherwise and tells you which way to
 * copy.
 */

export const NARRATIVE_KINDS = [
  "user_prompt",
  "claude_message",
  "subagent_complete",
  "agent_question",
  "skill_invoked",
  "session_context",
  "commit",
  "manual.commit",
] as const;

export const NARRATIVE_KIND_PREFIXES = ["manual."] as const;

export type NarrativeKind = (typeof NARRATIVE_KINDS)[number];

/** True for event types that belong on the narrative timeline. */
export function isNarrativeKind(type: string): boolean {
  if ((NARRATIVE_KINDS as readonly string[]).includes(type)) return true;
  return NARRATIVE_KIND_PREFIXES.some((p) => type.startsWith(p));
}

/** True for types that should NEVER appear in chapter.events. */
export const NOISE_KIND_PREFIXES = ["tool_result", "hook_event"] as const;
export function isNoiseKind(type: string): boolean {
  if (type === "hook_event" || type === "system") return true;
  return type.startsWith("tool_result");
}

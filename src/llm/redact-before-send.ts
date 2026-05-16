/**
 * Pre-send redaction helper — defence in depth.
 *
 * The router calls this before forwarding any prompt to an LLM adapter.
 * Even if the caller already redacted the payload (e.g. via appendEvent),
 * this ensures nothing slips through at the LLM call boundary.
 *
 * Pure function — no I/O, deterministic.
 */

import { redact } from "../redact/index.js";

export interface RedactBeforeSendInput {
  systemPrompt: string;
  userPrompt: string;
}

export interface RedactBeforeSendOutput {
  redactedSystem: string;
  redactedUser: string;
  /** Total number of secrets redacted across BOTH prompts. */
  count: number;
}

/**
 * Apply `redact()` to both the system and user prompts.
 * Returns the cleaned strings and the combined hit count.
 */
export function redactBeforeSend(input: RedactBeforeSendInput): RedactBeforeSendOutput {
  const sysResult = redact(input.systemPrompt);
  const userResult = redact(input.userPrompt);

  return {
    redactedSystem: sysResult.redacted,
    redactedUser: userResult.redacted,
    count: sysResult.count + userResult.count,
  };
}

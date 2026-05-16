/**
 * Claude Agent SDK adapter.
 *
 * Used when LogBook is running inside Claude Code (subscription auth —
 * no separate ANTHROPIC_API_KEY required). Detected via:
 *   - CLAUDE_CODE_SESSION_ID environment variable, OR
 *   - CLAUDECODE environment variable (set by Claude Code CLI)
 *
 * API shape (claude-agent-sdk@0.3.143):
 *   query({ prompt: string, options?: Options }): AsyncGenerator<SDKMessage>
 *   SDKResultSuccess: { type: "result"; subtype: "success"; result: string; ... }
 *
 * This adapter collects assistant text by iterating the async generator
 * until the SDKResultMessage is emitted, then returns result.result.
 *
 * IMPORTANT: assertNotInTestMode() is called at the top of this function.
 * Any test that reaches this code without mocking will throw immediately.
 */

import { assertNotInTestMode } from "./guards.js";
import type { LlmAdapterCallInput } from "../types/llm.js";

export async function claudeSdkAdapter(input: LlmAdapterCallInput): Promise<string> {
  assertNotInTestMode("claude-agent-sdk");

  // Dynamic import so that the module is only resolved when actually needed
  // (prevents TypeScript from treating the SDK as a hard compile-time dep in tests)
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  // Build the prompt: system context + user message combined as a single prompt.
  // The claude-agent-sdk query() runs a full Claude Code agent session; there
  // is no explicit system/user separation in its prompt param — we combine them.
  const combinedPrompt =
    input.systemPrompt.trim().length > 0
      ? `${input.systemPrompt}\n\n${input.userPrompt}`
      : input.userPrompt;

  let resultText = "";

  const stream = query({
    prompt: combinedPrompt,
    options: {
      // No-tool mode: only allow the agent to respond with text (no file edits etc.)
      tools: [],
      allowedTools: [],
    },
  });

  for await (const message of stream) {
    if (
      message.type === "result" &&
      "subtype" in message &&
      message.subtype === "success"
    ) {
      resultText = (message as { type: string; subtype: string; result: string }).result;
      break;
    }
  }

  if (!resultText) {
    throw new Error("claude-agent-sdk: no result message received from query()");
  }

  return resultText;
}

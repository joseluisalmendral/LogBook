/**
 * Vercel AI SDK adapter.
 *
 * Used when an explicit API key is available (ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * or a key value stored in providers.json).
 *
 * API shape (ai@6.0.183 + @ai-sdk/anthropic@3.0.78 + @ai-sdk/openai@3.0.64):
 *   generateText({ model, system, prompt, maxTokens, temperature }): Promise<{ text: string }>
 *   createAnthropic({ apiKey })(modelId): LanguageModel
 *   createOpenAI({ apiKey, baseURL? })(modelId): LanguageModel
 *
 * IMPORTANT: assertNotInTestMode() is called at the top of this function.
 * Any test that reaches this code without mocking will throw immediately.
 */

import { assertNotInTestMode } from "./guards.js";
import type { LlmAdapterCallInput } from "../types/llm.js";

export async function vercelSdkAdapter(input: LlmAdapterCallInput): Promise<string> {
  assertNotInTestMode("vercel-ai-sdk");

  if (input.auth.kind !== "api-key") {
    throw new Error("vercelSdkAdapter requires api-key auth resolution");
  }

  // Dynamic imports — resolved at call time, not at module load
  const { generateText } = await import("ai");
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const { createOpenAI } = await import("@ai-sdk/openai");

  const { providerEntry, auth } = input;
  const apiKeyValue = auth.value;

  let model: ReturnType<ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAI>>;

  switch (providerEntry.kind) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: apiKeyValue });
      model = anthropic(providerEntry.model);
      break;
    }
    case "openai":
    case "azure": {
      const openai = createOpenAI({
        apiKey: apiKeyValue,
        ...(providerEntry.base_url ? { baseURL: providerEntry.base_url } : {}),
      });
      model = openai(providerEntry.model);
      break;
    }
    default: {
      throw new Error(
        `vercelSdkAdapter: unsupported provider kind '${providerEntry.kind}'. ` +
          "Supported: anthropic, openai, azure"
      );
    }
  }

  // Note: ai@6.x uses `maxOutputTokens` (not `maxTokens` from older versions)
  const { text } = await generateText({
    model,
    system: input.systemPrompt,
    prompt: input.userPrompt,
    maxOutputTokens: input.maxTokens,
    temperature: input.temperature,
  });

  return text;
}

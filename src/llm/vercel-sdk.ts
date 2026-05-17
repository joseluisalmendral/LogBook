/**
 * Vercel AI SDK adapter.
 *
 * Used when an explicit API key is available (ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * GOOGLE_GENERATIVE_AI_API_KEY, or a key value stored in providers.json).
 *
 * API shape (ai@6.0.183 + @ai-sdk/anthropic@3.0.78 + @ai-sdk/openai@3.0.64 + @ai-sdk/google@3.0.75):
 *   generateText({ model, system, prompt, maxOutputTokens, temperature }): Promise<{ text: string }>
 *   streamText({ model, system, prompt, maxOutputTokens, temperature }):
 *     { textStream: AsyncIterableStream<string>, text: PromiseLike<string> }
 *   createAnthropic({ apiKey })(modelId): LanguageModel
 *   createOpenAI({ apiKey, baseURL? })(modelId): LanguageModel
 *   createGoogleGenerativeAI({ apiKey })(modelId): LanguageModel
 *
 * Streaming path: activated when input.onChunk is defined. Uses streamText,
 * iterates textStream AsyncIterable<string>, invokes onChunk per chunk,
 * returns the full text from the resolved text Promise.
 * Non-streaming path (default): uses generateText for a single-shot response.
 *
 * Supported provider kinds:
 *   anthropic — uses @ai-sdk/anthropic
 *   openai    — uses @ai-sdk/openai (optional base_url override for gateways)
 *   azure     — uses @ai-sdk/openai with base_url required
 *   google    — uses @ai-sdk/google (Gemini models)
 *   local     — uses @ai-sdk/openai with baseURL=localhost:11434/v1 (Ollama)
 *
 * IMPORTANT: assertNotInTestMode() is called at the top of this function.
 * Any test that reaches this code without mocking will throw immediately.
 */

import { assertNotInTestMode } from "./guards.js";
import type { LlmAdapterCallInput } from "../types/llm.js";

/** Default Ollama base URL when provider config does not specify base_url. */
const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

export async function vercelSdkAdapter(input: LlmAdapterCallInput): Promise<string> {
  assertNotInTestMode("vercel-ai-sdk");

  if (input.auth.kind !== "api-key") {
    throw new Error("vercelSdkAdapter requires api-key auth resolution");
  }

  // Dynamic imports — resolved at call time, not at module load
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");

  const { providerEntry, auth } = input;
  const apiKeyValue = auth.value;

  type AnyLanguageModel = ReturnType<
    | ReturnType<typeof createAnthropic>
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createGoogleGenerativeAI>
  >;

  let model: AnyLanguageModel;

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
    case "google": {
      // Uses @ai-sdk/google. API key via GOOGLE_GENERATIVE_AI_API_KEY env
      // (resolved upstream by resolveAuth → auth.value).
      const google = createGoogleGenerativeAI({ apiKey: apiKeyValue });
      model = google(providerEntry.model);
      break;
    }
    case "local": {
      // Ollama via @ai-sdk/openai with OpenAI-compatible endpoint.
      // Ollama does not require a real API key; "ollama" is used as a placeholder
      // because createOpenAI requires a non-empty apiKey parameter.
      const baseURL = providerEntry.base_url ?? OLLAMA_DEFAULT_BASE_URL;
      const openaiLocal = createOpenAI({ apiKey: "ollama", baseURL });
      model = openaiLocal(providerEntry.model);
      break;
    }
    default: {
      throw new Error(
        `vercelSdkAdapter: unsupported provider kind '${providerEntry.kind}'. ` +
          "Supported: anthropic, openai, azure, google, local"
      );
    }
  }

  // Common call parameters for both generateText and streamText paths.
  const callParams = {
    model,
    system: input.systemPrompt,
    prompt: input.userPrompt,
    // Note: ai@6.x uses `maxOutputTokens` (not `maxTokens` from older versions)
    maxOutputTokens: input.maxTokens,
    temperature: input.temperature,
  };

  if (input.onChunk !== undefined) {
    // Streaming path: use streamText, deliver chunks via onChunk callback,
    // then return the full text from the resolved Promise.
    // D3: file write still happens from the full buffered text — byte-identity preserved.
    const { streamText } = await import("ai");
    const streamResult = streamText(callParams);
    for await (const chunk of streamResult.textStream) {
      input.onChunk(chunk);
    }
    // Await the canonical full-text Promise (always equals joined chunks).
    return await streamResult.text;
  }

  // Non-streaming path (default): use generateText for a single-shot response.
  const { generateText } = await import("ai");
  const { text } = await generateText(callParams);
  return text;
}

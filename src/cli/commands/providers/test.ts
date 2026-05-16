/**
 * logbook providers test [--provider <p>] [--task <task>] [--json]
 *
 * Tests LLM connectivity via the configured router.
 *
 * Mock mode (CI-safe):
 *   When env var LOGBOOK_LLM_MOCK=1 is set, uses a stub adapter that returns
 *   "pong" deterministically without making any real LLM calls. This is the
 *   convention used in integration tests so CI never hits real APIs.
 *
 * Real mode:
 *   Builds a createRouter() from the configured providers.json and calls it.
 *   The router respects auth resolution (claude-sdk > ANTHROPIC_API_KEY > OPENAI_API_KEY).
 *   If no auth is available, returns { ok:false, error:{code:"no_auth"} }.
 *
 * Output:
 *   --json  → JSON LlmProviderCallResult
 *   default → human-readable summary
 *
 * Exit codes:
 *   0 → ok:true
 *   1 → ok:false (error printed to stderr)
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../../core/paths.js";
import { createRouter } from "../../../llm/provider-router.js";
import type { LlmProviderCallResult } from "../../../types/llm.js";
import type { LlmAdapterCallInput } from "../../../types/llm.js";

/**
 * Stub adapter for LOGBOOK_LLM_MOCK=1 mode.
 * Returns "pong" without making any real LLM calls.
 */
function mockAdapter(_input: LlmAdapterCallInput): Promise<string> {
  return Promise.resolve("pong");
}

export default defineCommand({
  meta: {
    name: "test",
    description: "Test LLM connectivity via the configured router",
  },
  args: {
    provider: {
      type: "string",
      required: false,
      description: "Test a specific provider (else: uses default routing)",
    },
    task: {
      type: "string",
      required: false,
      default: "providers.test",
      description: "Task name for routing",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    let root: string;
    try {
      root = resolveProjectRoot();
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    const paths = makePaths(root);
    const taskName = (args["task"] as string | undefined) ?? "providers.test";
    const isMock = process.env["LOGBOOK_LLM_MOCK"] === "1";

    const routerOpts = {
      providersPath: paths.providersPath,
      // In mock mode: inject stub adapter to avoid any real LLM calls
      ...(isMock && { mockAdapter }),
      // Skip real sleep delays in mock mode for faster tests
      ...(isMock && { sleep: async () => {} }),
    };

    const router = createRouter(routerOpts);

    let result: LlmProviderCallResult;
    try {
      result = await router.call({
        task: taskName,
        systemPrompt: "Respond with exactly: pong",
        userPrompt: "ping",
        maxTokens: 50,
        temperature: 0,
      });
    } catch (err) {
      process.stderr.write(
        `error: unexpected router error — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    if (args["json"]) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      if (result.ok) {
        process.stdout.write(
          `ok: true\nprovider: ${result.provider}\nmodel: ${result.model}\nlatencyMs: ${result.latencyMs}\ntext: ${result.text ?? ""}\n`,
        );
      } else {
        process.stderr.write(
          `ok: false\nerror: ${result.error?.code ?? "unknown"} — ${result.error?.message ?? ""}\nprovider: ${result.provider}\nmodel: ${result.model}\n`,
        );
      }
    }

    process.exit(result.ok ? 0 : 1);
  },
});

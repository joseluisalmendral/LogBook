import { beforeEach } from "vitest";
import { resetLiveCallCount } from "../src/llm/guards.js";

/**
 * Global vitest setup file.
 * Registered in vitest.config.ts for unit and integration test projects.
 *
 * Resets the LLM live-call counter before each test so that llm-no-real-calls.test.ts
 * gets a clean count and any accidental real adapter instantiation is caught immediately.
 */
beforeEach(() => {
  resetLiveCallCount();
});

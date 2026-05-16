import { describe, test, expect } from "vitest";
import { getLiveCallCount } from "../../src/llm/guards.js";

/**
 * CI guard: verifies that no real LLM adapter has been instantiated across the test suite.
 *
 * This test is intentionally simple now (T5). It becomes meaningful in T6 when the
 * actual provider adapters call assertNotInTestMode() in their constructors. At that
 * point, any test that instantiates a real adapter (without mocking) will increment
 * liveCallsInThisProcess and cause this assertion to fail — catching the regression.
 *
 * For T5, the count is trivially 0 because no adapters exist yet.
 * The setup.ts global beforeEach resets the counter before each test, so this
 * test gets a fresh count reflecting only what happened since the last reset.
 */
describe("LLM CI guard — no real adapter instantiation in test suite", () => {
  test("getLiveCallCount is 0 — no real LLM adapter has been instantiated", () => {
    // If this fails in a future slice (T6+), it means a test instantiated a real
    // LLM adapter constructor without mocking. Fix: use mockProviderRouter() instead.
    expect(getLiveCallCount()).toBe(0);
  });
});

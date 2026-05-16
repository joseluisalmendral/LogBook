/**
 * Guard against accidental real LLM API client instantiation during tests.
 *
 * Tests MUST mock the provider-router; any real adapter constructor call
 * during `process.env.NODE_ENV === "test"` (or vitest detection) throws.
 *
 * Detection uses triple coverage:
 *   1. process.env.NODE_ENV === "test"
 *   2. typeof globalThis.__vitest_worker__ !== "undefined"  (vitest worker global)
 *   3. process.env.VITEST === "true"
 */

// Module-level counter — tracks real (non-test) LLM adapter instantiations.
// Intentionally NOT exported as a mutable value; only the read/reset helpers are exposed.
let liveCallsInThisProcess = 0;

/**
 * Call this at the top of every LLM adapter constructor.
 * In test environments, it throws immediately (before liveCallsInThisProcess is touched).
 * In production environments, it increments the live-call counter.
 */
export function assertNotInTestMode(adapterName: string): void {
  const inTest =
    process.env["NODE_ENV"] === "test" ||
    typeof (globalThis as Record<string, unknown>)["__vitest_worker__"] !== "undefined" ||
    process.env["VITEST"] === "true";

  if (inTest) {
    throw new Error(
      `LLM adapter '${adapterName}' attempted instantiation during test. ` +
        `Tests must mock the provider-router. See src/llm/guards.ts.`
    );
  }

  liveCallsInThisProcess += 1;
}

/** Returns the count of real (non-test) LLM adapter instantiations in this process. */
export function getLiveCallCount(): number {
  return liveCallsInThisProcess;
}

/** Resets the live-call counter. Called from tests/setup.ts beforeEach to start clean. */
export function resetLiveCallCount(): void {
  liveCallsInThisProcess = 0;
}

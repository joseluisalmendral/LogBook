import { describe, test, expect, beforeEach } from "vitest";
import { assertNotInTestMode, getLiveCallCount, resetLiveCallCount } from "../../src/llm/guards.js";

describe("LLM guards — assertNotInTestMode", () => {
  beforeEach(() => {
    resetLiveCallCount();
  });

  test("assertNotInTestMode throws when called during vitest", () => {
    // We ARE in vitest right now, so calling assertNotInTestMode should throw.
    expect(() => assertNotInTestMode("test-adapter")).toThrowError(
      /LLM adapter 'test-adapter' attempted instantiation during test/
    );
  });

  test("assertNotInTestMode error message mentions the adapter name", () => {
    expect(() => assertNotInTestMode("anthropic")).toThrowError(/anthropic/);
    expect(() => assertNotInTestMode("openai")).toThrowError(/openai/);
  });

  test("error message includes guidance to mock the provider-router", () => {
    let caught: unknown;
    try {
      assertNotInTestMode("claude-sdk");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("mock the provider-router");
  });

  test("getLiveCallCount starts at 0 after resetLiveCallCount", () => {
    // resetLiveCallCount is called in beforeEach
    expect(getLiveCallCount()).toBe(0);
  });

  test("resetLiveCallCount resets the counter to 0", () => {
    // Call assertNotInTestMode inside try/catch to verify counter behavior.
    // The throw aborts the call before the counter assignment, so count stays 0.
    try { assertNotInTestMode("anthropic"); } catch { /* expected throw */ }
    // The guard throws before incrementing the counter (test mode → throw always fires first).
    expect(getLiveCallCount()).toBe(0);
  });

  test("assertNotInTestMode inside try/catch does NOT increment counter (throw fires before increment)", () => {
    // This documents a deliberate design property: the test-mode check always throws
    // before liveCallsInThisProcess is incremented. So catching the error does NOT
    // result in a live call being counted.
    const before = getLiveCallCount();
    try {
      assertNotInTestMode("some-adapter");
    } catch {
      // expected — we are in test mode
    }
    const after = getLiveCallCount();
    expect(after).toBe(before); // counter is unchanged — throw fires before increment
  });
});

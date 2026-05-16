import { describe, test, expect } from "vitest";
import { redactBeforeSend } from "../../src/llm/redact-before-send.js";

describe("redactBeforeSend", () => {
  test("redacts AWS access key in systemPrompt and counts 1 hit", () => {
    const result = redactBeforeSend({
      systemPrompt: "Key: AKIAIOSFODNN7EXAMPLE",
      userPrompt: "Hello world",
    });
    expect(result.redactedSystem).toContain("[REDACTED:");
    expect(result.redactedSystem).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.redactedUser).toBe("Hello world");
    expect(result.count).toBe(1);
  });

  test("redacts AWS access key in userPrompt and counts 1 hit", () => {
    const result = redactBeforeSend({
      systemPrompt: "You are an assistant.",
      userPrompt: "My key is AKIAIOSFODNN7EXAMPLE please check it",
    });
    expect(result.redactedSystem).toBe("You are an assistant.");
    expect(result.redactedUser).toContain("[REDACTED:");
    expect(result.redactedUser).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.count).toBe(1);
  });

  test("clean prompts produce count 0 and unchanged text", () => {
    const system = "You are a helpful assistant.";
    const user = "Summarize the milestone.";
    const result = redactBeforeSend({ systemPrompt: system, userPrompt: user });
    expect(result.redactedSystem).toBe(system);
    expect(result.redactedUser).toBe(user);
    expect(result.count).toBe(0);
  });

  test("sha256 hex hash is preserved (hash-shape exemption)", () => {
    // 64-char hex string matching sha256 output length — must NOT be redacted
    const sha256 = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";
    const result = redactBeforeSend({
      systemPrompt: `hash=${sha256}`,
      userPrompt: "plain text",
    });
    expect(result.redactedSystem).toContain(sha256);
    expect(result.count).toBe(0);
  });

  test("UUID is preserved (not redacted)", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const result = redactBeforeSend({
      systemPrompt: "id: " + uuid,
      userPrompt: "user message",
    });
    expect(result.redactedSystem).toContain(uuid);
    expect(result.count).toBe(0);
  });

  test("multiple secrets across both prompts are counted correctly", () => {
    // Two distinct AWS access key-ids — one per prompt
    const result = redactBeforeSend({
      systemPrompt: "key1=AKIAIOSFODNN7EXAMPLE",
      userPrompt: "key2=AKIAI44QH8DHBEXAMPLE",
    });
    expect(result.count).toBe(2);
    expect(result.redactedSystem).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.redactedUser).not.toContain("AKIAI44QH8DHBEXAMPLE");
  });

  test("returns redactedSystem, redactedUser and count fields", () => {
    const result = redactBeforeSend({
      systemPrompt: "sys",
      userPrompt: "usr",
    });
    expect(result).toHaveProperty("redactedSystem");
    expect(result).toHaveProperty("redactedUser");
    expect(result).toHaveProperty("count");
    expect(typeof result.count).toBe("number");
  });
});

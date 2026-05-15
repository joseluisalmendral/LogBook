import { describe, test, expect, vi, afterEach } from "vitest";
import { Readable } from "node:stream";

// RED: src/util/stdin.ts does not exist yet — this file is written first.
import { readAllStdin } from "../../src/util/stdin.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readAllStdin", () => {
  test("reads a small string from a Readable and returns it", async () => {
    const input = "hello from stdin\n";
    const readable = Readable.from([Buffer.from(input)]);

    // Replace process.stdin with our mock readable for the duration of the call.
    // readAllStdin accepts an optional override for testability.
    const result = await readAllStdin({ stream: readable });
    expect(result).toBe(input);
  });

  test("concatenates multiple chunks", async () => {
    const chunks = ["chunk1", " chunk2", " chunk3"];
    const readable = Readable.from(chunks.map((c) => Buffer.from(c)));

    const result = await readAllStdin({ stream: readable });
    expect(result).toBe("chunk1 chunk2 chunk3");
  });

  test("returns empty string when stream ends immediately (no data)", async () => {
    const readable = new Readable({ read() {} });
    readable.push(null); // EOF immediately

    const result = await readAllStdin({ stream: readable });
    expect(result).toBe("");
  });

  test("returns empty string on timeout when no data arrives", async () => {
    // Create a Readable that never emits data.
    const readable = new Readable({ read() {} });

    const result = await readAllStdin({ stream: readable, timeoutMs: 50 });
    expect(result).toBe("");
  });

  test("does NOT throw on timeout — resolves cleanly", async () => {
    const readable = new Readable({ read() {} });

    await expect(
      readAllStdin({ stream: readable, timeoutMs: 50 }),
    ).resolves.toBe("");
  });

  test("truncates to maxBytes when input exceeds the cap", async () => {
    const longString = "x".repeat(200);
    const readable = Readable.from([Buffer.from(longString)]);

    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await readAllStdin({ stream: readable, maxBytes: 100 });

    expect(result).toHaveLength(100);
    expect(result).toBe("x".repeat(100));
    // Must emit a console.error warning so callers can detect truncation.
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toMatch(/truncated/i);
  });

  test("does NOT throw on maxBytes exceeded — resolves with truncated string", async () => {
    const longString = "a".repeat(300);
    const readable = Readable.from([Buffer.from(longString)]);

    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      readAllStdin({ stream: readable, maxBytes: 50 }),
    ).resolves.toHaveLength(50);
  });
});

import { describe, expect, it } from "vitest";
import { detectLineEnding, fromLF, toLF } from "../../src/util/crlf.js";

describe("detectLineEnding", () => {
  it("returns lf for empty string", () => {
    expect(detectLineEnding("")).toBe("lf");
  });

  it("returns lf for pure LF content", () => {
    expect(detectLineEnding("a\nb\n")).toBe("lf");
  });

  it("returns crlf for pure CRLF content", () => {
    expect(detectLineEnding("a\r\nb\r\n")).toBe("crlf");
  });

  it("returns mixed when CRLF and lone LF coexist", () => {
    expect(detectLineEnding("a\r\nb\nc")).toBe("mixed");
  });

  it("returns lf for single line with no terminator", () => {
    expect(detectLineEnding("abc")).toBe("lf");
  });

  it("returns mixed for single CRLF followed by bare lone LF (lookbehind correctness)", () => {
    // "a\r\nb\n" — the \n after b is not preceded by \r → lone LF exists alongside CRLF
    expect(detectLineEnding("a\r\nb\n")).toBe("mixed");
  });
});

describe("toLF", () => {
  it("preserves LF input unchanged and reports original lf", () => {
    const src = "hello\nworld\n";
    const { content, original } = toLF(src);
    expect(content).toBe(src);
    expect(original).toBe("lf");
  });

  it("replaces all CRLF with LF and reports original crlf", () => {
    const src = "hello\r\nworld\r\n";
    const { content, original } = toLF(src);
    expect(content).toBe("hello\nworld\n");
    expect(original).toBe("crlf");
  });

  it("replaces all CRLF in mixed input and reports original mixed", () => {
    const src = "a\r\nb\nc";
    const { content, original } = toLF(src);
    expect(content).toBe("a\nb\nc");
    expect(original).toBe("mixed");
  });

  it("handles empty string — content empty and original lf", () => {
    const { content, original } = toLF("");
    expect(content).toBe("");
    expect(original).toBe("lf");
  });
});

describe("fromLF", () => {
  it("returns content unchanged for target lf", () => {
    const input = "hello\nworld\n";
    expect(fromLF(input, "lf")).toBe(input);
  });

  it("converts every LF to CRLF for target crlf", () => {
    const input = "hello\nworld\n";
    expect(fromLF(input, "crlf")).toBe("hello\r\nworld\r\n");
  });

  it("returns content unchanged for target mixed (best-effort: emit as LF)", () => {
    const input = "hello\nworld\n";
    expect(fromLF(input, "mixed")).toBe(input);
  });
});

describe("round-trip properties", () => {
  const lfFixtures = ["a\nb\n", "line1\nline2\nline3\n", "no-trailing-newline", "\n"];
  const crlfFixtures = ["a\r\nb\r\n", "line1\r\nline2\r\nline3\r\n", "\r\n"];

  for (const src of lfFixtures) {
    it(`LF round-trip preserves bytes exactly: ${JSON.stringify(src)}`, () => {
      const { content, original } = toLF(src);
      expect(original).toBe("lf");
      const restored = fromLF(content, original);
      expect(restored).toBe(src);
    });
  }

  for (const src of crlfFixtures) {
    it(`CRLF round-trip preserves bytes exactly: ${JSON.stringify(src)}`, () => {
      const { content, original } = toLF(src);
      expect(original).toBe("crlf");
      const restored = fromLF(content, original);
      expect(restored).toBe(src);
    });
  }
});

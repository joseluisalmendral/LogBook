import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  appendLines,
  removeLines,
  AnchorNotFoundError,
} from "../../src/util/line-set.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/gitignore");

function fix(name: string): string {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

const LINES = [".logbook/", "logbook/", "# lb-gitignore-001"];

describe("appendLines", () => {
  it("appends to empty source — no leading newline, trailingNewlineAdded=true", () => {
    const source = fix("empty");
    expect(source).toBe("");
    const { next, addedLeadingNewline, trailingNewlineAdded } = appendLines({
      source,
      lines: LINES,
    });
    expect(addedLeadingNewline).toBe(false);
    expect(trailingNewlineAdded).toBe(true);
    expect(next).toBe(LINES.join("\n") + "\n");
  });

  it("appends to source with trailing newline — no leading newline added", () => {
    const source = fix("with-trailing-newline");
    expect(source.endsWith("\n")).toBe(true);
    const { next, addedLeadingNewline, trailingNewlineAdded } = appendLines({
      source,
      lines: LINES,
    });
    expect(addedLeadingNewline).toBe(false);
    expect(trailingNewlineAdded).toBe(true);
    expect(next).toBe(source + LINES.join("\n") + "\n");
  });

  it("appends to source without trailing newline — addedLeadingNewline=true", () => {
    const source = fix("with-content");
    expect(source.endsWith("\n")).toBe(false);
    expect(source).not.toBe("");
    const { next, addedLeadingNewline, trailingNewlineAdded } = appendLines({
      source,
      lines: LINES,
    });
    expect(addedLeadingNewline).toBe(true);
    expect(trailingNewlineAdded).toBe(true);
    expect(next).toBe(source + "\n" + LINES.join("\n") + "\n");
  });
});

describe("removeLines — roundtrip byte-identity", () => {
  const fixtures = ["empty", "with-trailing-newline", "with-content"];

  for (const name of fixtures) {
    it(`append then remove is byte-identical for ${name}`, () => {
      const original = fix(name);
      const { next, addedLeadingNewline, trailingNewlineAdded } = appendLines({
        source: original,
        lines: LINES,
      });
      const restored = removeLines({
        source: next,
        lines: LINES,
        addedLeadingNewline,
        trailingNewlineAdded,
      });
      expect(restored).toBe(original);
    });
  }

  it("throws AnchorNotFoundError when lines are not present in source", () => {
    const source = fix("with-trailing-newline");
    expect(() =>
      removeLines({
        source,
        lines: LINES,
      })
    ).toThrow(AnchorNotFoundError);
  });
});

describe("CRLF fixture — documented behavior", () => {
  it("appendLines into CRLF file appends LF-joined lines (mixed-newline limitation)", () => {
    // gitignore is LF-only by convention. appendLines does NOT detect or
    // preserve CRLF — it always appends LF-joined content. This is a known
    // limitation documented here. The CRLF fixture tests current behavior.
    const source = fix("crlf");
    // source has \r\n endings
    expect(source).toContain("\r\n");
    const { next } = appendLines({ source, lines: LINES });
    // The appended block uses LF — this is mixed newlines. Documented.
    expect(next).toContain(LINES[0] + "\n");
    // The original CRLF bytes at the start are preserved (we don't mangle them)
    expect(next.startsWith(source)).toBe(true);
  });
});

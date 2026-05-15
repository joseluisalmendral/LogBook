import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  upsertMarkdownBlock,
  removeMarkdownBlock,
  AnchorAmbiguousError,
} from "../../src/util/markdown-block.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/markdown");

function fix(name: string): string {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

const CONTENT = "hello world";
const OPTS = { markerVersion: 1 };

const START = "<!-- logbook:generated start v=1 -->";
const END = "<!-- logbook:generated end -->";

describe("upsertMarkdownBlock", () => {
  it("empty.md — appends block, mode=appended, addedLeadingNewline=false", () => {
    const input = fix("empty.md");
    expect(input).toBe("");
    const { next, mode, addedLeadingNewline } = upsertMarkdownBlock(
      input,
      CONTENT,
      OPTS
    );
    expect(mode).toBe("appended");
    expect(addedLeadingNewline).toBe(false);
    expect(next).toBe(`${START}\n${CONTENT}\n${END}\n`);
  });

  it("no-block.md — appends block, mode=appended, addedLeadingNewline=false (ends with \\n)", () => {
    const input = fix("no-block.md");
    expect(input.endsWith("\n")).toBe(true);
    const { next, mode, addedLeadingNewline } = upsertMarkdownBlock(
      input,
      CONTENT,
      OPTS
    );
    expect(mode).toBe("appended");
    expect(addedLeadingNewline).toBe(false);
    expect(next).toBe(`${input}${START}\n${CONTENT}\n${END}\n`);
  });

  it("no-block-no-trailing-newline.md — appends block with leading newline", () => {
    const input = fix("no-block-no-trailing-newline.md");
    expect(input.endsWith("\n")).toBe(false);
    expect(input).not.toBe("");
    const { next, mode, addedLeadingNewline } = upsertMarkdownBlock(
      input,
      CONTENT,
      OPTS
    );
    expect(mode).toBe("appended");
    expect(addedLeadingNewline).toBe(true);
    expect(next).toBe(`${input}\n${START}\n${CONTENT}\n${END}\n`);
  });

  it("block-at-end.md — replaces block only, mode=replaced", () => {
    const input = fix("block-at-end.md");
    const { next, mode, addedLeadingNewline } = upsertMarkdownBlock(
      input,
      CONTENT,
      OPTS
    );
    expect(mode).toBe("replaced");
    expect(addedLeadingNewline).toBe(false);
    // Content before the block is preserved byte-for-byte
    const prefix = "# Title\n\nSome content here.\n";
    expect(next.startsWith(prefix)).toBe(true);
    expect(next).toBe(
      `${prefix}${START}\n${CONTENT}\n${END}\n`
    );
  });

  it("block-in-middle.md — replaces block, bottom content byte-identical", () => {
    const input = fix("block-in-middle.md");
    const { next, mode } = upsertMarkdownBlock(input, CONTENT, OPTS);
    expect(mode).toBe("replaced");
    // Content before block preserved
    expect(next.startsWith("# Top\n\n")).toBe(true);
    // Content after block preserved byte-for-byte
    expect(next.endsWith("\n\nBottom content.\n")).toBe(true);
    expect(next).toBe(
      `# Top\n\n${START}\n${CONTENT}\n${END}\n\nBottom content.\n`
    );
  });

  it("block-at-start.md — replaces block, rest of file preserved", () => {
    const input = fix("block-at-start.md");
    const { next, mode } = upsertMarkdownBlock(input, CONTENT, OPTS);
    expect(mode).toBe("replaced");
    expect(next).toBe(
      `${START}\n${CONTENT}\n${END}\n\nRest of file.\n`
    );
  });

  it("two-blocks.md — throws AnchorAmbiguousError", () => {
    const input = fix("two-blocks.md");
    expect(() => upsertMarkdownBlock(input, CONTENT, OPTS)).toThrow(
      AnchorAmbiguousError
    );
  });

  it("block-with-v2.md — regex matches v=2, mode=replaced", () => {
    // The finder regex matches any v=N. Replacing writes v=1 (current version).
    // This documents: removing/replacing matches any version marker.
    const input = fix("block-with-v2.md");
    const { next, mode } = upsertMarkdownBlock(input, CONTENT, OPTS);
    expect(mode).toBe("replaced");
    // New block uses markerVersion=1
    expect(next).toContain("start v=1");
    // Old v=2 is gone
    expect(next).not.toContain("start v=2");
  });
});

describe("removeMarkdownBlock — roundtrip byte-identity", () => {
  // For "no-block" fixtures (append mode): original → upsert → remove → original
  // This is the full install/uninstall roundtrip scenario.
  const appendModeFixtures: Array<{ name: string; expectedLeadingNewline: boolean }> = [
    { name: "empty.md", expectedLeadingNewline: false },
    { name: "no-block.md", expectedLeadingNewline: false },
    { name: "no-block-no-trailing-newline.md", expectedLeadingNewline: true },
  ];

  for (const { name, expectedLeadingNewline } of appendModeFixtures) {
    it(`append-mode roundtrip restores original for ${name}`, () => {
      const original = fix(name);
      const { next, addedLeadingNewline } = upsertMarkdownBlock(
        original,
        CONTENT,
        OPTS
      );
      expect(addedLeadingNewline).toBe(expectedLeadingNewline);
      const restored = removeMarkdownBlock(next, {
        markerVersion: 1,
        addedLeadingNewline,
      });
      expect(restored).toBe(original);
    });
  }

  // For "block present" fixtures (replace mode): the remove strips the block entirely.
  // The roundtrip removes the block from the upserted content, producing the file
  // without any block. We verify the surrounding bytes are preserved.
  it("replaced-mode: block-at-end.md — remove strips block, prefix preserved", () => {
    const original = fix("block-at-end.md");
    const { next, addedLeadingNewline } = upsertMarkdownBlock(original, CONTENT, OPTS);
    expect(addedLeadingNewline).toBe(false);
    const removed = removeMarkdownBlock(next, { markerVersion: 1, addedLeadingNewline });
    // Prefix before block is preserved
    expect(removed).toBe("# Title\n\nSome content here.\n");
  });

  it("replaced-mode: block-in-middle.md — remove strips block, prefix and suffix preserved", () => {
    const original = fix("block-in-middle.md");
    const { next, addedLeadingNewline } = upsertMarkdownBlock(original, CONTENT, OPTS);
    expect(addedLeadingNewline).toBe(false);
    const removed = removeMarkdownBlock(next, { markerVersion: 1, addedLeadingNewline });
    // Content before and after block is preserved
    expect(removed).toBe("# Top\n\n\n\nBottom content.\n");
  });

  it("replaced-mode: block-at-start.md — remove strips block, suffix preserved", () => {
    const original = fix("block-at-start.md");
    const { next, addedLeadingNewline } = upsertMarkdownBlock(original, CONTENT, OPTS);
    expect(addedLeadingNewline).toBe(false);
    const removed = removeMarkdownBlock(next, { markerVersion: 1, addedLeadingNewline });
    // Content after block preserved
    expect(removed).toBe("\n\nRest of file.\n");
  });

  it("replaced-mode: block-with-v2.md — remove strips updated block, prefix preserved", () => {
    const original = fix("block-with-v2.md");
    const { next, addedLeadingNewline } = upsertMarkdownBlock(original, CONTENT, OPTS);
    expect(addedLeadingNewline).toBe(false);
    const removed = removeMarkdownBlock(next, { markerVersion: 1, addedLeadingNewline });
    expect(removed).toBe("# Title\n\nSome content here.\n");
  });

  it("remove on input with no block is idempotent (returns unchanged)", () => {
    const input = fix("no-block.md");
    const result = removeMarkdownBlock(input, { markerVersion: 1 });
    expect(result).toBe(input);
  });

  it("remove on input with two blocks throws AnchorAmbiguousError", () => {
    const input = fix("two-blocks.md");
    expect(() =>
      removeMarkdownBlock(input, { markerVersion: 1 })
    ).toThrow(AnchorAmbiguousError);
  });
});

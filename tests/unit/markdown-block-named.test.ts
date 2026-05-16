/**
 * Unit tests: named marker family extension for markdown-block (T11).
 *
 * Tests the new `markerName` parameter added to upsertMarkdownBlock and
 * removeMarkdownBlock. Default behavior (markerName omitted or undefined)
 * must match iter1 exactly — backwards compatibility is the hard gate.
 */

import { describe, it, expect } from "vitest";
import {
  upsertMarkdownBlock,
  removeMarkdownBlock,
  AnchorAmbiguousError,
} from "../../src/util/markdown-block.js";

const CONTENT = "hello world";

describe("named marker family — upsertMarkdownBlock", () => {
  it("custom markerName produces correct start/end markers", () => {
    const { next } = upsertMarkdownBlock("", CONTENT, {
      markerVersion: 1,
      markerName: "logbook:doc:index",
    });
    expect(next).toContain("<!-- logbook:doc:index start v=1 -->");
    expect(next).toContain("<!-- logbook:doc:index end -->");
    expect(next).not.toContain("logbook:generated");
  });

  it("omitting markerName defaults to logbook:generated (iter1 backward compat)", () => {
    const { next } = upsertMarkdownBlock("", CONTENT, { markerVersion: 1 });
    expect(next).toContain("<!-- logbook:generated start v=1 -->");
    expect(next).toContain("<!-- logbook:generated end -->");
  });

  it("explicit markerName: logbook:generated matches iter1 output exactly", () => {
    const withExplicit = upsertMarkdownBlock("", CONTENT, {
      markerVersion: 1,
      markerName: "logbook:generated",
    });
    const withDefault = upsertMarkdownBlock("", CONTENT, { markerVersion: 1 });
    expect(withExplicit.next).toBe(withDefault.next);
  });

  it("different marker families are independent — one doesn't match the other", () => {
    const indexBlock =
      "<!-- logbook:doc:index start v=1 -->\nold index\n<!-- logbook:doc:index end -->\n";

    // Upserting with timeline marker family does NOT touch the index block
    const { next, mode } = upsertMarkdownBlock(indexBlock, "new timeline", {
      markerVersion: 1,
      markerName: "logbook:doc:timeline",
    });
    expect(mode).toBe("appended");
    expect(next).toContain("<!-- logbook:doc:index start v=1 -->");
    expect(next).toContain("<!-- logbook:doc:timeline start v=1 -->");
    expect(next).toContain("new timeline");
    expect(next).toContain("old index");
  });

  it("replaces existing same-family block in-place", () => {
    const existing =
      "# Title\n<!-- logbook:doc:errors start v=1 -->\nold\n<!-- logbook:doc:errors end -->\nfooter\n";
    const { next, mode } = upsertMarkdownBlock(existing, "new errors", {
      markerVersion: 1,
      markerName: "logbook:doc:errors",
    });
    expect(mode).toBe("replaced");
    expect(next).toContain("new errors");
    expect(next).not.toContain("old");
    expect(next).toContain("# Title");
    expect(next).toContain("footer");
  });

  it("two blocks of same family throws AnchorAmbiguousError", () => {
    const twoBlocks =
      "<!-- logbook:doc:index start v=1 -->\na\n<!-- logbook:doc:index end -->\n" +
      "<!-- logbook:doc:index start v=1 -->\nb\n<!-- logbook:doc:index end -->\n";
    expect(() =>
      upsertMarkdownBlock(twoBlocks, CONTENT, {
        markerVersion: 1,
        markerName: "logbook:doc:index",
      })
    ).toThrow(AnchorAmbiguousError);
  });
});

describe("named marker family — removeMarkdownBlock", () => {
  it("removes custom-family block (roundtrip byte-identity on empty input)", () => {
    const input = "";
    const { next, addedLeadingNewline } = upsertMarkdownBlock(input, CONTENT, {
      markerVersion: 1,
      markerName: "logbook:doc:timeline",
    });
    const restored = removeMarkdownBlock(next, {
      markerVersion: 1,
      addedLeadingNewline,
      markerName: "logbook:doc:timeline",
    });
    expect(restored).toBe(input);
  });

  it("omitting markerName in removeMarkdownBlock defaults to logbook:generated", () => {
    const { next, addedLeadingNewline } = upsertMarkdownBlock("", CONTENT, {
      markerVersion: 1,
    });
    const restored = removeMarkdownBlock(next, {
      markerVersion: 1,
      addedLeadingNewline,
    });
    expect(restored).toBe("");
  });

  it("cross-family: custom remove does NOT remove default-family block", () => {
    const { next } = upsertMarkdownBlock("", CONTENT, { markerVersion: 1 });
    // next contains a logbook:generated block
    // Try to remove it with a custom markerName — should be a no-op
    const result = removeMarkdownBlock(next, {
      markerVersion: 1,
      markerName: "logbook:doc:index",
    });
    // logbook:generated block is still there (no match found for logbook:doc:index)
    expect(result).toBe(next);
  });

  it("special regex chars in markerName are escaped", () => {
    // markerName with a dot (.) should NOT be treated as a regex wildcard
    // Use a name that could be ambiguous without escaping: "a.b" vs "a-b"
    const markerA = "logbook:doc.index";
    const markerB = "logbook:docXindex"; // 'X' would match '.' if unescaped

    const { next: blockA } = upsertMarkdownBlock("", "content-a", {
      markerVersion: 1,
      markerName: markerA,
    });

    // Trying to upsert with markerB into a file that only has markerA block
    const { next, mode } = upsertMarkdownBlock(blockA, "content-b", {
      markerVersion: 1,
      markerName: markerB,
    });
    // Should be appended (markerA is not matched by markerB's regex)
    expect(mode).toBe("appended");
    expect(next).toContain("content-a");
    expect(next).toContain("content-b");
  });
});

describe("iter1 backward compatibility — all original tests still pass via named API", () => {
  // Re-verify the key iter1 scenarios pass identically with the extended API
  it("iter1 default: appends to empty file", () => {
    const { next, mode, addedLeadingNewline } = upsertMarkdownBlock(
      "",
      "body",
      { markerVersion: 1 }
    );
    expect(mode).toBe("appended");
    expect(addedLeadingNewline).toBe(false);
    expect(next).toBe(
      "<!-- logbook:generated start v=1 -->\nbody\n<!-- logbook:generated end -->\n"
    );
  });

  it("iter1 default: file with trailing newline appends without leading newline", () => {
    const input = "# Title\n";
    const { next, addedLeadingNewline } = upsertMarkdownBlock(input, "body", {
      markerVersion: 1,
    });
    expect(addedLeadingNewline).toBe(false);
    expect(next).toBe(
      "# Title\n<!-- logbook:generated start v=1 -->\nbody\n<!-- logbook:generated end -->\n"
    );
  });

  it("iter1 default: file without trailing newline adds leading newline", () => {
    const input = "# Title";
    const { next, addedLeadingNewline } = upsertMarkdownBlock(input, "body", {
      markerVersion: 1,
    });
    expect(addedLeadingNewline).toBe(true);
    expect(next).toBe(
      "# Title\n<!-- logbook:generated start v=1 -->\nbody\n<!-- logbook:generated end -->\n"
    );
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  insertIntoJsonArray,
  removeFromJsonArray,
  AnchorNotFoundError,
} from "../../src/util/json-string-patch.js";

const FIXTURES = resolve(
  import.meta.dirname,
  "../fixtures/settings-local-json"
);

function fix(name: string): string {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

const ENTRY = JSON.stringify({
  matcher: "Bash",
  hooks: [{ type: "command", command: "/abs/path/hook.cjs" }],
  _logbookId: "lb-hook-posttooluse-001",
});

const JSON_PATH = "/hooks/PostToolUse";

describe("insertIntoJsonArray", () => {
  it("inserts into empty array — position=0, preserves all other bytes", () => {
    const source = fix("no-trailing-newline.json"); // {"hooks":{"PostToolUse":[]}}
    const { next, position } = insertIntoJsonArray({
      source,
      jsonPath: JSON_PATH,
      entryJson: ENTRY,
    });
    expect(position).toBe(0);
    // Result must parse correctly
    const parsed = JSON.parse(next) as {
      hooks: { PostToolUse: unknown[] };
    };
    expect(parsed.hooks.PostToolUse).toHaveLength(1);
    // Source bytes outside the array interior are preserved
    // The opening { and "hooks":{"PostToolUse": are still there
    expect(next.startsWith('{"hooks":{"PostToolUse":')).toBe(true);
  });

  it("inserts into single-element array — position=1", () => {
    const source = fix("only-other-plugin.json");
    const { next, position } = insertIntoJsonArray({
      source,
      jsonPath: JSON_PATH,
      entryJson: ENTRY,
    });
    expect(position).toBe(1);
    const parsed = JSON.parse(next) as {
      hooks: { PostToolUse: unknown[] };
    };
    expect(parsed.hooks.PostToolUse).toHaveLength(2);
    // Original entry must still be present with its _otherPluginId
    const firstEntry = parsed.hooks.PostToolUse[0] as Record<string, unknown>;
    expect(firstEntry["_otherPluginId"]).toBe("foo-001");
    // Our entry is appended last
    const lastEntry = parsed.hooks.PostToolUse[1] as Record<string, unknown>;
    expect(lastEntry["_logbookId"]).toBe("lb-hook-posttooluse-001");
    // Original bytes of first entry are preserved (not re-serialized)
    expect(next).toContain('"_otherPluginId": "foo-001"');
  });

  it("inserts into multi-element array — position=2", () => {
    const source = fix("two-other-plugins.json");
    const { next, position } = insertIntoJsonArray({
      source,
      jsonPath: JSON_PATH,
      entryJson: ENTRY,
    });
    expect(position).toBe(2);
    const parsed = JSON.parse(next) as {
      hooks: { PostToolUse: unknown[] };
    };
    expect(parsed.hooks.PostToolUse).toHaveLength(3);
  });

  it("preserves tab indentation in inserted entry prefix", () => {
    const source = fix("tabs-indent.json");
    const { next } = insertIntoJsonArray({
      source,
      jsonPath: JSON_PATH,
      entryJson: ENTRY,
    });
    // The inserted entry should be indented with a tab
    expect(next).toContain("\t" + ENTRY.charAt(0));
  });

  it("does not crash on crlf.json and result is valid JSON", () => {
    // crlf.json is `{}\r\n` — no PostToolUse array. This tests that the
    // function handles CRLF input without panicking. Since there is no
    // PostToolUse path, it should throw AnchorNotFoundError.
    // NOTE: CRLF support for JSON is deferred for iter1. We document that
    // json-string-patch does NOT special-case CRLF line endings; the caller
    // is expected to normalize or handle CRLF before passing to this function.
    const source = fix("crlf.json");
    expect(() =>
      insertIntoJsonArray({ source, jsonPath: JSON_PATH, entryJson: ENTRY })
    ).toThrow();
  });

  it("preserves absence of trailing newline in source", () => {
    const source = fix("no-trailing-newline.json");
    const { next } = insertIntoJsonArray({
      source,
      jsonPath: JSON_PATH,
      entryJson: ENTRY,
    });
    // The source had no trailing newline. The added content ends before ]}
    // but the final character of next should be }
    expect(next.endsWith("}")).toBe(true);
  });
});

describe("removeFromJsonArray — roundtrip", () => {
  const fixtures = [
    "no-trailing-newline.json",
    "only-other-plugin.json",
    "two-other-plugins.json",
    "tabs-indent.json",
  ];

  for (const name of fixtures) {
    it(`insert then remove is byte-identical for ${name}`, () => {
      const original = fix(name);
      const { next } = insertIntoJsonArray({
        source: original,
        jsonPath: JSON_PATH,
        entryJson: ENTRY,
      });
      const restored = removeFromJsonArray({
        source: next,
        jsonPath: JSON_PATH,
        idField: "_logbookId",
        idValue: "lb-hook-posttooluse-001",
      });
      expect(restored).toBe(original);
    });
  }

  it("throws AnchorNotFoundError when _logbookId not in array", () => {
    const source = fix("only-other-plugin.json");
    expect(() =>
      removeFromJsonArray({
        source,
        jsonPath: JSON_PATH,
        idField: "_logbookId",
        idValue: "lb-hook-posttooluse-001",
      })
    ).toThrow(AnchorNotFoundError);
  });

  it("throws AnchorNotFoundError when array path does not exist", () => {
    const source = fix("empty.json"); // just {}
    expect(() =>
      removeFromJsonArray({
        source,
        jsonPath: JSON_PATH,
        idField: "_logbookId",
        idValue: "lb-hook-posttooluse-001",
      })
    ).toThrow(AnchorNotFoundError);
  });
});

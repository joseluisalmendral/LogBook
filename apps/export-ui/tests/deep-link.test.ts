/*
 * Unit tests for deep-link.ts — slice 12 P3 Bucket C.
 *
 * Covers detectors (SHA / file path / session id), URI builders (file / warp /
 * resume command), the selection param convention, and the linkifyText
 * sanitize-and-wrap path. INV-19 honesty checks live in the dedicated suite
 * that grep-asserts NO `claude://` or `warp://claude-resume` strings appear in
 * any emitted URI.
 */

import { describe, expect, it } from "vitest";
import {
  buildFileUri,
  buildResumeCommand,
  buildWarpTabUri,
  detectFilePath,
  detectSessionId,
  detectSha,
  linkifyText,
  selectionParam,
} from "../src/lib/util/deep-link";

describe("detectSha", () => {
  it("returns empty array for empty / non-string input", () => {
    expect(detectSha("")).toEqual([]);
    expect(detectSha(undefined as unknown as string)).toEqual([]);
  });

  it("detects a 7-char short SHA inside prose", () => {
    expect(detectSha("see commit 4897cf7 for context")).toEqual(["4897cf7"]);
  });

  it("detects a full 40-char SHA", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(detectSha(`HEAD is at ${sha}`)).toEqual([sha]);
  });

  it("de-duplicates repeated SHAs", () => {
    expect(detectSha("4897cf7 again 4897cf7 again")).toEqual(["4897cf7"]);
  });

  it("rejects shorter hex tokens (< 7 chars)", () => {
    expect(detectSha("ref abc123 is too short")).toEqual([]);
  });
});

describe("detectFilePath", () => {
  it("returns empty array for empty input", () => {
    expect(detectFilePath("")).toEqual([]);
  });

  it("detects a relative path with line + col", () => {
    expect(detectFilePath("see src/foo.ts:42:7 for the bug")).toEqual([
      { path: "src/foo.ts", line: 42, col: 7 },
    ]);
  });

  it("detects an absolute path with only a line number", () => {
    expect(detectFilePath("open /Users/me/x/main.go:99 please")).toEqual([
      { path: "/Users/me/x/main.go", line: 99 },
    ]);
  });

  it("accepts a bare filename only when the extension is code-ish", () => {
    expect(detectFilePath("look at README.md right there")).toEqual([
      { path: "README.md" },
    ]);
    // bare filename with non-code extension must be rejected
    expect(detectFilePath("see report.docx for the writeup")).toEqual([]);
  });

  it("ignores URLs (http / https / file)", () => {
    // The leading colon in `https:` is not in our boundary leader set, so the
    // path regex must not produce a stray match for `//github.com/...`
    expect(detectFilePath("see https://github.com/x/y.git for source")).toEqual(
      [],
    );
  });

  it("de-duplicates identical path:line:col triples", () => {
    expect(detectFilePath("a/b.ts:1 and a/b.ts:1 again")).toEqual([
      { path: "a/b.ts", line: 1 },
    ]);
  });
});

describe("detectSessionId", () => {
  it("returns empty array for empty input", () => {
    expect(detectSessionId("")).toEqual([]);
  });

  it("detects a UUID-shaped session id in prose", () => {
    const id = "a1b2c3d4-1111-2222-3333-444455556666";
    expect(detectSessionId(`session ${id} is active`)).toEqual([id]);
  });

  it("is case-insensitive on hex", () => {
    const id = "A1B2C3D4-1111-2222-3333-444455556666";
    expect(detectSessionId(`Session ${id}`)).toEqual([id]);
  });

  it("rejects shapes that are not 8-4-4-4-12", () => {
    expect(detectSessionId("aaaa-bbbb-cccc nope")).toEqual([]);
  });
});

describe("buildFileUri", () => {
  it("builds the bare vscode://file/ URI without line/col", () => {
    expect(buildFileUri("/abs/path/foo.ts")).toBe(
      "vscode://file//abs/path/foo.ts",
    );
  });

  it("appends :line when provided", () => {
    expect(buildFileUri("/abs/foo.ts", 12)).toBe(
      "vscode://file//abs/foo.ts:12",
    );
  });

  it("appends :line:col when both provided", () => {
    expect(buildFileUri("/abs/foo.ts", 12, 4)).toBe(
      "vscode://file//abs/foo.ts:12:4",
    );
  });

  it("ignores col when line is missing", () => {
    // Col without line is malformed in vscode://; behavior: skip the suffix.
    expect(buildFileUri("/abs/foo.ts", undefined, 4)).toBe(
      "vscode://file//abs/foo.ts",
    );
  });
});

describe("buildResumeCommand", () => {
  it("produces the exact `claude --resume <id>` payload (no URI scheme)", () => {
    const id = "a1b2c3d4-1111-2222-3333-444455556666";
    expect(buildResumeCommand(id)).toBe(`claude --resume ${id}`);
  });

  it("does not fabricate a claude:// scheme (INV-19)", () => {
    expect(buildResumeCommand("anything")).not.toContain("claude://");
  });
});

describe("buildWarpTabUri", () => {
  it("encodes the project root path", () => {
    expect(buildWarpTabUri("/Users/me/My Project")).toBe(
      "warp://action/new_tab?path=%2FUsers%2Fme%2FMy%20Project",
    );
  });

  it("does not fabricate a warp://claude-resume scheme (INV-19)", () => {
    expect(buildWarpTabUri("/x")).not.toContain("warp://claude-resume");
  });
});

describe("selectionParam", () => {
  it("returns ?event=<encoded>", () => {
    expect(selectionParam("event-1")).toBe("?event=event-1");
  });

  it("URL-encodes special characters", () => {
    expect(selectionParam("a b/c?")).toBe("?event=a%20b%2Fc%3F");
  });
});

describe("linkifyText", () => {
  it("returns empty html for empty input", () => {
    expect(linkifyText("")).toEqual({ html: "" });
  });

  it("HTML-escapes plain prose with no matches", () => {
    expect(linkifyText("hello <world> & \"friends\"").html).toBe(
      "hello &lt;world&gt; &amp; &quot;friends&quot;",
    );
  });

  it("wraps a file-path in an anchor with target+rel attributes", () => {
    const { html } = linkifyText("open src/foo.ts:42 for the fix");
    expect(html).toContain('href="vscode://file/src/foo.ts:42"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">src/foo.ts:42</a>");
  });

  it("preserves surrounding prose un-rewritten", () => {
    const { html } = linkifyText("see src/foo.ts here");
    // The leading "see " must be preserved verbatim, and the trailing " here"
    // too. We assert both halves appear and that no double-escape happens.
    expect(html.startsWith("see ")).toBe(true);
    expect(html.endsWith(" here")).toBe(true);
  });

  it("never emits a claude:// or warp://claude-resume scheme (INV-19)", () => {
    const { html } = linkifyText("path src/a.ts and uuid not-applicable");
    expect(html).not.toContain("claude://");
    expect(html).not.toContain("warp://claude-resume");
  });
});

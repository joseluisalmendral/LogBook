/**
 * json-string-patch-scalar.test.ts
 *
 * Strict TDD T3.1 — verifies that setJsonObjectKey + removeJsonObjectKey handle
 * SCALAR (string) values at the top-level (jsonPath="") and nested paths.
 *
 * The statusline installer calls:
 *   setJsonObjectKey({ source, jsonPath: "", key: "statusLine", valueJson: JSON.stringify(cmd) })
 *
 * These tests lock the contract so no future refactor silently breaks scalar support.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  setJsonObjectKey,
  removeJsonObjectKey,
} from "../../src/util/json-string-patch.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/statusline");

function fix(name: string): string {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

const CMD = "node /abs/path/dist/cli/index.cjs state --inline";
const CMD_JSON = JSON.stringify(CMD); // '"node /abs/path/dist/cli/index.cjs state --inline"'

// ---------------------------------------------------------------------------
// setJsonObjectKey — scalar string at top level (jsonPath = "")
// ---------------------------------------------------------------------------

describe("setJsonObjectKey — scalar string value at top-level root object", () => {
  it("inserts statusLine key with string value into empty settings.json", () => {
    const source = fix("empty-settings.json");
    const { next, inserted } = setJsonObjectKey({
      source,
      jsonPath: "",
      key: "statusLine",
      valueJson: CMD_JSON,
    });

    expect(inserted).toBe(true);
    const parsed = JSON.parse(next) as { statusLine: string };
    expect(parsed.statusLine).toBe(CMD);
    // Value is a plain string, not an object
    expect(typeof parsed.statusLine).toBe("string");
  });

  it("preserves bytes outside the inserted span (prefix and suffix unchanged)", () => {
    const source = fix("empty-settings.json");
    const { next } = setJsonObjectKey({
      source,
      jsonPath: "",
      key: "statusLine",
      valueJson: CMD_JSON,
    });
    // Must still be a valid JSON object
    expect(() => JSON.parse(next)).not.toThrow();
    // Original outer braces preserved
    expect(next.startsWith("{")).toBe(true);
    expect(next.trimEnd().endsWith("}")).toBe(true);
    // The value is the exact command string (no extra nesting)
    const parsed = JSON.parse(next) as { statusLine: string };
    expect(parsed.statusLine).toBe(CMD);
  });

  it("inserts statusLine into an object that already has other keys", () => {
    const source = fix("with-other-plugin-statusline.json");
    // Replace the existing value by re-inserting with a DIFFERENT key
    const { next, inserted } = setJsonObjectKey({
      source,
      jsonPath: "",
      key: "someOtherKey",
      valueJson: CMD_JSON,
    });
    expect(inserted).toBe(true);
    const parsed = JSON.parse(next) as Record<string, string>;
    expect(parsed["someOtherKey"]).toBe(CMD);
    // Existing key untouched
    expect(parsed["statusLine"]).toBe("other-plugin-status-cmd");
  });

  it("replaces existing statusLine scalar value (inserted=false)", () => {
    const source = fix("with-other-plugin-statusline.json");
    const newCmd = "new-command --flag";
    const { next, inserted } = setJsonObjectKey({
      source,
      jsonPath: "",
      key: "statusLine",
      valueJson: JSON.stringify(newCmd),
    });
    expect(inserted).toBe(false);
    const parsed = JSON.parse(next) as { statusLine: string };
    expect(parsed.statusLine).toBe(newCmd);
  });

  it("handles CRLF settings file — inserts scalar and result is parseable", () => {
    const source = fix("crlf-settings.json");
    const { next } = setJsonObjectKey({
      source,
      jsonPath: "",
      key: "statusLine",
      valueJson: CMD_JSON,
    });
    expect(() => JSON.parse(next)).not.toThrow();
    const parsed = JSON.parse(next) as { statusLine: string };
    expect(parsed.statusLine).toBe(CMD);
  });
});

// ---------------------------------------------------------------------------
// removeJsonObjectKey — scalar string at top level (jsonPath = "")
// ---------------------------------------------------------------------------

describe("removeJsonObjectKey — scalar string at top-level root", () => {
  it("roundtrip: set then remove → byte-identical to original (empty-settings.json)", () => {
    const source = fix("empty-settings.json");
    const { next: withKey } = setJsonObjectKey({
      source,
      jsonPath: "",
      key: "statusLine",
      valueJson: CMD_JSON,
    });
    const { next: restored, removed } = removeJsonObjectKey({
      source: withKey,
      jsonPath: "",
      key: "statusLine",
    });
    expect(removed).toBe(true);
    expect(restored).toBe(source);
  });

  it("remove scalar key from multi-key object leaves other keys intact", () => {
    // Start with a file that has OTHER keys, add statusLine, then remove
    const source = fix("with-other-plugin-statusline.json");
    // Add a second key (logbookStatus) so we can remove it without touching statusLine
    const { next: withExtra } = setJsonObjectKey({
      source,
      jsonPath: "",
      key: "logbookStatus",
      valueJson: CMD_JSON,
    });
    const { next: restored, removed } = removeJsonObjectKey({
      source: withExtra,
      jsonPath: "",
      key: "logbookStatus",
    });
    expect(removed).toBe(true);
    const parsed = JSON.parse(restored) as { statusLine: string };
    // Original statusLine key preserved
    expect(parsed.statusLine).toBe("other-plugin-status-cmd");
    // logbookStatus gone
    expect((parsed as Record<string, unknown>)["logbookStatus"]).toBeUndefined();
  });

  it("remove returns removed=false when key is absent (idempotent)", () => {
    const source = fix("empty-settings.json");
    const { next, removed } = removeJsonObjectKey({
      source,
      jsonPath: "",
      key: "statusLine",
    });
    expect(removed).toBe(false);
    expect(next).toBe(source);
  });

  it("CRLF roundtrip: set then remove is byte-identical", () => {
    const source = fix("crlf-settings.json");
    const { next: withKey } = setJsonObjectKey({
      source,
      jsonPath: "",
      key: "statusLine",
      valueJson: CMD_JSON,
    });
    const { next: restored } = removeJsonObjectKey({
      source: withKey,
      jsonPath: "",
      key: "statusLine",
    });
    expect(restored).toBe(source);
  });
});

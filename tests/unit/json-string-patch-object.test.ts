import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  setJsonObjectKey,
  removeJsonObjectKey,
  AnchorNotFoundError,
} from "../../src/util/json-string-patch.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/mcp-json");

function fix(name: string): string {
  return readFileSync(resolve(FIXTURES, name), "utf8");
}

/** The logbook MCP server entry we insert in most tests. */
const LOGBOOK_KEY = "logbook-mcp";
const LOGBOOK_VALUE = JSON.stringify({
  type: "stdio",
  command: "node",
  args: ["/abs/srv.cjs"],
  _logbookId: "lb-mcp-001",
});
const MCP_PATH = "/mcpServers";

// ---------------------------------------------------------------------------
// setJsonObjectKey — insert when key does not exist
// ---------------------------------------------------------------------------

describe("setJsonObjectKey — insert (key absent)", () => {
  it("inserts into empty mcpServers object", () => {
    const source = fix("empty.json");
    const { next, inserted } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    expect(inserted).toBe(true);
    // mcpServers no longer empty
    const parsed = JSON.parse(next) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers[LOGBOOK_KEY]).toBeDefined();
    // outer bytes preserved: source starts with {"mcpServers":
    expect(next.startsWith('{"mcpServers"')).toBe(true);
    // ends with newline (original fixture ends with \n)
    expect(next.endsWith("\n")).toBe(true);
  });

  it("inserts after existing entry in with-other-mcp-server.json", () => {
    const source = fix("with-other-mcp-server.json");
    const { next, inserted } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    expect(inserted).toBe(true);

    // other-plugin entry's bytes are preserved verbatim
    expect(next).toContain('"_otherPluginId": "op-001"');

    // new entry is present
    const parsed = JSON.parse(next) as { mcpServers: Record<string, unknown> };
    const keys = Object.keys(parsed.mcpServers);
    expect(keys).toContain("other-plugin");
    expect(keys).toContain(LOGBOOK_KEY);

    // other-plugin appears BEFORE logbook-mcp (we append after last)
    expect(next.indexOf('"other-plugin"')).toBeLessThan(next.indexOf('"logbook-mcp"'));

    // Opening braces and structural bytes outside the edit preserved
    expect(next).toContain('"mcpServers": {');
  });

  it("inserts as third entry in with-two-other-servers.json", () => {
    const source = fix("with-two-other-servers.json");
    const { next, inserted } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    expect(inserted).toBe(true);

    // Both pre-existing entries unchanged byte-for-byte
    expect(next).toContain('"_pluginAId": "pa-001"');
    expect(next).toContain('"_pluginBId": "pb-001"');

    const parsed = JSON.parse(next) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(parsed.mcpServers)).toHaveLength(3);
  });

  it("inserts with TAB indentation in tabs-indent.json", () => {
    const source = fix("tabs-indent.json");
    const { next, inserted } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    expect(inserted).toBe(true);

    // The new entry line must use tab indentation (cosmetic verification)
    const newEntryLine = next
      .split("\n")
      .find((l) => l.includes('"logbook-mcp"'));
    expect(newEntryLine).toBeDefined();
    expect(newEntryLine!.startsWith("\t\t")).toBe(true);

    const parsed = JSON.parse(next) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers[LOGBOOK_KEY]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// setJsonObjectKey — replace existing key
// ---------------------------------------------------------------------------

describe("setJsonObjectKey — replace (key present)", () => {
  it("replaces other-plugin value, inserted=false, surrounding bytes preserved", () => {
    const source = fix("with-other-mcp-server.json");
    const newValue = JSON.stringify({ type: "stdio", command: "python3", args: ["/new.py"] });
    const { next, inserted } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: "other-plugin",
      valueJson: newValue,
    });
    expect(inserted).toBe(false);

    // Old value is gone
    expect(next).not.toContain('"_otherPluginId": "op-001"');

    // New value is present
    expect(next).toContain('"python3"');

    // Key name preserved in source (the "other-plugin" string is at the same position)
    expect(next).toContain('"other-plugin"');

    // Outer structure bytes preserved
    expect(next).toContain('"mcpServers": {');

    // Parseable
    const parsed = JSON.parse(next) as { mcpServers: Record<string, unknown> };
    const entry = parsed.mcpServers["other-plugin"] as Record<string, unknown>;
    expect(entry["command"]).toBe("python3");
  });

  it("replaces logbook-mcp after a prior insert, inserted=false", () => {
    const source = fix("empty.json");
    // First insert
    const { next: afterInsert } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    // Now replace
    const newValue = JSON.stringify({ type: "stdio", command: "deno", args: [] });
    const { next: afterReplace, inserted } = setJsonObjectKey({
      source: afterInsert,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: newValue,
    });
    expect(inserted).toBe(false);
    const parsed = JSON.parse(afterReplace) as { mcpServers: Record<string, unknown> };
    const entry = parsed.mcpServers[LOGBOOK_KEY] as Record<string, unknown>;
    expect(entry["command"]).toBe("deno");
  });
});

// ---------------------------------------------------------------------------
// removeJsonObjectKey — key present
// ---------------------------------------------------------------------------

describe("removeJsonObjectKey — key present", () => {
  it("roundtrip: empty.json → insert → remove → byte-identical to original", () => {
    const source = fix("empty.json");
    const { next: afterInsert } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    const { next: afterRemove, removed } = removeJsonObjectKey({
      source: afterInsert,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
    });
    expect(removed).toBe(true);
    expect(afterRemove).toBe(source);
  });

  it("roundtrip: with-other-mcp-server.json → insert → remove → byte-identical", () => {
    const source = fix("with-other-mcp-server.json");
    const { next: afterInsert } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    const { next: afterRemove, removed } = removeJsonObjectKey({
      source: afterInsert,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
    });
    expect(removed).toBe(true);
    expect(afterRemove).toBe(source);
  });

  it("roundtrip: with-two-other-servers.json → insert → remove → byte-identical", () => {
    const source = fix("with-two-other-servers.json");
    const { next: afterInsert } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    const { next: afterRemove, removed } = removeJsonObjectKey({
      source: afterInsert,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
    });
    expect(removed).toBe(true);
    expect(afterRemove).toBe(source);
  });

  it("roundtrip: tabs-indent.json → insert → remove → byte-identical", () => {
    const source = fix("tabs-indent.json");
    const { next: afterInsert } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    const { next: afterRemove, removed } = removeJsonObjectKey({
      source: afterInsert,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
    });
    expect(removed).toBe(true);
    expect(afterRemove).toBe(source);
  });

  it("removes the only key, leaving {} equivalent in mcpServers", () => {
    const source = fix("empty.json");
    // Insert then remove the only key
    const { next: afterInsert } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    const { next: afterRemove } = removeJsonObjectKey({
      source: afterInsert,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
    });
    // mcpServers should be empty again (no stray comma or whitespace surprises)
    const parsed = JSON.parse(afterRemove) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(parsed.mcpServers)).toHaveLength(0);
  });

  it("remove existing other-plugin key from with-other-mcp-server.json, removed=true", () => {
    const source = fix("with-other-mcp-server.json");
    const { next, removed } = removeJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: "other-plugin",
    });
    expect(removed).toBe(true);
    const parsed = JSON.parse(next) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(parsed.mcpServers)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// removeJsonObjectKey — key absent (idempotent)
// ---------------------------------------------------------------------------

describe("removeJsonObjectKey — key absent (idempotent)", () => {
  it("returns removed=false and unchanged source for empty.json", () => {
    const source = fix("empty.json");
    const { next, removed } = removeJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
    });
    expect(removed).toBe(false);
    expect(next).toBe(source);
  });

  it("returns removed=false when key not present in with-other-mcp-server.json", () => {
    const source = fix("with-other-mcp-server.json");
    const { next, removed } = removeJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
    });
    expect(removed).toBe(false);
    expect(next).toBe(source);
  });
});

// ---------------------------------------------------------------------------
// Escape correctness
// ---------------------------------------------------------------------------

describe("escape correctness", () => {
  it("key with special chars is JSON-encoded on insert and matched on remove", () => {
    const source = fix("empty.json");
    const specialKey = 'server-with-special:char"and\\backslash';
    const value = JSON.stringify({ type: "stdio", command: "node", args: [] });

    const { next: afterInsert, inserted } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: specialKey,
      valueJson: value,
    });
    expect(inserted).toBe(true);

    // Must parse cleanly
    const parsed = JSON.parse(afterInsert) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers[specialKey]).toBeDefined();

    // Remove by the same logical key
    const { next: afterRemove, removed } = removeJsonObjectKey({
      source: afterInsert,
      jsonPath: MCP_PATH,
      key: specialKey,
    });
    expect(removed).toBe(true);
    expect(afterRemove).toBe(source);
  });
});

// ---------------------------------------------------------------------------
// weird-formatting fixture — insert is parseable; bytes outside edit preserved
// ---------------------------------------------------------------------------

describe("weird-formatting fixture", () => {
  it("inserts logbook-mcp into compact inline mcpServers object", () => {
    const source = fix("weird-formatting.json");
    const { next, inserted } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    expect(inserted).toBe(true);

    // Must be parseable
    const parsed = JSON.parse(next) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers[LOGBOOK_KEY]).toBeDefined();

    // Original quirky-server bytes preserved
    expect(next).toContain('"_quirkyId":"q-001"');
  });

  it("roundtrip: weird-formatting.json → insert → remove → byte-identical", () => {
    const source = fix("weird-formatting.json");
    const { next: afterInsert } = setJsonObjectKey({
      source,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
      valueJson: LOGBOOK_VALUE,
    });
    const { next: afterRemove } = removeJsonObjectKey({
      source: afterInsert,
      jsonPath: MCP_PATH,
      key: LOGBOOK_KEY,
    });
    expect(afterRemove).toBe(source);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("error cases", () => {
  it("setJsonObjectKey throws AnchorNotFoundError when jsonPath does not exist", () => {
    const source = fix("empty.json");
    expect(() =>
      setJsonObjectKey({
        source,
        jsonPath: "/nonExistentPath",
        key: LOGBOOK_KEY,
        valueJson: LOGBOOK_VALUE,
      })
    ).toThrow(AnchorNotFoundError);
  });

  it("setJsonObjectKey throws on invalid valueJson", () => {
    const source = fix("empty.json");
    expect(() =>
      setJsonObjectKey({
        source,
        jsonPath: MCP_PATH,
        key: LOGBOOK_KEY,
        valueJson: "{ not valid json",
      })
    ).toThrow();
  });
});

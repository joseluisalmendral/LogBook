import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readState, writeState, defaultState, type LogBookState } from "../../src/core/state.js";

let tmpDir: string;
let canonicalTmp: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-state-"));
  canonicalTmp = fs.realpathSync(tmpDir);
  statePath = path.join(canonicalTmp, "state.json");
});

afterEach(() => {
  fs.rmSync(canonicalTmp, { recursive: true, force: true });
});

describe("defaultState", () => {
  it("returns a valid state with expected shape", () => {
    const s = defaultState();
    expect(s.version).toBe(1);
    expect(s.disabled).toBe(false);
    expect(s.warnings).toEqual([]);
    expect(s.staleLocksReleased).toBe(0);
    expect(s.lastError).toBeUndefined();
  });
});

describe("readState", () => {
  it("returns defaultState when file is missing", () => {
    const s = readState(statePath);
    expect(s).toEqual(defaultState());
  });

  it("returns defaultState when file contains malformed JSON", () => {
    fs.writeFileSync(statePath, "not-json{{{");
    const s = readState(statePath);
    expect(s).toEqual(defaultState());
  });

  it("returns defaultState when file is empty", () => {
    fs.writeFileSync(statePath, "");
    const s = readState(statePath);
    expect(s).toEqual(defaultState());
  });
});

describe("writeState + readState roundtrip", () => {
  it("preserves all fields after a write-read cycle", () => {
    const state: LogBookState = {
      version: 1,
      disabled: true,
      lastError: { code: "SOME_ERR", message: "something went wrong", at: "2026-01-01T00:00:00Z" },
      warnings: ["warn1", "warn2"],
      staleLocksReleased: 3,
    };
    writeState(statePath, state);
    const loaded = readState(statePath);
    expect(loaded).toEqual(state);
  });

  it("creates parent directories if they don't exist", () => {
    const nestedPath = path.join(canonicalTmp, "nested", "dir", "state.json");
    const s = defaultState();
    writeState(nestedPath, s);
    expect(fs.existsSync(nestedPath)).toBe(true);
    expect(readState(nestedPath)).toEqual(s);
  });

  it("overwrites existing state correctly", () => {
    writeState(statePath, defaultState());
    const updated: LogBookState = { ...defaultState(), disabled: true, staleLocksReleased: 7 };
    writeState(statePath, updated);
    expect(readState(statePath)).toEqual(updated);
  });
});

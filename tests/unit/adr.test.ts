/**
 * Unit tests for src/generate/adr.ts — T9 (Strict TDD RED phase).
 *
 * Tests slugify, renderAdr, and writeAdrFile in isolation using a tmp dir.
 * No MCP server involved; these are pure functions + file I/O only.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { slugify, renderAdr, writeAdrFile } from "../../src/generate/adr.js";
import { makePaths } from "../../src/core/paths.js";
import { readState } from "../../src/core/state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(): ReturnType<typeof makePaths> {
  const root = join(
    tmpdir(),
    `logbook-adr-test-${randomBytes(6).toString("hex")}`,
  );
  mkdirSync(join(root, ".logbook"), { recursive: true });
  // package.json makes resolveProjectRoot happy (not needed here but consistent)
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", version: "0.0.0" }));
  return makePaths(root);
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("converts a normal sentence to kebab-case", () => {
    expect(slugify("Switched from sessions to JWT")).toBe("switched-from-sessions-to-jwt");
  });

  it("strips non-ASCII punctuation like !", () => {
    expect(slugify("Use Vite!")).toBe("use-vite");
  });

  it("collapses multiple separators and strips leading/trailing dashes", () => {
    expect(slugify("  spaces and  weird---chars___")).toBe("spaces-and-weird-chars");
  });

  it("truncates at 50 chars and does not leave a trailing dash", () => {
    const long = "A really long decision title that exceeds the fifty character maximum we set";
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith("-")).toBe(false);
  });

  it("strips non-ASCII characters (ñ, é, ü)", () => {
    expect(slugify("Decision with ñ and é and ü")).toBe("decision-with-and-and");
  });

  it("returns 'untitled' for an empty title", () => {
    expect(slugify("")).toBe("untitled");
  });

  it("returns 'untitled' for all-punctuation titles", () => {
    expect(slugify("!!!@@@")).toBe("untitled");
  });

  it("preserves digits in slug", () => {
    expect(slugify("Use PostgreSQL 17")).toBe("use-postgresql-17");
  });
});

// ---------------------------------------------------------------------------
// renderAdr
// ---------------------------------------------------------------------------

describe("renderAdr", () => {
  const mockNow = () => "2026-05-16T00:00:00.000Z";

  it("generates body starting with '# 0042. <title>' for counter=42", () => {
    const body = renderAdr(42, { title: "Switch to PostgreSQL" }, { now: mockNow });
    expect(body.startsWith("# 0042. Switch to PostgreSQL\n")).toBe(true);
  });

  it("zero-pads counter to 4 digits", () => {
    const body = renderAdr(1, { title: "First decision" }, { now: mockNow });
    expect(body.startsWith("# 0001. First decision\n")).toBe(true);
  });

  it("includes Date line after the title", () => {
    const body = renderAdr(1, { title: "x" }, { now: mockNow });
    expect(body).toContain("Date: 2026-05-16T00:00:00.000Z");
  });

  it("contains all Nygard section headers", () => {
    const body = renderAdr(1, { title: "x" }, { now: mockNow });
    expect(body).toContain("## Status");
    expect(body).toContain("## Context");
    expect(body).toContain("## Decision");
    expect(body).toContain("## Consequences");
    expect(body).toContain("## Options considered");
  });

  it("renders _n/a_ placeholder for missing optional fields", () => {
    const body = renderAdr(1, { title: "Minimal" }, { now: mockNow });
    // status defaults to "Proposed", so count _n/a_ for context, chosen, consequences, alternatives
    const naCount = (body.match(/_n\/a_/g) ?? []).length;
    expect(naCount).toBeGreaterThanOrEqual(4);
  });

  it("renders provided fields verbatim", () => {
    const body = renderAdr(
      5,
      {
        title: "Use Redis",
        status: "Accepted",
        context: "We need a cache",
        chosen: "Redis",
        consequences: "Need infra setup",
        alternatives: "Memcached vs Redis",
      },
      { now: mockNow },
    );
    expect(body).toContain("Accepted");
    expect(body).toContain("We need a cache");
    expect(body).toContain("Redis");
    expect(body).toContain("Need infra setup");
    expect(body).toContain("Memcached vs Redis");
  });

  it("is deterministic: same inputs produce same bytes", () => {
    const input = { title: "Test decision", context: "ctx", chosen: "option A" };
    const a = renderAdr(10, input, { now: mockNow });
    const b = renderAdr(10, input, { now: mockNow });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// writeAdrFile
// ---------------------------------------------------------------------------

describe("writeAdrFile", () => {
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    paths = makeTmpProject();
    // Write a real state.json with adrCounter: 5
    writeFileSync(
      paths.statePath,
      JSON.stringify({ version: 1, disabled: false, warnings: [], staleLocksReleased: 0, adrCounter: 5 }) + "\n",
    );
  });

  it("increments counter from 5 → 6 and returns the result", async () => {
    const result = await writeAdrFile(paths, { title: "Use Postgres" });
    expect(result.counter).toBe(6);
    expect(result.slug).toBe("use-postgres");
    expect(result.filename).toBe("0006-use-postgres.md");
    expect(result.filepath).toContain(join("logbook", "decisions", "0006-use-postgres.md"));
  });

  it("increments counter again on second call → 7", async () => {
    await writeAdrFile(paths, { title: "First" });
    const result = await writeAdrFile(paths, { title: "Second" });
    expect(result.counter).toBe(7);

    const state = readState(paths.statePath);
    expect(state.adrCounter).toBe(7);
  });

  it("actually writes the file to logbook/decisions/", async () => {
    const result = await writeAdrFile(paths, { title: "File on disk" });
    expect(existsSync(result.filepath)).toBe(true);
  });

  it("file content matches renderAdr output byte-for-byte", async () => {
    const now = () => "2026-05-16T00:00:00.000Z";
    const input = { title: "Deterministic", context: "ctx" };
    const result = await writeAdrFile(paths, input, { now });
    const onDisk = readFileSync(result.filepath, "utf8");
    const expected = renderAdr(6, input, { now });
    expect(onDisk).toBe(expected);
  });

  it("creates logbook/decisions/ directory if it does not exist", async () => {
    const decisionsDir = join(paths.dataDir, "decisions");
    expect(existsSync(decisionsDir)).toBe(false);

    await writeAdrFile(paths, { title: "Create dir" });
    expect(existsSync(decisionsDir)).toBe(true);
  });

  it("starts from counter 1 when state.json has no adrCounter", async () => {
    // Overwrite state without adrCounter
    writeFileSync(
      paths.statePath,
      JSON.stringify({ version: 1, disabled: false, warnings: [], staleLocksReleased: 0 }) + "\n",
    );

    const result = await writeAdrFile(paths, { title: "First ever" });
    expect(result.counter).toBe(1);
  });

  it("starts from counter 1 when state.json does not exist at all", async () => {
    // Create a fresh project with no state.json
    const freshPaths = makeTmpProject();
    // Do NOT write state.json (makeTmpProject only creates .logbook dir)

    const result = await writeAdrFile(freshPaths, { title: "No state yet" });
    expect(result.counter).toBe(1);
  });
});

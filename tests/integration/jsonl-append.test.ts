import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { appendJsonl } from "../../src/store/jsonl.js";

// Resolve macOS /var -> /private/var symlink so path-confine tests are consistent.
const TMP = realpathSync(tmpdir());

describe("jsonl-append integration", () => {
  let tmpDir: string;

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  function setup(): string {
    tmpDir = mkdtempSync(join(TMP, "lb-jsonl-"));
    return tmpDir;
  }

  // ─── File creation ──────────────────────────────────────────────────────────

  it("creates file with first line if file does not exist", async () => {
    const dir = setup();
    const filePath = join(dir, "events.jsonl");
    const line = JSON.stringify({ id: "1", msg: "hello" });

    await appendJsonl(filePath, line);

    const content = readFileSync(filePath, "utf8");
    expect(content).toBe(line + "\n");
  });

  it("appends after existing content with a clean newline boundary", async () => {
    const dir = setup();
    const filePath = join(dir, "events.jsonl");

    const line1 = JSON.stringify({ id: "1" });
    const line2 = JSON.stringify({ id: "2" });

    await appendJsonl(filePath, line1);
    await appendJsonl(filePath, line2);

    const lines = readFileSync(filePath, "utf8").split("\n");
    // Last element will be "" (trailing newline)
    expect(lines).toEqual([line1, line2, ""]);
  });

  it("file always ends with \\n after each append (trailing newline contract)", async () => {
    const dir = setup();
    const filePath = join(dir, "events.jsonl");

    for (let i = 0; i < 5; i++) {
      await appendJsonl(filePath, JSON.stringify({ seq: i }));
      const content = readFileSync(filePath, "utf8");
      expect(content.endsWith("\n"), `after append ${i}: file must end with \\n`).toBe(true);
    }
  });

  it("creates intermediate directories if they don't exist", async () => {
    const dir = setup();
    const filePath = join(dir, "nested", "deep", randomUUID(), "events.jsonl");

    await expect(appendJsonl(filePath, '{"id":"1"}')).resolves.not.toThrow();
    expect(readFileSync(filePath, "utf8")).toBe('{"id":"1"}\n');
  });

  // ─── Concurrent appenders (the lock test) ──────────────────────────────────

  it("concurrent appenders: 5 writers × 20 lines = exactly 100 lines, no interleaving", async () => {
    const dir = setup();
    const filePath = join(dir, "concurrent.jsonl");

    const WRITERS = 5;
    const LINES_EACH = 20;

    // Launch all promises simultaneously — this is where the lock matters.
    const promises: Promise<void>[] = [];
    for (let w = 0; w < WRITERS; w++) {
      for (let l = 0; l < LINES_EACH; l++) {
        promises.push(
          appendJsonl(filePath, JSON.stringify({ writer: w, line: l })),
        );
      }
    }

    await Promise.all(promises);

    const content = readFileSync(filePath, "utf8");
    const rawLines = content.split("\n");

    // Last element is "" due to trailing newline; remove it.
    expect(rawLines[rawLines.length - 1]).toBe("");
    const lines = rawLines.slice(0, -1);

    // Exactly 100 lines.
    expect(lines.length).toBe(WRITERS * LINES_EACH);

    // Every line must be valid JSON (no byte interleaving mid-line).
    let parseErrors = 0;
    const seen = new Set<string>();
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as { writer: number; line: number };
        const key = `${obj.writer}-${obj.line}`;
        expect(seen.has(key), `duplicate line: ${key}`).toBe(false);
        seen.add(key);
      } catch {
        parseErrors++;
      }
    }

    expect(parseErrors, "some lines failed JSON.parse — byte interleaving detected").toBe(0);

    // All 100 unique writer-line pairs must be present.
    expect(seen.size).toBe(WRITERS * LINES_EACH);
  }, 30_000);

  // ─── Stale lock recovery ────────────────────────────────────────────────────

  it("recovers from a stale lock file older than staleMs", async () => {
    const dir = setup();
    const filePath = join(dir, "events.jsonl");

    // proper-lockfile creates a <filePath>.lock directory.
    // Simulate a stale lock by creating the lock dir manually with an old mtime.
    const lockDir = `${filePath}.lock`;
    mkdirSync(lockDir, { recursive: true });

    // Set mtime to 10 seconds in the past (beyond staleMs=5000).
    const staleTime = new Date(Date.now() - 10_000);
    utimesSync(lockDir, staleTime, staleTime);

    // appendJsonl must succeed despite the stale lock (proper-lockfile handles it).
    await expect(
      appendJsonl(filePath, '{"id":"stale-test"}', { staleMs: 5_000 }),
    ).resolves.not.toThrow();

    expect(readFileSync(filePath, "utf8")).toContain('"stale-test"');
  });

  // ─── Content integrity ──────────────────────────────────────────────────────

  it("each appended line is valid JSON when input is valid JSON", async () => {
    const dir = setup();
    const filePath = join(dir, "events.jsonl");

    const payloads = [
      { kind: "tool_use", tool: "Read", args: { path: "/foo" } },
      { kind: "tool_result", content: "ok", nested: { a: 1, b: [2, 3] } },
      { kind: "message", text: 'special "quotes" and \ttabs' },
    ];

    for (const p of payloads) {
      await appendJsonl(filePath, JSON.stringify(p));
    }

    const lines = readFileSync(filePath, "utf8").trimEnd().split("\n");
    expect(lines.length).toBe(payloads.length);

    for (let i = 0; i < lines.length; i++) {
      expect(() => JSON.parse(lines[i]!), `line ${i} is not valid JSON`).not.toThrow();
    }
  });

  it("fsyncOnAppend:false still writes correctly (just skips fdatasync)", async () => {
    const dir = setup();
    const filePath = join(dir, "nosync.jsonl");

    await appendJsonl(filePath, '{"id":"nosync"}', { fsyncOnAppend: false });
    expect(readFileSync(filePath, "utf8")).toBe('{"id":"nosync"}\n');
  });
});

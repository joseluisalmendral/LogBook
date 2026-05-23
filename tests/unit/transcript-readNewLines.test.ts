/**
 * Unit tests: readTranscriptNewLines byte-offset cursor (W3 spec).
 *
 * Verifies:
 *   - Write file, read at cursor 0 → returns all lines, cursor = file size
 *   - Append more content, read at new cursor → only delta returned
 *   - File missing → filePresent: false
 *   - Cursor >= file size → empty lines, no read
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readTranscriptNewLines } from "../../src/connectors/claude-code/transcript.js";

describe("readTranscriptNewLines", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-transcript-"));
    filePath = path.join(tmpDir, "session.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads all lines when cursor is 0 and file exists", async () => {
    const line1 = JSON.stringify({
      type: "assistant",
      uuid: "a1",
      message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
    });
    const line2 = JSON.stringify({
      type: "assistant",
      uuid: "a2",
      message: { role: "assistant", content: [{ type: "text", text: "world" }] },
    });
    fs.writeFileSync(filePath, `${line1}\n${line2}\n`, "utf8");

    const result = await readTranscriptNewLines(filePath, 0);
    expect(result.filePresent).toBe(true);
    expect(result.lines).toHaveLength(2);
    expect(result.newCursor).toBeGreaterThan(0);
    expect(result.newCursor).toBe(Buffer.byteLength(`${line1}\n${line2}\n`, "utf8"));
  });

  it("returns only delta when reading from non-zero cursor", async () => {
    const line1 = JSON.stringify({ type: "user", uuid: "u1" });
    const initialContent = `${line1}\n`;
    fs.writeFileSync(filePath, initialContent, "utf8");

    // First read: get all content.
    const result1 = await readTranscriptNewLines(filePath, 0);
    const cursorAfterFirst = result1.newCursor;

    // Append more content.
    const line2 = JSON.stringify({
      type: "assistant",
      uuid: "a1",
      message: { role: "assistant", content: [{ type: "text", text: "response" }] },
    });
    const line3 = JSON.stringify({
      type: "assistant",
      uuid: "a2",
      message: { role: "assistant", content: [{ type: "text", text: "more" }] },
    });
    fs.appendFileSync(filePath, `${line2}\n${line3}\n`, "utf8");

    // Second read: only the appended content.
    const result2 = await readTranscriptNewLines(filePath, cursorAfterFirst);
    expect(result2.filePresent).toBe(true);
    expect(result2.lines).toHaveLength(2);
    expect(result2.lines[0]!.uuid).toBe("a1");
    expect(result2.lines[1]!.uuid).toBe("a2");
  });

  it("returns filePresent: false when file does not exist", async () => {
    const result = await readTranscriptNewLines(path.join(tmpDir, "nonexistent.jsonl"), 0);
    expect(result.filePresent).toBe(false);
    expect(result.lines).toHaveLength(0);
  });

  it("returns empty lines when cursor >= file size", async () => {
    fs.writeFileSync(filePath, JSON.stringify({ type: "user" }) + "\n", "utf8");
    const stat = fs.statSync(filePath);

    const result = await readTranscriptNewLines(filePath, stat.size);
    expect(result.filePresent).toBe(true);
    expect(result.lines).toHaveLength(0);
    expect(result.newCursor).toBe(stat.size);
  });

  it("skips malformed JSON lines without throwing", async () => {
    const goodLine = JSON.stringify({ type: "assistant", uuid: "ag" });
    fs.writeFileSync(filePath, `${goodLine}\nnot-valid-json\n`, "utf8");

    const result = await readTranscriptNewLines(filePath, 0);
    // Only 1 valid line parsed; malformed skipped silently.
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.uuid).toBe("ag");
  });
});

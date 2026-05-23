/**
 * Unit tests: 5MB delta cap on transcript reads (design ADR-8).
 *
 * Verifies:
 *   - When stat delta > 5MB, cursor advances without parsing
 *   - No lines returned when cap triggers
 *   - newCursor equals file size (cursor advanced past the large delta)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readTranscriptNewLines } from "../../src/connectors/claude-code/transcript.js";

describe("readTranscriptNewLines — large delta cap (ADR-8)", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-large-delta-"));
    filePath = path.join(tmpDir, "large.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips parsing when delta exceeds 5MB and advances cursor to file size", async () => {
    // Create a file that already has some content at cursor 0.
    // We pretend the cursor is at 0 and file size is > 5MB.
    // Instead of writing 5MB (slow in CI), we write a small file but use a
    // mocked cursor. Set cursor to 0 and file content to > 5MB equivalent
    // by writing a file just above 5MB threshold.
    //
    // To keep the test fast, write a minimal marker file and then set
    // cursorByteOffset to a value that makes (fileSize - cursor) < MAX.
    // Instead, write just enough bytes to trigger the cap.
    //
    // Strategy: write 1 byte of valid content to the file, then pass
    // cursorByteOffset = -(5_000_001) which is invalid. Instead:
    // write a file that is > 5MB.

    // Generate ~5.01MB of data (valid JSON lines).
    const lineTemplate = JSON.stringify({
      type: "assistant",
      uuid: "fill",
      message: { role: "assistant", content: [{ type: "text", text: "x".repeat(1000) }] },
    });
    // Each line is ~1060 bytes; 5000 lines ≈ 5.3MB.
    const lines = Array.from({ length: 5000 }, () => lineTemplate);
    fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");

    const stat = fs.statSync(filePath);
    expect(stat.size).toBeGreaterThan(5_000_000);

    // Read with cursor at 0 — delta = full file size > 5MB → cap triggers.
    const result = await readTranscriptNewLines(filePath, 0);
    expect(result.filePresent).toBe(true);
    // No lines returned (cap skipped parsing).
    expect(result.lines).toHaveLength(0);
    // Cursor advanced to file size.
    expect(result.newCursor).toBe(stat.size);
  }, 30_000); // 30s timeout for writing 5MB

  it("does NOT trigger cap when delta is below 5MB", async () => {
    const smallContent = JSON.stringify({
      type: "assistant",
      uuid: "small",
      message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
    }) + "\n";
    fs.writeFileSync(filePath, smallContent, "utf8");

    const result = await readTranscriptNewLines(filePath, 0);
    expect(result.filePresent).toBe(true);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.uuid).toBe("small");
  });
});

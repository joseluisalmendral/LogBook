/**
 * Unit tests: generate/blocks.ts — upsertGeneratedBlock wrapper (T11).
 *
 * Tests the wrapper that reads/writes files and delegates to upsertMarkdownBlock
 * with named marker families. Tests cover: file missing, file exists with block,
 * file exists without block, no-op write (content unchanged).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { upsertGeneratedBlock } from "../../src/generate/blocks.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lb-blocks-"))
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("upsertGeneratedBlock", () => {
  it("creates file when it does not exist", async () => {
    const file = path.join(tmpDir, "docs", "index.md");
    const { written } = await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:index",
      markerVersion: 1,
      body: "# Index content",
    });
    expect(written).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("<!-- logbook:doc:index start v=1 -->");
    expect(content).toContain("# Index content");
    expect(content).toContain("<!-- logbook:doc:index end -->");
  });

  it("appends block to existing file without a block", async () => {
    const file = path.join(tmpDir, "existing.md");
    fs.writeFileSync(file, "# My File\n\nSome user prose.\n", "utf8");

    const { written } = await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:timeline",
      markerVersion: 1,
      body: "timeline content",
    });
    expect(written).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("# My File");
    expect(content).toContain("Some user prose.");
    expect(content).toContain("<!-- logbook:doc:timeline start v=1 -->");
    expect(content).toContain("timeline content");
  });

  it("replaces existing block with updated content", async () => {
    const file = path.join(tmpDir, "update.md");
    const oldContent =
      "# Title\n<!-- logbook:doc:errors start v=1 -->\nold errors\n<!-- logbook:doc:errors end -->\n";
    fs.writeFileSync(file, oldContent, "utf8");

    const { written } = await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:errors",
      markerVersion: 1,
      body: "new errors content",
    });
    expect(written).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("new errors content");
    expect(content).not.toContain("old errors");
    expect(content).toContain("# Title");
  });

  it("returns written: false when content is unchanged (no-op)", async () => {
    const file = path.join(tmpDir, "noop.md");
    const body = "same content";

    // First write
    await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:index",
      markerVersion: 1,
      body,
    });

    // Second write — same body, should be no-op
    const { written } = await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:index",
      markerVersion: 1,
      body,
    });
    expect(written).toBe(false);
  });

  it("preserves user content OUTSIDE the generated block byte-for-byte", async () => {
    const file = path.join(tmpDir, "preserve.md");
    const userProse = "# User Title\n\nThis is user prose that must be preserved.\n";
    fs.writeFileSync(file, userProse, "utf8");

    await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:index",
      markerVersion: 1,
      body: "generated content",
    });

    // Re-run with different body — user prose must remain
    await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:index",
      markerVersion: 1,
      body: "updated generated content",
    });

    const content = fs.readFileSync(file, "utf8");
    expect(content.startsWith(userProse)).toBe(true);
  });

  it("creates parent directory when it does not exist", async () => {
    const file = path.join(tmpDir, "deep", "nested", "docs", "timeline.md");
    expect(fs.existsSync(path.dirname(file))).toBe(false);

    await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:timeline",
      markerVersion: 1,
      body: "timeline",
    });

    expect(fs.existsSync(file)).toBe(true);
  });

  it("different marker families in same file are independent", async () => {
    const file = path.join(tmpDir, "multi.md");

    await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:index",
      markerVersion: 1,
      body: "index body",
    });
    await upsertGeneratedBlock({
      file,
      markerName: "logbook:doc:timeline",
      markerVersion: 1,
      body: "timeline body",
    });

    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("<!-- logbook:doc:index start v=1 -->");
    expect(content).toContain("index body");
    expect(content).toContain("<!-- logbook:doc:timeline start v=1 -->");
    expect(content).toContain("timeline body");
  });
});

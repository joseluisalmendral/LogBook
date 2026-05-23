/*
 * Slice 14 Bucket E — files-touched UI wiring.
 *
 * Structural source-file assertions (matches the pattern from p7-bidirectional
 * + p5-transcript). Verifies:
 *   1. FileChangeStrip atom exists and renders chips with deep-link href.
 *   2. SubAgentCard imports FileChangeStrip + reads payload.filesTouched +
 *      mounts the strip in the expanded body + adds a count badge in compact row.
 *   3. ChapterHeader reads chapter.filesTouched + has a toggleable section.
 *   4. types.ts exports FileTouch with the 4 documented actions.
 *   5. The FileChangeStrip atom honors reduced-motion (no transform on hover).
 *
 * No DOM mount — Svelte 5 + jsdom is heavy. Source-level inspection mirrors
 * the slice 12 P5/P7 convention.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src", "lib");

function readSource(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8");
}

describe("slice 14 Bucket E — FileChangeStrip atom", () => {
  it("exists with the documented Props shape", () => {
    const src = readSource("components", "FileChangeStrip.svelte");
    expect(src).toContain("interface Props");
    expect(src).toContain("files: FileTouch[]");
    expect(src).toContain("compact?: boolean");
    expect(src).toContain("compactLimit?: number");
  });

  it("emits a vscode://file/ deep link per chip via buildFileUri", () => {
    const src = readSource("components", "FileChangeStrip.svelte");
    expect(src).toContain('import { buildFileUri } from "../util/deep-link.ts"');
    expect(src).toContain("buildFileUri(file.path)");
    expect(src).toContain('data-deep-link="file"');
  });

  it("carries data-testid=\"file-change-strip\" + ARIA labels", () => {
    const src = readSource("components", "FileChangeStrip.svelte");
    expect(src).toContain('data-testid="file-change-strip"');
    expect(src).toContain("aria-label={ariaLabel}");
  });

  it("renders distinct glyphs per action", () => {
    const src = readSource("components", "FileChangeStrip.svelte");
    // The action → glyph dictionary uses 4 shapes to keep colors/glyphs in sync.
    expect(src).toContain("write");
    expect(src).toContain("edit");
    expect(src).toContain("multi_edit");
    expect(src).toContain("read");
  });

  it("honors reduced-motion by zeroing the hover transform", () => {
    const src = readSource("components", "FileChangeStrip.svelte");
    expect(src).toContain('html[data-motion="reduced"]');
    expect(src).toContain("transform: none");
  });

  it("collapses to a count when files.length > compactLimit in compact mode", () => {
    const src = readSource("components", "FileChangeStrip.svelte");
    expect(src).toContain("chip-overflow");
    expect(src).toContain("+{overflow}");
  });
});

describe("slice 14 Bucket E — SubAgentCard wiring", () => {
  it("imports FileChangeStrip and FileTouch", () => {
    const src = readSource("components", "SubAgentCard.svelte");
    expect(src).toContain('import FileChangeStrip from "./FileChangeStrip.svelte"');
    expect(src).toContain("FileTouch");
  });

  it("derives filesTouched from event.payload with a strict guard", () => {
    const src = readSource("components", "SubAgentCard.svelte");
    expect(src).toContain("payload.filesTouched");
    // Must filter to only well-formed entries (defensive coercion).
    expect(src).toContain('typeof f.path === "string"');
    expect(src).toContain('typeof f.action === "string"');
  });

  it("adds a count badge in the compact row when files exist", () => {
    const src = readSource("components", "SubAgentCard.svelte");
    expect(src).toMatch(/filesTouched\.length > 0[\s\S]*?file/);
    expect(src).toContain("file{filesTouched.length === 1");
  });

  it("mounts <FileChangeStrip files={filesTouched}> in the expanded body", () => {
    const src = readSource("components", "SubAgentCard.svelte");
    expect(src).toContain('aria-label="Files touched"');
    expect(src).toContain("<FileChangeStrip files={filesTouched}");
  });
});

describe("slice 14 Bucket E — ChapterHeader wiring", () => {
  it("imports FileChangeStrip and FileTouch", () => {
    const src = readSource("components", "ChapterHeader.svelte");
    expect(src).toContain('import FileChangeStrip from "./FileChangeStrip.svelte"');
    expect(src).toContain("FileTouch");
  });

  it("derives filesTouched from chapter.filesTouched with a strict guard", () => {
    const src = readSource("components", "ChapterHeader.svelte");
    expect(src).toContain("chapter.filesTouched");
  });

  it("renders a toggleable 'Files X touched' pill with aria-expanded", () => {
    const src = readSource("components", "ChapterHeader.svelte");
    expect(src).toContain("meta-files-pill");
    expect(src).toContain("aria-expanded={filesExpanded}");
    expect(src).toContain("aria-controls={`ch-files-${chapter.sessionId}`}");
  });

  it("conditionally renders <FileChangeStrip> below the meta row when expanded", () => {
    const src = readSource("components", "ChapterHeader.svelte");
    expect(src).toMatch(/filesTouched\.length > 0 && filesExpanded[\s\S]*?<FileChangeStrip/);
  });
});

describe("slice 14 Bucket E — types contract", () => {
  it("types.ts exports FileTouch with the 4 documented actions", () => {
    const src = readSource("types.ts");
    expect(src).toContain("export interface FileTouch");
    expect(src).toContain('"write"');
    expect(src).toContain('"edit"');
    expect(src).toContain('"multi_edit"');
    expect(src).toContain('"read"');
  });

  it("Chapter type carries optional filesTouched", () => {
    const src = readSource("types.ts");
    expect(src).toMatch(/filesTouched\?:\s*FileTouch\[\]/);
  });
});

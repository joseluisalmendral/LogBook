/**
 * Integration tests for speaker mode export (S6.2).
 *
 * Tests:
 *  1. Default exportHtml strips speaker blocks
 *  2. exportHtml with speakerMode: true includes speaker blocks as <div class="speaker-note">
 *  3. Default exportInstructorPack strips speaker blocks
 *  4. exportInstructorPack with speakerMode: true includes speaker blocks
 *
 * Uses the library API directly (not the CLI) to isolate the feature.
 *
 * RED phase: written before implementation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect } from "vitest";
import { exportHtml } from "../../src/export/html.js";
import { exportInstructorPack } from "../../src/export/instructor-pack.js";
import { makePaths } from "../../src/core/paths.js";

const SPEAKER_MD = [
  "# My Slide",
  "",
  "Here is the slide content.",
  "",
  "<!-- logbook:speaker start v=1 -->",
  "Remember to mention the context from last week.",
  "<!-- logbook:speaker end -->",
  "",
  "## Next Section",
].join("\n");

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-speaker-${Math.random().toString(36).slice(2)}`,
  );

  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "decisions"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "teaching-scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );

  // Write docs with speaker block
  fs.writeFileSync(
    path.join(dir, "logbook", "docs", "index.md"),
    SPEAKER_MD,
  );
  fs.writeFileSync(
    path.join(dir, "logbook", "docs", "timeline.md"),
    "# Timeline\n\nNo events yet.",
  );
  fs.writeFileSync(
    path.join(dir, "logbook", "docs", "errors-and-lessons.md"),
    "# Errors and Lessons\n\nNone.",
  );

  return dir;
}

describe("exportHtml speaker mode (S6.2)", () => {
  it("strips speaker blocks by default (speakerMode not set)", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out.html");

    await exportHtml({ paths, outFile });

    const html = fs.readFileSync(outFile, "utf8");
    expect(html).not.toContain("Remember to mention the context");
    expect(html).not.toContain("logbook:speaker");
    // CSS contains .speaker-note rule, but the div should not appear in body
    expect(html).not.toContain('<div class="speaker-note">');
    expect(html).toContain("slide content");
  });

  it("includes speaker blocks as <div class='speaker-note'> when speakerMode: true", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-speaker.html");

    await exportHtml({ paths, outFile, speakerMode: true });

    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain('<div class="speaker-note">');
    expect(html).toContain("Remember to mention the context");
    expect(html).not.toContain("logbook:speaker start");
    expect(html).not.toContain("logbook:speaker end");
  });
});

describe("exportInstructorPack speaker mode (S6.2)", () => {
  it("strips speaker blocks by default (speakerMode not set)", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-pack.html");

    await exportInstructorPack({ paths, outFile });

    const html = fs.readFileSync(outFile, "utf8");
    expect(html).not.toContain("Remember to mention the context");
    expect(html).not.toContain("logbook:speaker");
    // CSS contains .speaker-note rule, but the div should not appear in body
    expect(html).not.toContain('<div class="speaker-note">');
  });

  it("includes speaker blocks when speakerMode: true", async () => {
    const dir = makeTmpProject();
    const paths = makePaths(dir);
    const outFile = path.join(dir, "out-pack-speaker.html");

    await exportInstructorPack({ paths, outFile, speakerMode: true });

    const html = fs.readFileSync(outFile, "utf8");
    expect(html).toContain('<div class="speaker-note">');
    expect(html).toContain("Remember to mention the context");
  });
});

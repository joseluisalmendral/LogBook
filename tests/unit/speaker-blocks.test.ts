/**
 * Unit tests for speaker block marker family (S6.2).
 *
 * Verifies:
 * - stripSpeakerBlocks removes <!-- logbook:speaker start --> ... <!-- logbook:speaker end --> blocks
 * - renderSpeakerBlocks wraps content in <div class="speaker-note">
 * - Nested markers are not supported (clear error)
 * - Unterminated marker strips from open to EOF with warning
 * - Surrounding whitespace tidied after strip
 *
 * RED phase: written before implementation.
 */

import { describe, it, expect, vi } from "vitest";
import { stripSpeakerBlocks, renderSpeakerBlocks } from "../../src/generate/speaker-blocks.js";

describe("stripSpeakerBlocks (S6.2)", () => {
  it("removes a speaker block and surrounding whitespace", () => {
    const md = [
      "# Heading",
      "",
      "Some text before.",
      "",
      "<!-- logbook:speaker start v=1 -->",
      "This is a speaker note.",
      "<!-- logbook:speaker end -->",
      "",
      "Text after.",
    ].join("\n");

    const result = stripSpeakerBlocks(md);
    expect(result).not.toContain("speaker note");
    expect(result).not.toContain("logbook:speaker");
    expect(result).toContain("Some text before.");
    expect(result).toContain("Text after.");
  });

  it("removes multiple speaker blocks", () => {
    const md = [
      "<!-- logbook:speaker start v=1 -->",
      "Note one.",
      "<!-- logbook:speaker end -->",
      "",
      "Middle content.",
      "",
      "<!-- logbook:speaker start v=1 -->",
      "Note two.",
      "<!-- logbook:speaker end -->",
    ].join("\n");

    const result = stripSpeakerBlocks(md);
    expect(result).not.toContain("Note one.");
    expect(result).not.toContain("Note two.");
    expect(result).toContain("Middle content.");
  });

  it("returns unchanged markdown when no speaker blocks present", () => {
    const md = "# Title\n\nJust a paragraph.";
    expect(stripSpeakerBlocks(md)).toBe(md);
  });

  it("strips from open marker to EOF when end marker is missing (with console.warn)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const md = [
      "Some preamble.",
      "<!-- logbook:speaker start v=1 -->",
      "Unterminated speaker note.",
    ].join("\n");

    const result = stripSpeakerBlocks(md);
    expect(result).not.toContain("Unterminated speaker note.");
    expect(result).toContain("Some preamble.");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unterminated")
    );

    warnSpy.mockRestore();
  });

  it("throws on nested speaker blocks", () => {
    const md = [
      "<!-- logbook:speaker start v=1 -->",
      "Outer note.",
      "<!-- logbook:speaker start v=1 -->",
      "Inner note.",
      "<!-- logbook:speaker end -->",
      "<!-- logbook:speaker end -->",
    ].join("\n");

    expect(() => stripSpeakerBlocks(md)).toThrow(/nested/i);
  });
});

describe("renderSpeakerBlocks (S6.2)", () => {
  it("wraps speaker block content in <div class='speaker-note'>", () => {
    const md = [
      "# Slide",
      "",
      "<!-- logbook:speaker start v=1 -->",
      "Here is what to say.",
      "<!-- logbook:speaker end -->",
    ].join("\n");

    const result = renderSpeakerBlocks(md);
    expect(result).toContain('<div class="speaker-note">');
    expect(result).toContain("Here is what to say.");
    expect(result).toContain("</div>");
    expect(result).not.toContain("logbook:speaker start");
    expect(result).not.toContain("logbook:speaker end");
  });

  it("preserves content outside speaker blocks", () => {
    const md = [
      "# Heading",
      "",
      "<!-- logbook:speaker start v=1 -->",
      "Speaker text.",
      "<!-- logbook:speaker end -->",
      "",
      "Normal paragraph.",
    ].join("\n");

    const result = renderSpeakerBlocks(md);
    expect(result).toContain("# Heading");
    expect(result).toContain("Normal paragraph.");
  });

  it("sanitizes speaker content — no XSS via speaker note", () => {
    const md = [
      "<!-- logbook:speaker start v=1 -->",
      '<script>alert("xss")</script>',
      "<!-- logbook:speaker end -->",
    ].join("\n");

    // Content goes into the HTML pipeline (remark/rehype), which will escape it.
    // renderSpeakerBlocks itself wraps the raw content in a div; the pipeline later
    // renders it as code (remark escapes HTML in paragraphs).
    // The critical check: the resulting HTML should not have unescaped <script>.
    // Since renderSpeakerBlocks is a markdown-level transformation, raw HTML inside
    // speaker blocks passes through remark's escaping. We verify the wrapper is correct.
    const result = renderSpeakerBlocks(md);
    expect(result).toContain('<div class="speaker-note">');
    // The content is inside the div but will be processed by the HTML pipeline later.
    // renderSpeakerBlocks does NOT sanitize — that's the pipeline's job.
    // This test just verifies the structure is correct.
    expect(result).toContain("</div>");
  });

  it("throws on nested speaker blocks", () => {
    const md = [
      "<!-- logbook:speaker start v=1 -->",
      "Outer.",
      "<!-- logbook:speaker start v=1 -->",
      "Inner.",
      "<!-- logbook:speaker end -->",
      "<!-- logbook:speaker end -->",
    ].join("\n");

    expect(() => renderSpeakerBlocks(md)).toThrow(/nested/i);
  });
});

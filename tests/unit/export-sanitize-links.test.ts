/**
 * Unit tests: sanitize-links.ts (T12).
 *
 * Verifies that assertNoExternalRefs throws on any external reference
 * and passes cleanly on safe HTML.
 */

import { describe, it, expect } from "vitest";
import { assertNoExternalRefs, sanitizeReport } from "../../src/export/sanitize-links.js";

describe("sanitizeReport", () => {
  it("returns empty report for clean HTML", () => {
    const report = sanitizeReport("<p>Hello world</p>");
    expect(report.externalUrls).toHaveLength(0);
    expect(report.externalScripts).toHaveLength(0);
    expect(report.externalStylesheets).toHaveLength(0);
    expect(report.externalIframes).toHaveLength(0);
  });

  it("detects https URL in anchor href", () => {
    const report = sanitizeReport('<a href="https://example.com">link</a>');
    expect(report.externalUrls.length).toBeGreaterThan(0);
    expect(report.externalUrls[0]).toContain("https://example.com");
  });

  it("detects http URL", () => {
    const report = sanitizeReport('<img src="http://cdn.example.com/img.png">');
    expect(report.externalUrls.length).toBeGreaterThan(0);
  });

  it("detects script with src", () => {
    const report = sanitizeReport('<script src="cdn.example.com/x.js"></script>');
    expect(report.externalScripts.length).toBeGreaterThan(0);
  });

  it("detects link rel=stylesheet", () => {
    const report = sanitizeReport('<link rel="stylesheet" href="x.css">');
    expect(report.externalStylesheets.length).toBeGreaterThan(0);
  });

  it("detects iframe", () => {
    const report = sanitizeReport('<iframe src="https://embed.example.com"></iframe>');
    expect(report.externalIframes.length).toBeGreaterThan(0);
  });

  it("URL inside style block with url() is caught by URL pattern", () => {
    // Expected behavior: the http URL inside CSS url() triggers the URL pattern.
    // This is documented as expected — the sanitizer is conservative.
    const report = sanitizeReport(
      "<style>body { background: url(http://x.com/bg.png) }</style>"
    );
    expect(report.externalUrls.length).toBeGreaterThan(0);
  });
});

describe("assertNoExternalRefs", () => {
  it("passes for clean HTML with no external refs", () => {
    expect(() => assertNoExternalRefs("<p>Hello</p>")).not.toThrow();
  });

  it("passes for empty string", () => {
    expect(() => assertNoExternalRefs("")).not.toThrow();
  });

  it("passes for HTML with only inline styles", () => {
    expect(() =>
      assertNoExternalRefs("<p style=\"color: red;\">Styled</p>")
    ).not.toThrow();
  });

  it("throws when https URL is present in plain HTML", () => {
    expect(() =>
      assertNoExternalRefs('<a href="https://example.com">x</a>')
    ).toThrow();
  });

  it("throws when http URL is present", () => {
    expect(() =>
      assertNoExternalRefs('<img src="http://example.com/img.png">')
    ).toThrow();
  });

  it("throws when script with src is present", () => {
    expect(() =>
      assertNoExternalRefs('<script src="cdn.example.com/x.js"></script>')
    ).toThrow();
  });

  it("throws when link rel=stylesheet is present", () => {
    expect(() =>
      assertNoExternalRefs('<link rel="stylesheet" href="x.css">')
    ).toThrow();
  });

  it("throws when link rel=stylesheet with single quotes is present", () => {
    expect(() =>
      assertNoExternalRefs("<link rel='stylesheet' href='x.css'>")
    ).toThrow();
  });

  it("throws when iframe is present", () => {
    expect(() =>
      assertNoExternalRefs('<iframe src="..."></iframe>')
    ).toThrow();
  });

  it("throws for link without quotes around rel", () => {
    expect(() =>
      assertNoExternalRefs("<link rel=stylesheet href=x.css>")
    ).toThrow();
  });

  // ADR-02: assertNoExternalRefs now returns { externalRefs: number } on success.
  // The success path always returns externalRefs: 0 (ADR-04 — commits.md uses
  // plain SHA text so no external URLs survive to this point).
  it("returns { externalRefs: 0 } for clean HTML", () => {
    const result = assertNoExternalRefs("<p>ok</p>");
    expect(result).toEqual({ externalRefs: 0 });
  });

  it("returns { externalRefs: 0 } for empty string", () => {
    const result = assertNoExternalRefs("");
    expect(result).toEqual({ externalRefs: 0 });
  });

  it("returns { externalRefs: 0 } for HTML with inline-only styles", () => {
    const result = assertNoExternalRefs(
      "<style>body { color: red; }</style><p>text</p>"
    );
    expect(result).toEqual({ externalRefs: 0 });
  });

  it("return value externalRefs is a number", () => {
    const result = assertNoExternalRefs("<h1>Title</h1><p>content</p>");
    expect(typeof result.externalRefs).toBe("number");
  });
});

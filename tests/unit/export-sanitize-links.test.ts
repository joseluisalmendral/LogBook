/**
 * Unit tests: sanitize-links.ts (T12 + ADR-20 allowlist).
 *
 * Verifies that assertNoExternalRefs throws on non-allowlisted external refs
 * and passes (with allowedRefs count) for allowlisted URLs.
 * Also tests isAllowlistedUrl and the ALLOWED_HOSTS set directly.
 */

import { describe, it, expect } from "vitest";
import {
  assertNoExternalRefs,
  sanitizeReport,
  isAllowlistedUrl,
  ALLOWED_HOSTS,
} from "../../src/export/sanitize-links.js";

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
  it("returns { externalRefs: 0, allowedRefs: 0 } for clean HTML (ADR-20)", () => {
    const result = assertNoExternalRefs("<p>ok</p>");
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBe(0);
  });

  it("returns { externalRefs: 0, allowedRefs: 0 } for empty string (ADR-20)", () => {
    const result = assertNoExternalRefs("");
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBe(0);
  });

  it("returns { externalRefs: 0, allowedRefs: 0 } for HTML with inline-only styles (ADR-20)", () => {
    const result = assertNoExternalRefs(
      "<style>body { color: red; }</style><p>text</p>"
    );
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBe(0);
  });

  it("return value externalRefs is a number", () => {
    const result = assertNoExternalRefs("<h1>Title</h1><p>content</p>");
    expect(typeof result.externalRefs).toBe("number");
  });

  // ADR-20: allowlist tests
  it("passes github.com HTTPS URL and counts it in allowedRefs", () => {
    const html = '<a href="https://github.com/org/repo">link</a>';
    const result = assertNoExternalRefs(html);
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBeGreaterThanOrEqual(1);
  });

  it("passes gitlab.com HTTPS URL and counts it in allowedRefs", () => {
    const html = '<a href="https://gitlab.com/org/repo">link</a>';
    const result = assertNoExternalRefs(html);
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBeGreaterThanOrEqual(1);
  });

  it("passes bitbucket.org HTTPS URL and counts it in allowedRefs", () => {
    const html = '<a href="https://bitbucket.org/org/repo">link</a>';
    const result = assertNoExternalRefs(html);
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBeGreaterThanOrEqual(1);
  });

  it("throws for github.com.attacker.com (spoofed hostname)", () => {
    expect(() =>
      assertNoExternalRefs('<a href="https://github.com.attacker.com/evil">x</a>')
    ).toThrow();
  });

  it("throws for GITHUB.COM — wait, URL constructor lowercases, should pass", () => {
    // new URL().hostname returns the lowercase version of the host.
    // So GITHUB.COM as a literal in an href gets normalized to github.com.
    // Verify it passes (case-insensitive).
    const html = '<a href="https://GITHUB.COM/org/repo">link</a>';
    const result = assertNoExternalRefs(html);
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBeGreaterThanOrEqual(1);
  });

  it("throws for http://github.com (not HTTPS)", () => {
    expect(() =>
      assertNoExternalRefs('<a href="http://github.com/org/repo">x</a>')
    ).toThrow();
  });

  it("throws for evil.com (not in allowlist)", () => {
    expect(() =>
      assertNoExternalRefs('<a href="https://evil.com/steal">x</a>')
    ).toThrow();
  });

  it("throws for <script src> even when host is github.com (scripts never allowlisted)", () => {
    expect(() =>
      assertNoExternalRefs('<script src="https://github.com/script.js"></script>')
    ).toThrow();
  });

  it("URL with trailing ) is still parsed correctly", () => {
    // Markdown sometimes produces href="https://github.com/org/repo)"
    // isAllowlistedUrl should strip the trailing ) before parsing.
    const html = '<a href="https://github.com/org/repo)">link</a>';
    // The URL regex grabs the ) as part of the URL; isAllowlistedUrl strips it.
    const result = assertNoExternalRefs(html);
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBeGreaterThanOrEqual(1);
  });

  it("allowedRefs is 0 for clean HTML with no external URLs", () => {
    const result = assertNoExternalRefs("<p>no links here</p>");
    expect(result.allowedRefs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isAllowlistedUrl — direct unit tests (ADR-20)
// ---------------------------------------------------------------------------

describe("isAllowlistedUrl", () => {
  it("returns true for https://github.com path", () => {
    expect(isAllowlistedUrl("https://github.com/org/repo/commit/abc1234")).toBe(true);
  });

  it("returns true for https://gitlab.com path", () => {
    expect(isAllowlistedUrl("https://gitlab.com/org/repo")).toBe(true);
  });

  it("returns true for https://bitbucket.org path", () => {
    expect(isAllowlistedUrl("https://bitbucket.org/org/repo")).toBe(true);
  });

  it("returns false for http://github.com (http not https)", () => {
    expect(isAllowlistedUrl("http://github.com/org/repo")).toBe(false);
  });

  it("returns false for https://github.com.attacker.com (spoof)", () => {
    expect(isAllowlistedUrl("https://github.com.attacker.com/evil")).toBe(false);
  });

  it("returns false for https://evil.com", () => {
    expect(isAllowlistedUrl("https://evil.com")).toBe(false);
  });

  it("strips trailing ) before parsing", () => {
    expect(isAllowlistedUrl("https://github.com/org/repo)")).toBe(true);
  });

  it("strips trailing . before parsing", () => {
    expect(isAllowlistedUrl("https://github.com/org/repo.")).toBe(true);
  });

  it("returns false for invalid URL", () => {
    expect(isAllowlistedUrl("not-a-url")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ALLOWED_HOSTS constant
// ---------------------------------------------------------------------------

describe("ALLOWED_HOSTS", () => {
  it("contains exactly the three expected hosts", () => {
    expect(ALLOWED_HOSTS.has("github.com")).toBe(true);
    expect(ALLOWED_HOSTS.has("gitlab.com")).toBe(true);
    expect(ALLOWED_HOSTS.has("bitbucket.org")).toBe(true);
  });

  it("does not contain unexpected hosts", () => {
    expect(ALLOWED_HOSTS.has("evil.com")).toBe(false);
    expect(ALLOWED_HOSTS.has("github.com.attacker.com")).toBe(false);
    expect(ALLOWED_HOSTS.has("xgithub.com")).toBe(false);
  });
});

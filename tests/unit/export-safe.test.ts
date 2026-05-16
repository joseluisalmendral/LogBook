/**
 * Unit tests for sanitizeForSafeExport — redaction module (T7).
 *
 * Tests run against the pure function — no I/O, no side effects.
 * All redaction rules are tested in isolation and in combination.
 *
 * Token format note:
 *   The function outputs HTML-entity-encoded tokens (&lt;path&gt; etc.) so
 *   that the tokens survive the remark/rehype markdown-to-HTML pipeline.
 *   Bare angle-bracket tokens like <path> would be treated as HTML tags by
 *   remark-parse and stripped/misrendered by rehype.
 *
 * Edge cases documented:
 *  - Usernames that are also common English words (e.g. "root", "home", "user")
 *    are redacted globally (whole-word match). This is best-effort and is a
 *    documented limitation — documented in the safe.ts module header.
 *  - redactUsers is best-effort: it extracts the username from path matches
 *    in the same content string being sanitized.
 */

import { describe, it, expect } from "vitest";
import { sanitizeForSafeExport } from "../../src/export/safe.js";

// Tokens as they appear in the function output (HTML-entity encoded)
const TOKEN_PATH = "&lt;path&gt;";
const TOKEN_EMAIL = "&lt;email&gt;";
const TOKEN_USER = "&lt;user&gt;";

// ---------------------------------------------------------------------------
// Path redaction
// ---------------------------------------------------------------------------

describe("sanitizeForSafeExport — path redaction", () => {
  it("replaces /Users/<name>/ prefix with HTML-encoded <path> token", () => {
    const input = "File at /Users/alice/code/foo.ts was modified.";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("/Users/alice");
    expect(output).toContain(TOKEN_PATH);
  });

  it("replaces /home/<name>/ prefix with HTML-encoded <path> token", () => {
    const input = "Config at /home/bob/.config/logbook.json loaded.";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("/home/bob");
    expect(output).toContain(TOKEN_PATH);
  });

  it("replaces C:\\\\Users\\\\<name>\\\\ Windows path with HTML-encoded <path> token", () => {
    const input = "File: C:\\Users\\carol\\Documents\\project\\main.ts";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("C:\\Users\\carol");
    expect(output).toContain(TOKEN_PATH);
  });

  it("preserves the filename portion after the path prefix", () => {
    const input = "Reading /Users/alice/src/index.ts now.";
    const output = sanitizeForSafeExport(input);
    // The full path prefix is gone; file portion stays after the path token
    expect(output).toContain("index.ts");
  });

  it("handles multiple paths in the same string", () => {
    const input =
      "First: /Users/alice/a.ts, second: /Users/alice/b.ts";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("/Users/alice");
    const count = (output.split(TOKEN_PATH).length - 1);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("redactPaths=false leaves paths unchanged", () => {
    const input = "File at /Users/alice/code/foo.ts was modified.";
    const output = sanitizeForSafeExport(input, { redactPaths: false });
    expect(output).toContain("/Users/alice");
  });
});

// ---------------------------------------------------------------------------
// Username redaction
// ---------------------------------------------------------------------------

describe("sanitizeForSafeExport — username redaction", () => {
  it("redacts username so it does not appear in output", () => {
    // The path prefix is replaced with the path token, and the extracted
    // username "alice" is then replaced with the user token.
    const input = "/Users/alice/code/foo.ts";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("alice");
    expect(output).toContain(TOKEN_PATH);
  });

  it("replaces username with user token when it appears separately from the path", () => {
    // When the username appears BOTH in a path AND as standalone text,
    // the standalone occurrence is also replaced.
    const input = "Path: /Users/alice/code. Author: alice wrote this.";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("alice");
    expect(output).toContain(TOKEN_USER);
  });

  it("redacts username from /home/<name>/ paths", () => {
    const input = "/home/bob/.bashrc";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("bob");
  });

  it("does NOT redact a username that was not extracted from a path (path absent)", () => {
    // "alice" appearing with no /Users/alice or /home/alice path means
    // username extraction yields nothing — "alice" standalone is NOT replaced.
    const input = "Author: alice wrote this document.";
    const output = sanitizeForSafeExport(input);
    expect(output).toContain("alice");
  });

  it("redactUsers=false keeps username visible even after path redaction", () => {
    // With redactUsers=false, path prefix is still replaced but the extracted
    // username is not globally replaced.
    const input = "Path: /Users/alice/code. Author: alice wrote this.";
    const output = sanitizeForSafeExport(input, { redactUsers: false });
    // Path prefix is gone
    expect(output).not.toContain("/Users/alice/code");
    // But alice as a standalone word is preserved
    expect(output).toContain("alice");
  });

  it("redactPaths=false + redactUsers=false keeps everything visible", () => {
    const input = "/Users/alice/code/foo.ts";
    const output = sanitizeForSafeExport(input, {
      redactPaths: false,
      redactUsers: false,
    });
    expect(output).toContain("alice");
    expect(output).toContain("/Users/alice");
  });
});

// ---------------------------------------------------------------------------
// Email redaction
// ---------------------------------------------------------------------------

describe("sanitizeForSafeExport — email redaction", () => {
  it("replaces email address with HTML-encoded <email> token", () => {
    const input = "Contact alice@example.com for support.";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("alice@example.com");
    expect(output).toContain(TOKEN_EMAIL);
  });

  it("replaces multiple emails in one string", () => {
    const input = "From: alice@example.com, to: bob@company.org";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("alice@example.com");
    expect(output).not.toContain("bob@company.org");
    const count = output.split(TOKEN_EMAIL).length - 1;
    expect(count).toBe(2);
  });

  it("handles emails with dots and dashes in local part", () => {
    const input = "Contact first.last-name@sub.domain.io for info.";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("first.last-name@sub.domain.io");
    expect(output).toContain(TOKEN_EMAIL);
  });

  it("redactEmails=false preserves email addresses", () => {
    const input = "Contact alice@example.com for support.";
    const output = sanitizeForSafeExport(input, { redactEmails: false });
    expect(output).toContain("alice@example.com");
  });
});

// ---------------------------------------------------------------------------
// Combined redaction
// ---------------------------------------------------------------------------

describe("sanitizeForSafeExport — combined paths + emails", () => {
  it("redacts both paths and emails in a single document", () => {
    const input =
      "Author: alice@example.com\nProject: /Users/alice/myproject/README.md";
    const output = sanitizeForSafeExport(input);
    expect(output).not.toContain("alice@example.com");
    expect(output).not.toContain("/Users/alice");
    expect(output).toContain(TOKEN_EMAIL);
    expect(output).toContain(TOKEN_PATH);
  });

  it("opts.redactPaths=false + opts.redactEmails=true redacts only emails", () => {
    const input = "Path /Users/alice/src/main.ts — email alice@example.com";
    const output = sanitizeForSafeExport(input, {
      redactPaths: false,
      redactUsers: false,
      redactEmails: true,
    });
    expect(output).toContain("/Users/alice");
    expect(output).not.toContain("alice@example.com");
    expect(output).toContain(TOKEN_EMAIL);
  });

  it("opts.redactPaths=true + opts.redactEmails=false + redactUsers=false redacts only paths", () => {
    // With redactUsers=false, the username extracted from the path is NOT
    // replaced globally, so "alice" survives in the email address.
    const input = "Path /Users/alice/src/main.ts — email alice@example.com";
    const output = sanitizeForSafeExport(input, {
      redactPaths: true,
      redactUsers: false,
      redactEmails: false,
    });
    expect(output).not.toContain("/Users/alice");
    expect(output).toContain("alice@example.com");
  });

  it("opts.redactPaths=true + redactUsers=true replaces username globally (known edge case)", () => {
    // Known edge case: username from path replaces ALL occurrences including in email.
    // If you want to preserve the email local-part, use redactUsers=false.
    const input = "Path /Users/alice/src/main.ts — email alice@example.com";
    const output = sanitizeForSafeExport(input, {
      redactPaths: true,
      redactUsers: true,
      redactEmails: false,
    });
    expect(output).not.toContain("/Users/alice");
    // "alice" is replaced globally — the email local part becomes the user token
    expect(output).not.toContain("alice");
  });
});

// ---------------------------------------------------------------------------
// Timestamp redaction (opt-in)
// ---------------------------------------------------------------------------

describe("sanitizeForSafeExport — timestamp redaction", () => {
  it("default: does NOT strip timestamps", () => {
    const input = "Happened at 2026-05-15T14:30:00 UTC.";
    const output = sanitizeForSafeExport(input);
    expect(output).toContain("2026-05-15T14:30:00");
  });

  it("redactTimes=true trims RFC3339 timestamp to date portion", () => {
    const input = "Happened at 2026-05-15T14:30:00 UTC.";
    const output = sanitizeForSafeExport(input, { redactTimes: true });
    expect(output).not.toContain("T14:30:00");
    expect(output).toContain("2026-05-15");
  });

  it("redactTimes=true handles multiple timestamps", () => {
    const input =
      "Start: 2026-01-01T08:00:00 — End: 2026-01-01T17:30:59";
    const output = sanitizeForSafeExport(input, { redactTimes: true });
    expect(output).not.toContain("T08:00:00");
    expect(output).not.toContain("T17:30:59");
    expect(output).toContain("2026-01-01");
  });

  it("redactTimes=false (explicit) leaves timestamps intact", () => {
    const input = "At 2026-05-15T14:30:00 the session started.";
    const output = sanitizeForSafeExport(input, { redactTimes: false });
    expect(output).toContain("2026-05-15T14:30:00");
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("sanitizeForSafeExport — idempotency", () => {
  it("sanitizing twice produces the same output as sanitizing once", () => {
    const input =
      "File /Users/alice/code/foo.ts — alice@example.com — time 2026-05-15T12:00:00";
    const once = sanitizeForSafeExport(input, { redactTimes: true });
    const twice = sanitizeForSafeExport(once, { redactTimes: true });
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// No-op on clean content
// ---------------------------------------------------------------------------

describe("sanitizeForSafeExport — no-op on clean content", () => {
  it("returns unchanged string when no paths, emails, or timestamps present", () => {
    const input = "Everything looks clean here. No secrets at all.";
    const output = sanitizeForSafeExport(input);
    expect(output).toBe(input);
  });

  it("handles empty string", () => {
    expect(sanitizeForSafeExport("")).toBe("");
  });
});

/**
 * Unit tests: renderEventBody (export-replan P2, INV-11, R-50).
 *
 * Asserts:
 *   - Plain markdown converts to expected HTML.
 *   - Adversarial markdown with <script> is stripped.
 *   - Inline event handlers (onclick, onmouseenter) are stripped.
 *   - `javascript:` URIs in href are stripped.
 *   - `data:image/*` URIs on <img> are preserved.
 *   - Empty input returns empty string.
 */

import { describe, it, expect } from "vitest";
import { renderEventBody } from "../../src/generate/markdown-body.js";

describe("renderEventBody", () => {
  it("renders plain markdown to inner HTML (no <html>/<body> wrapper)", async () => {
    const out = await renderEventBody("# Hello\n\nA **bold** paragraph.");
    expect(out).not.toContain("<html");
    expect(out).not.toContain("<body");
    expect(out).toMatch(/<h1[^>]*>Hello<\/h1>/);
    expect(out).toContain("<strong>bold</strong>");
  });

  it("strips <script> tags", async () => {
    const out = await renderEventBody(
      "Hello\n\n<script>alert('xss')</script>\n\nWorld",
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
  });

  it("strips inline event handlers from rendered links", async () => {
    const out = await renderEventBody(
      `<a href="https://example.com" onclick="alert(1)">link</a>`,
    );
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("alert");
  });

  it("strips javascript: URIs", async () => {
    const out = await renderEventBody(`[click](javascript:alert(1))`);
    // The anchor either drops the href or rewrites it; in either case the
    // dangerous protocol must not survive.
    expect(out).not.toContain("javascript:");
  });

  it("preserves data:image/* URIs on <img>", async () => {
    const dataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const out = await renderEventBody(`![pixel](${dataUri})`);
    expect(out).toContain(dataUri);
    expect(out).toMatch(/<img[^>]+src="data:image\/png/);
  });

  it("returns empty string for empty input", async () => {
    expect(await renderEventBody("")).toBe("");
    expect(await renderEventBody("   \n   ")).toBe("");
  });

  it("returns empty string for non-string input (defensive)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await renderEventBody(undefined as any)).toBe("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await renderEventBody(null as any)).toBe("");
  });
});

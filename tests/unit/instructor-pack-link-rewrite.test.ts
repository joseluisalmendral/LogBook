/**
 * Unit tests for rewriteDocLinks — converts relative .md cross-document
 * links into in-bundle anchors. External links and image links are unchanged.
 *
 * Strict TDD — written before implementation.
 */

import { describe, it, expect } from "vitest";
import { rewriteDocLinks } from "../../src/export/instructor-pack.js";

describe("rewriteDocLinks", () => {
  it("rewrites simple .md link to anchor", () => {
    const input = "[ADR 0001](0001-use-vite.md)";
    const result = rewriteDocLinks(input);
    expect(result).toBe("[ADR 0001](#0001-use-vite)");
  });

  it("rewrites .md link with leading ./", () => {
    const input = "[link](./0002-foo.md)";
    const result = rewriteDocLinks(input);
    expect(result).toBe("[link](#0002-foo)");
  });

  it("rewrites .md link with ../ prefix (cross-dir)", () => {
    const input = "[link](../decisions/0003-bar.md)";
    const result = rewriteDocLinks(input);
    expect(result).toBe("[link](#0003-bar)");
  });

  it("preserves https:// external link unchanged", () => {
    const input = "[external](https://example.com)";
    const result = rewriteDocLinks(input);
    expect(result).toBe("[external](https://example.com)");
  });

  it("preserves http:// external link unchanged", () => {
    const input = "[docs](http://docs.example.org/page)";
    const result = rewriteDocLinks(input);
    expect(result).toBe("[docs](http://docs.example.org/page)");
  });

  it("preserves image links unchanged (! prefix)", () => {
    const input = "![image](https://cdn.example/img.png)";
    const result = rewriteDocLinks(input);
    expect(result).toBe("![image](https://cdn.example/img.png)");
  });

  it("preserves plain text that is not a link", () => {
    const input = "[plain text]";
    const result = rewriteDocLinks(input);
    expect(result).toBe("[plain text]");
  });

  it("handles multiple .md links in the same string", () => {
    const input =
      "[ADR 0001](0001-use-vite.md) and [ADR 0002](0002-use-typescript.md)";
    const result = rewriteDocLinks(input);
    expect(result).toBe("[ADR 0001](#0001-use-vite) and [ADR 0002](#0002-use-typescript)");
  });

  it("preserves .md links that are inside image syntax unchanged", () => {
    // Image links should NOT be rewritten even if they point to .md files
    const input = "![img](./something.md)";
    const result = rewriteDocLinks(input);
    // Image links with .md are left unchanged (images, not doc links)
    expect(result).toBe("![img](./something.md)");
  });

  it("rewrites deeply nested path — only filename stem matters", () => {
    const input = "[ref](some/deep/path/to/0004-my-adr.md)";
    const result = rewriteDocLinks(input);
    expect(result).toBe("[ref](#0004-my-adr)");
  });

  it("does not rewrite links to non-.md files", () => {
    const input = "[download](./file.pdf)";
    const result = rewriteDocLinks(input);
    expect(result).toBe("[download](./file.pdf)");
  });

  it("handles empty string input", () => {
    expect(rewriteDocLinks("")).toBe("");
  });
});

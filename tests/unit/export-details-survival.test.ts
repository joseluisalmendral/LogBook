/**
 * ADR-23 decision gate: assert that <details>/<summary> elements survive
 * the unified markdown-to-HTML pipeline (SR-3).
 *
 * If this test FAILS:
 *   The remark-rehype pipeline strips or mangles raw HTML blocks.
 *   Fall back to the placeholder pattern: call preprocessDetailsPlaceholders()
 *   before the pipeline and injectDetailsDivs() after, mirroring the mermaid
 *   approach. This is already implemented in markdown-to-html.ts.
 *
 * NOTE: markdownToHtml already uses preprocessDetailsPlaceholders internally,
 * so this test validates the full pipeline (placeholder → inject → output).
 */

import { describe, it, expect } from "vitest";
import { markdownToHtml } from "../../src/export/markdown-to-html.js";

const DETAILS_MARKDOWN = `
Some intro text.

<details>
<summary>Click to expand</summary>
<div>
Content inside details.
</div>
</details>

After details text.
`.trim();

describe("details survival through unified pipeline (ADR-23)", () => {
  it("<details> element survives markdownToHtml", async () => {
    const html = await markdownToHtml(DETAILS_MARKDOWN);
    expect(html).toContain("<details>");
    expect(html).toContain("</details>");
  });

  it("<summary> element survives markdownToHtml", async () => {
    const html = await markdownToHtml(DETAILS_MARKDOWN);
    expect(html).toContain("<summary>");
    expect(html).toContain("</summary>");
  });

  it("summary text content is preserved", async () => {
    const html = await markdownToHtml(DETAILS_MARKDOWN);
    expect(html).toContain("Click to expand");
  });

  it("inner div content is preserved", async () => {
    const html = await markdownToHtml(DETAILS_MARKDOWN);
    expect(html).toContain("Content inside details");
  });

  it("<details open> attribute survives", async () => {
    const md = `<details open>\n<summary>Open</summary>\n<div>Body</div>\n</details>`;
    const html = await markdownToHtml(md);
    expect(html).toContain("<details");
    expect(html).toContain("open");
    expect(html).toContain("</details>");
  });

  it("surrounding content is unaffected", async () => {
    const html = await markdownToHtml(DETAILS_MARKDOWN);
    expect(html).toContain("Some intro text");
    expect(html).toContain("After details text");
  });
});

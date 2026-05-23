/**
 * Unit tests — extended allowlist for the export-replan vendored bundle.
 *
 * P5 R-44 / AG-2: assertNoExternalRefs must accept:
 *   - XML namespace URIs (xmlns / xlink / MathML)
 *   - Svelte 5 runtime doc URLs (https://svelte.dev/e/<code>)
 * while continuing to reject every other http(s):// URL outside ALLOWED_HOSTS.
 */

import { describe, it, expect } from "vitest";
import {
  assertNoExternalRefs,
  isXmlNamespaceUri,
  isSvelteDocUri,
} from "../../src/export/sanitize-links.js";

describe("sanitize-links — Svelte + XML namespace allowlist (P5 R-44)", () => {
  it("isXmlNamespaceUri accepts the SVG, xlink, xhtml, XML, MathML namespaces", () => {
    expect(isXmlNamespaceUri("http://www.w3.org/2000/svg")).toBe(true);
    expect(isXmlNamespaceUri("http://www.w3.org/1999/xlink")).toBe(true);
    expect(isXmlNamespaceUri("http://www.w3.org/1999/xhtml")).toBe(true);
    expect(isXmlNamespaceUri("http://www.w3.org/XML/1998/namespace")).toBe(true);
    expect(isXmlNamespaceUri("http://www.w3.org/1998/Math/MathML")).toBe(true);
  });

  it("isXmlNamespaceUri rejects every other w3.org-looking URL", () => {
    expect(isXmlNamespaceUri("http://www.w3.org/")).toBe(false);
    expect(isXmlNamespaceUri("https://www.w3.org/2000/svg")).toBe(false);
    expect(isXmlNamespaceUri("http://attacker.com/2000/svg")).toBe(false);
  });

  it("isSvelteDocUri accepts the svelte.dev/e/* prefix only", () => {
    expect(isSvelteDocUri("https://svelte.dev/e/effect_in_teardown")).toBe(true);
    expect(isSvelteDocUri("https://svelte.dev/e/lifecycle_outside_component")).toBe(true);
    expect(isSvelteDocUri("https://svelte.dev/docs/intro")).toBe(false);
    expect(isSvelteDocUri("https://svelte.dev")).toBe(false);
    expect(isSvelteDocUri("https://attacker.com/svelte.dev/e/foo")).toBe(false);
  });

  it("assertNoExternalRefs accepts HTML containing only XML namespace URIs", () => {
    const html = `<svg xmlns="http://www.w3.org/2000/svg"><g xmlns:xlink="http://www.w3.org/1999/xlink"></g></svg>`;
    const result = assertNoExternalRefs(html);
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBeGreaterThanOrEqual(2);
  });

  it("assertNoExternalRefs accepts HTML containing only Svelte runtime doc URLs", () => {
    const html = `<script>throw new Error("see https://svelte.dev/e/effect_in_teardown for details");</script>`;
    const result = assertNoExternalRefs(html);
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBeGreaterThanOrEqual(1);
  });

  it("assertNoExternalRefs still rejects http:// (downgrade)", () => {
    expect(() =>
      assertNoExternalRefs(`<a href="http://github.com/foo">x</a>`),
    ).toThrow(/external references detected/);
  });

  it("assertNoExternalRefs still rejects arbitrary https:// outside the allowlist", () => {
    expect(() =>
      assertNoExternalRefs(`<img src="https://cdn.evil.com/tracker.gif">`),
    ).toThrow(/external references detected/);
  });

  it("assertNoExternalRefs still rejects protocol-relative // URLs by way of external script", () => {
    expect(() =>
      assertNoExternalRefs(`<script src="//cdn.evil.com/tracker.js"></script>`),
    ).toThrow(/external (scripts|references) found|external references detected/i);
  });

  it("assertNoExternalRefs accepts a mixed valid set (allowed git hosts + namespace + svelte/e)", () => {
    const html = `
      <a href="https://github.com/org/repo">commit</a>
      <svg xmlns="http://www.w3.org/2000/svg"></svg>
      <script>const e = "https://svelte.dev/e/state_descriptors_fixed";</script>
    `;
    const result = assertNoExternalRefs(html);
    expect(result.externalRefs).toBe(0);
    expect(result.allowedRefs).toBeGreaterThanOrEqual(3);
  });
});

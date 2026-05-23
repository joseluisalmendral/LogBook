/*
 * Unit tests for feature-detect.ts — slice 12 P1.
 *
 * The functions are pure CSS.supports probes. We stub the platform globals
 * to assert both branches (native + fallback) without depending on the host
 * vitest environment's exact Chromium version.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFeatureDetectAttributes,
  supportsCSSProperty,
  supportsScrollTimeline,
} from "../src/lib/util/feature-detect";

describe("supportsScrollTimeline", () => {
  const originalCSS = globalThis.CSS;

  afterEach(() => {
    // Restore whatever vitest provided. jsdom does not ship CSS by default.
    (globalThis as { CSS?: unknown }).CSS = originalCSS;
  });

  it("returns false when CSS global is missing", () => {
    (globalThis as { CSS?: unknown }).CSS = undefined;
    expect(supportsScrollTimeline()).toBe(false);
  });

  it("returns false when CSS.supports throws", () => {
    (globalThis as { CSS?: unknown }).CSS = {
      supports: () => {
        throw new Error("boom");
      },
    };
    expect(supportsScrollTimeline()).toBe(false);
  });

  it("returns true when CSS.supports reports native scroll-timeline", () => {
    const supports = vi.fn((q: string) => q === "animation-timeline: scroll()");
    (globalThis as { CSS?: unknown }).CSS = { supports };
    expect(supportsScrollTimeline()).toBe(true);
    expect(supports).toHaveBeenCalledWith("animation-timeline: scroll()");
  });

  it("returns false when CSS.supports rejects the query", () => {
    (globalThis as { CSS?: unknown }).CSS = { supports: () => false };
    expect(supportsScrollTimeline()).toBe(false);
  });
});

describe("supportsCSSProperty", () => {
  const originalCSS = globalThis.CSS;

  afterEach(() => {
    (globalThis as { CSS?: unknown }).CSS = originalCSS;
  });

  it("returns true when CSS.registerProperty exists", () => {
    (globalThis as { CSS?: unknown }).CSS = { registerProperty: () => {} };
    expect(supportsCSSProperty()).toBe(true);
  });

  it("returns false when CSS.registerProperty is missing", () => {
    (globalThis as { CSS?: unknown }).CSS = {};
    expect(supportsCSSProperty()).toBe(false);
  });

  it("returns false when CSS global is missing", () => {
    (globalThis as { CSS?: unknown }).CSS = undefined;
    expect(supportsCSSProperty()).toBe(false);
  });
});

describe("applyFeatureDetectAttributes", () => {
  const originalDoc = globalThis.document;
  const originalCSS = globalThis.CSS;

  beforeEach(() => {
    // Minimal document stub.
    const html: Record<string, string> = {};
    (globalThis as { document?: unknown }).document = {
      documentElement: {
        setAttribute(name: string, value: string): void {
          html[name] = value;
        },
        _attrs: html,
      },
    };
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = originalDoc;
    (globalThis as { CSS?: unknown }).CSS = originalCSS;
  });

  it("writes native attribute when scroll-timeline supported", () => {
    (globalThis as { CSS?: unknown }).CSS = {
      supports: () => true,
      registerProperty: () => {},
    };
    applyFeatureDetectAttributes();
    const el = (globalThis.document as unknown as { documentElement: { _attrs: Record<string, string> } })
      .documentElement;
    expect(el._attrs["data-scroll-timeline"]).toBe("native");
    expect(el._attrs["data-css-property"]).toBe("native");
  });

  it("writes fallback attribute when scroll-timeline unsupported", () => {
    (globalThis as { CSS?: unknown }).CSS = { supports: () => false };
    applyFeatureDetectAttributes();
    const el = (globalThis.document as unknown as { documentElement: { _attrs: Record<string, string> } })
      .documentElement;
    expect(el._attrs["data-scroll-timeline"]).toBe("fallback");
    expect(el._attrs["data-css-property"]).toBe("fallback");
  });

  it("is a no-op when document is missing", () => {
    (globalThis as { document?: unknown }).document = undefined;
    expect(() => applyFeatureDetectAttributes()).not.toThrow();
  });
});

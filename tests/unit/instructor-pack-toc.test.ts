/**
 * Unit tests for generateToc — extracts H1/H2 headings from bundle sections
 * and produces a nested markdown TOC with in-bundle anchors.
 *
 * Strict TDD — written before implementation.
 */

import { describe, it, expect } from "vitest";
import { generateToc } from "../../src/export/instructor-pack.js";
import type { BundleContents } from "../../src/export/instructor-pack.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBundle(overrides?: Partial<BundleContents>): BundleContents {
  return {
    overview: [
      {
        id: "index",
        title: "Project Index",
        content: "# Project Index\n\n## Sessions\n\nSome content.\n",
      },
      {
        id: "timeline",
        title: "Timeline",
        content: "# Timeline\n\n## 2026-01\n\nSome events.\n",
      },
      {
        id: "errors-and-lessons",
        title: "Errors and Lessons",
        content: "# Errors and Lessons\n\n## Lessons\n\nSome lessons.\n",
      },
    ],
    adrs: [
      {
        id: "0001-use-vite",
        title: "Use Vite",
        content: "# Use Vite\n\n## Context\n\nWe evaluated bundlers.\n",
      },
      {
        id: "0002-use-typescript",
        title: "Use TypeScript",
        content: "# Use TypeScript\n\n## Decision\n\nStrict mode.\n",
      },
    ],
    teachingScripts: [
      {
        id: "session-01",
        title: "Session 01",
        content:
          "# Session 01\n\n## Introduction\n\nTeaching content.\n",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateToc", () => {
  it("returns a non-empty string", () => {
    const toc = generateToc(makeBundle());
    expect(typeof toc).toBe("string");
    expect(toc.length).toBeGreaterThan(0);
  });

  it("contains links to all ADR section ids", () => {
    const toc = generateToc(makeBundle());
    expect(toc).toContain("#0001-use-vite");
    expect(toc).toContain("#0002-use-typescript");
  });

  it("contains links to teaching script section ids", () => {
    const toc = generateToc(makeBundle());
    expect(toc).toContain("#session-01");
  });

  it("contains links to overview section ids", () => {
    const toc = generateToc(makeBundle());
    expect(toc).toContain("#index");
    expect(toc).toContain("#timeline");
  });

  it("H2 headings inside sections appear as nested entries", () => {
    const bundle = makeBundle();
    const toc = generateToc(bundle);
    // "## Context" inside the 0001-use-vite ADR should produce a nested link
    expect(toc).toContain("Context");
  });

  it("special chars in title produce valid anchor (lowercase, hyphens)", () => {
    const bundle = makeBundle({
      adrs: [
        {
          id: "0003-special",
          title: "Use Node.js & Bun!",
          content: "# Use Node.js & Bun!\n\n## Why?\n\nReason.\n",
        },
      ],
    });
    const toc = generateToc(bundle);
    // The anchor should contain "0003-special" (the section id is always safe)
    expect(toc).toContain("#0003-special");
  });

  it("generates a TOC with at least one markdown link", () => {
    const toc = generateToc(makeBundle());
    // Markdown link syntax: [text](#anchor)
    expect(toc).toMatch(/\[.+\]\(#.+\)/);
  });

  it("empty bundle sections produce a minimal TOC", () => {
    const bundle = makeBundle({ adrs: [], teachingScripts: [] });
    const toc = generateToc(bundle);
    // Should still contain overview entries
    expect(toc).toContain("#index");
  });
});

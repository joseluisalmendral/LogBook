/**
 * Unit tests: buildResourcesDoc (RI-1, ADR-30).
 *
 * Verifies:
 *   - Per-kind subsection emitted
 *   - Correct icon prefix per kind
 *   - Tag chip HTML present when tags defined
 *   - Empty-state message when no resources
 *   - tagHue() produces consistent deterministic values
 */

import { describe, it, expect } from "vitest";
import { buildResourcesDoc, tagHue } from "../../src/generate/resources-doc.js";
import type { RenderContext } from "../../src/generate/render-context.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    sessions: [],
    phases: [],
    decisions: [],
    errors: [],
    fixes: [],
    lessons: [],
    resources: [],
    visuals: [],
    milestones: [],
    all: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildResourcesDoc — empty context", () => {
  it("returns empty-state message when no resources", () => {
    const md = buildResourcesDoc(makeCtx());
    expect(md).toContain("# Resources");
    expect(md).toContain("No resources recorded yet");
  });
});

describe("buildResourcesDoc — per-kind subsections (RI-1)", () => {
  it("emits link icon 🔗 for link kind", () => {
    const ctx = makeCtx({
      resources: [
        {
          id: "r1",
          type: "manual.resource",
          ts: "2024-01-01T10:00:00Z",
          title: "MDN Docs",
          kind: "link",
          url: "https://github.com/mdn",
        },
      ],
    });
    const md = buildResourcesDoc(ctx);
    expect(md).toContain("🔗");
    expect(md).toContain("## 🔗 Link");
  });

  it("emits doc icon 📄 for doc kind", () => {
    const ctx = makeCtx({
      resources: [
        {
          id: "r1",
          type: "manual.resource",
          ts: "2024-01-01T10:00:00Z",
          title: "Design Doc",
          kind: "doc",
        },
      ],
    });
    const md = buildResourcesDoc(ctx);
    expect(md).toContain("📄");
  });

  it("emits ref icon 🔖 for ref kind", () => {
    const ctx = makeCtx({
      resources: [
        {
          id: "r1",
          type: "manual.resource",
          ts: "2024-01-01T10:00:00Z",
          title: "Spec Reference",
          kind: "ref",
        },
      ],
    });
    const md = buildResourcesDoc(ctx);
    expect(md).toContain("🔖");
  });

  it("emits fallback ▸ for unknown kind", () => {
    const ctx = makeCtx({
      resources: [
        {
          id: "r1",
          type: "manual.resource",
          ts: "2024-01-01T10:00:00Z",
          title: "Misc Resource",
          kind: "video",
        },
      ],
    });
    const md = buildResourcesDoc(ctx);
    expect(md).toContain("▸");
  });

  it("emits multiple kind sections", () => {
    const ctx = makeCtx({
      resources: [
        {
          id: "r1",
          type: "manual.resource",
          ts: "2024-01-01T10:00:00Z",
          title: "A Link",
          kind: "link",
        },
        {
          id: "r2",
          type: "manual.resource",
          ts: "2024-01-02T10:00:00Z",
          title: "A Doc",
          kind: "doc",
        },
      ],
    });
    const md = buildResourcesDoc(ctx);
    expect(md).toContain("🔗");
    expect(md).toContain("📄");
  });
});

describe("buildResourcesDoc — tag chips (ADR-30)", () => {
  it("emits .lb-tag chip when tags present", () => {
    const ctx = makeCtx({
      resources: [
        {
          id: "r1",
          type: "manual.resource",
          ts: "2024-01-01T10:00:00Z",
          title: "Tagged Resource",
          kind: "link",
          tags: ["frontend", "performance"],
        },
      ],
    });
    const md = buildResourcesDoc(ctx);
    expect(md).toContain('class="lb-tag"');
    expect(md).toContain("frontend");
    expect(md).toContain("performance");
  });

  it("emits --lb-tag-h CSS custom property for hue", () => {
    const ctx = makeCtx({
      resources: [
        {
          id: "r1",
          type: "manual.resource",
          ts: "2024-01-01T10:00:00Z",
          title: "Tagged",
          kind: "link",
          tags: ["api"],
        },
      ],
    });
    const md = buildResourcesDoc(ctx);
    expect(md).toContain("--lb-tag-h:");
  });
});

// ---------------------------------------------------------------------------
// tagHue — ADR-30
// ---------------------------------------------------------------------------

describe("tagHue — deterministic HSL hue (ADR-30)", () => {
  it("returns the same value for the same input", () => {
    expect(tagHue("frontend")).toBe(tagHue("frontend"));
    expect(tagHue("backend")).toBe(tagHue("backend"));
  });

  it("returns a value in [0, 359] range", () => {
    const tags = ["frontend", "backend", "api", "testing", "auth", "db", "ui"];
    for (const tag of tags) {
      const hue = tagHue(tag);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("returns different values for different tags (usually)", () => {
    // Not guaranteed (hash collisions possible), but for our sample it should differ.
    expect(tagHue("frontend")).not.toBe(tagHue("backend"));
  });

  it("handles empty string without throwing", () => {
    expect(() => tagHue("")).not.toThrow();
    expect(tagHue("")).toBeGreaterThanOrEqual(0);
    expect(tagHue("")).toBeLessThan(360);
  });
});

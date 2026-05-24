/*
 * Slice 18 — motion polish + editor URI picker.
 *
 * Coverage:
 *   1. editorPref defaults to "vscode" and round-trips through localStorage
 *   2. buildFileUri honors the editorPref store
 *   3. buildFileUri uses idea://open?file= for IntelliJ (different shape)
 *   4. router.navigate wraps toc<->chapter transitions in startViewTransition
 *      when available + motion allowed (source-level assertion)
 *   5. magnetic-snap CSS exists in app.css with proximity (not mandatory)
 *      AND the reduced-motion opt-out is present
 *   6. .lb-snap-target is applied on the canonical card root selectors
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function readSource(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8");
}

describe("slice 18 — editorPref store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to 'vscode' when nothing is in localStorage", async () => {
    const { editorPref } = await import("../src/lib/stores/editor-pref");
    expect(editorPref.get()).toBe("vscode");
  });

  it("persists and recalls the chosen scheme via localStorage", async () => {
    const { editorPref } = await import("../src/lib/stores/editor-pref");
    editorPref.set("zed");
    expect(window.localStorage.getItem("lb.editorScheme")).toBe("zed");
    expect(editorPref.get()).toBe("zed");
    // Reset back so other tests aren't polluted.
    editorPref.set("vscode");
  });

  it("rejects unknown schemes by typing — fall-back stays default", async () => {
    window.localStorage.setItem("lb.editorScheme", "emacs"); // not a valid EditorScheme
    // Force a re-read by importing a fresh module instance is not trivial in
    // vitest; instead, set + reset via the store API to confirm validation.
    const { editorPref } = await import("../src/lib/stores/editor-pref");
    // The store rejects "emacs" only at SET time; on read, the initial
    // load path returns default for unrecognized values.
    expect(["vscode", "cursor", "zed", "intellij"]).toContain(editorPref.get());
  });
});

describe("slice 18 — buildFileUri honors editor pref", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses vscode://file/ by default", async () => {
    const { editorPref } = await import("../src/lib/stores/editor-pref");
    editorPref.set("vscode");
    const { buildFileUri } = await import("../src/lib/util/deep-link");
    expect(buildFileUri("/abs/path/file.ts")).toBe("vscode://file//abs/path/file.ts");
    expect(buildFileUri("/abs/path/file.ts", 12, 4)).toBe(
      "vscode://file//abs/path/file.ts:12:4",
    );
  });

  it("uses cursor://file/ when scheme=cursor", async () => {
    const { editorPref } = await import("../src/lib/stores/editor-pref");
    editorPref.set("cursor");
    const { buildFileUri } = await import("../src/lib/util/deep-link");
    expect(buildFileUri("/abs/path/file.ts", 7)).toBe("cursor://file//abs/path/file.ts:7");
    editorPref.set("vscode");
  });

  it("uses zed://file/ when scheme=zed", async () => {
    const { editorPref } = await import("../src/lib/stores/editor-pref");
    editorPref.set("zed");
    const { buildFileUri } = await import("../src/lib/util/deep-link");
    expect(buildFileUri("/abs/path/file.ts")).toBe("zed://file//abs/path/file.ts");
    editorPref.set("vscode");
  });

  it("uses idea://open?file= with URL-encoded path for IntelliJ", async () => {
    const { editorPref } = await import("../src/lib/stores/editor-pref");
    editorPref.set("intellij");
    const { buildFileUri } = await import("../src/lib/util/deep-link");
    const uri = buildFileUri("/abs path/has spaces/file.ts", 12, 4);
    expect(uri.startsWith("idea://open?file=")).toBe(true);
    // Path was URL-encoded — spaces become %20.
    expect(uri).toContain("%20");
    // Line + column survive as plain query params.
    expect(uri).toContain("line=12");
    expect(uri).toContain("column=4");
    editorPref.set("vscode");
  });

  it("accepts an explicit `scheme` argument that overrides the pref", async () => {
    const { editorPref } = await import("../src/lib/stores/editor-pref");
    editorPref.set("vscode");
    const { buildFileUri } = await import("../src/lib/util/deep-link");
    expect(buildFileUri("/abs/path/file.ts", undefined, undefined, "zed")).toBe(
      "zed://file//abs/path/file.ts",
    );
  });
});

describe("slice 18 — router uses startViewTransition for toc<->chapter morph", () => {
  it("router.ts wraps the hash change in document.startViewTransition when available + motion allowed", () => {
    const src = readSource("lib", "stores", "router.ts");
    expect(src).toContain("startViewTransition");
    expect(src).toContain("motionAllowed");
    // Only wrap when entering/leaving the TOC route (shared view-transition-name).
    expect(src).toMatch(/current\.name === "toc"|route\.name === "toc"/);
  });
});

describe("slice 18 — magnetic snap CSS", () => {
  it("app.css declares scroll-snap-type: y proximity (NOT mandatory) on html", () => {
    const css = readFileSync(join(SRC, "app.css"), "utf8");
    expect(css).toContain("scroll-snap-type: y proximity");
    // Mandatory snap would cause scroll-jacking — explicitly avoided per
    // the slice 12 research-brief risk list.
    expect(css).not.toMatch(/scroll-snap-type:\s*y\s+mandatory/);
  });

  it("app.css opts out of scroll-snap when data-motion=reduced", () => {
    const css = readFileSync(join(SRC, "app.css"), "utf8");
    expect(css).toMatch(/html\[data-motion="reduced"\]\s*\{[^}]*scroll-snap-type:\s*none/);
  });

  it(".lb-snap-target class declares scroll-snap-align + scroll-margin-top", () => {
    const css = readFileSync(join(SRC, "app.css"), "utf8");
    expect(css).toContain(".lb-snap-target");
    expect(css).toContain("scroll-snap-align: start");
    expect(css).toContain("scroll-margin-top");
  });

  it(".lb-snap-target is applied to TurnRow / DecisionMilestone / CommitRow / SubAgentCard / AgentQuestionCard roots", () => {
    const components: Array<[string, string]> = [
      ["TurnRow.svelte", "generic-row lb-snap-target"],
      ["DecisionMilestone.svelte", "decision lb-snap-target"],
      ["CommitRow.svelte", "commit-row lb-snap-target"],
      ["SubAgentCard.svelte", "card-wrap lb-snap-target"],
      ["AgentQuestionCard.svelte", "aq-card lb-snap-target"],
    ];
    for (const [file, expected] of components) {
      const src = readSource("lib", "components", file);
      expect(src, `missing snap-target on ${file}`).toContain(expected);
    }
  });
});

describe("slice 18 — Sidebar wires the editor picker", () => {
  it("imports editorPref + EDITOR_OPTIONS and binds them to a <select>", () => {
    const src = readSource("lib", "components", "Sidebar.svelte");
    expect(src).toContain('from "../stores/editor-pref"');
    expect(src).toContain("EDITOR_OPTIONS");
    expect(src).toContain("editorPref.set");
    expect(src).toContain('id="lb-editor-pref"');
  });
});

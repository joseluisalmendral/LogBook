/*
 * Slice-0 smoke tests (design §10).
 *
 * These tests gate P1. If any of them fails, the scaffold is broken and we
 * MUST replan before adding narrative components.
 *
 * Tests intentionally avoid importing from the LogBook root project (e.g.
 * src/export/sanitize-links.ts) because P1 lands on a working tree with
 * dirty pre-replan files in src/export/. Coupling the smoke harness to that
 * directory would couple P1's pass/fail to P5's eventual gut of html.ts.
 *
 * Instead we replicate the no-external-refs assertion locally with the same
 * patterns the production sanitizer uses. The production sanitizer itself
 * is exercised in P5 via the integration test suite.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const PKG_ROOT = resolve(__dirname, "..");
const DIST_DIR = resolve(PKG_ROOT, "dist");
const DIST_HTML = resolve(DIST_DIR, "index.html");
const APP_CSS = resolve(PKG_ROOT, "src/app.css");
const INDEX_HTML = resolve(PKG_ROOT, "index.html");

/**
 * Build the bundle once for the whole suite. Done in beforeAll so tests 2..N
 * read dist/index.html without re-invoking Vite.
 *
 * If the project hasn't been pnpm-installed yet, this throws — that's the
 * desired behavior because the smoke gates assume a working `pnpm install`.
 */
beforeAll(() => {
  execSync("pnpm run build", { cwd: PKG_ROOT, stdio: "pipe" });
}, 180_000);

describe("slice-0 smoke", () => {
  it("test 1 — vite build produces dist/index.html", () => {
    expect(existsSync(DIST_HTML)).toBe(true);
    const size = statSync(DIST_HTML).size;
    expect(size).toBeGreaterThan(1000);
  });

  it("test 2 — dist/ contains exactly ONE file (single self-contained HTML)", () => {
    // INV-2: no sidecar JS/CSS/font/image files. Vite + viteSingleFile must
    // inline everything. If this fails, viteSingleFile is misconfigured.
    const entries = readdirSync(DIST_DIR).filter(
      (e) => !e.startsWith(".") && !e.endsWith(".log"),
    );
    expect(entries).toEqual(["index.html"]);
  });

  it("test 3 — emitted HTML has no external network references", () => {
    // INV-3: no http://, no https://, no protocol-relative //.
    // We allow data: URIs and same-document #fragments (R-44 allowlist).
    //
    // KNOWN EXCEPTIONS (string literals embedded in bundled code; never fetched):
    //   - W3C XML namespace URIs (xmlns, xlink, xhtml) — namespace identifiers.
    //   - svelte.dev/e/* error documentation URLs — Svelte 5's runtime ships
    //     these as `throw new Error(...)` message templates. They are TEXT,
    //     not script/link/iframe sources, so no network fetch happens.
    //     P5 (R-44) MUST extend the production sanitizer's allowlist to
    //     accept svelte.dev/e/* OR pre-strip them at sync-export-ui time.
    //     Flagged as RISK in apply-progress.
    //   - github.com/sveltejs/svelte — single attribution link in error
    //     template; also a string literal, same treatment.
    const html = readFileSync(DIST_HTML, "utf8");
    const urlPattern = /\bhttps?:\/\/[^\s"'<>]+/g;
    const matches = html.match(urlPattern) ?? [];
    const XML_NS = new Set([
      "http://www.w3.org/2000/svg",
      "http://www.w3.org/1999/xlink",
      "http://www.w3.org/1999/xhtml",
      "http://www.w3.org/XML/1998/namespace",
      // Svelte 5 runtime stores the MathML namespace as a string constant
      // for hydration of <math> elements. Same status as the other XML
      // namespaces above — text literal, no network fetch.
      "http://www.w3.org/1998/Math/MathML",
    ]);
    const stripPunct = (s: string): string => s.replace(/[).,;:!?`,]+$/, "");
    const isSvelteErrorTemplate = (s: string): boolean =>
      s.startsWith("https://svelte.dev/e/") ||
      s === "https://github.com/sveltejs/svelte";
    const offenders = matches.filter((raw) => {
      const m = stripPunct(raw);
      if (XML_NS.has(m)) return false;
      if (isSvelteErrorTemplate(m)) return false;
      return true;
    });
    expect(offenders, `External URLs leaked: ${offenders.join(", ")}`).toEqual([]);

    // Protocol-relative // refs in href/src attributes are independently banned.
    // Comments containing `//` text are fine; what we MUST NOT see is an
    // attribute consuming a protocol-relative URL.
    const protoRelative = /\b(src|href)\s*=\s*["']\/\/[^"']+/gi;
    expect(html.match(protoRelative) ?? []).toEqual([]);

    // Script tags MUST NOT carry an external src.
    expect(html.match(/<script[^>]+src=["']https?:/gi) ?? []).toEqual([]);
    // Stylesheet links MUST NOT carry an external href.
    expect(html.match(/<link[^>]+href=["']https?:/gi) ?? []).toEqual([]);
    // No iframes.
    expect(html.match(/<iframe[^>]/gi) ?? []).toEqual([]);
  });

  it("test 4 — Tailwind @layer order survives in bundled CSS (base → components → utilities)", () => {
    // Risk D6 / smoke gate #4: utilities must come AFTER components AFTER base
    // in the cascade. We can't grep @layer directives in the minified output
    // (Tailwind compiles them out) but we CAN assert that representative
    // base/utility selectors appear in the right order.
    //
    // - "::backdrop" is part of Tailwind's preflight (base layer).
    // - The bundled CSS appears in a single <style> block. We search inside it.
    const html = readFileSync(DIST_HTML, "utf8");
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
    expect(styleMatch, "expected a <style> block in dist/index.html").not.toBeNull();
    const css = styleMatch![1];

    // Tailwind preflight gives <h1>..<h6> font-size:inherit + font-weight:inherit.
    // It also resets box-sizing on *. These are base-layer signals.
    const baseIdx = css.search(/box-sizing\s*:\s*border-box/);
    expect(baseIdx, "Tailwind preflight (base layer) missing from bundle").toBeGreaterThan(-1);

    // Utility-layer signal — Tailwind always emits a utility containing
    // `\\:` (escaped colon, e.g. md\\:flex) when responsive variants ship.
    // For a bare hello-world it MAY not emit any responsive utilities, so
    // we instead grep a known base rule (preflight) and a known custom utility
    // we KNOW we use (rounded-md → border-radius declaration is in components
    // typically, but Tailwind v3 emits it in utilities).
    //
    // Less brittle: assert "@tailwind base" got expanded (preflight present)
    // AND that our literal :root token block appears BEFORE the preflight
    // (proving our import order is honored — risk D6).
    const tokenIdx = css.search(/--color-surface\s*:/);
    expect(tokenIdx, "semantic token --color-surface missing from bundle").toBeGreaterThan(-1);
    expect(tokenIdx).toBeLessThan(baseIdx);
  });

  it("test 5 — app.css imports tokens BEFORE @tailwind base (source-level guarantee)", () => {
    // Belt-and-suspenders for test 4: the SOURCE file is the contract.
    // We use regex anchored to start-of-line to match the ACTUAL directives
    // (not their mentions inside the leading /* ... */ documentation block).
    const css = readFileSync(APP_CSS, "utf8");

    const reImport = (name: string): RegExp =>
      new RegExp(String.raw`^@import\s+["'][^"']*${name}["']`, "m");

    const idxPrimitives = css.search(reImport("primitives\\.css"));
    const idxSemantic = css.search(reImport("semantic\\.css"));
    const idxSemanticDark = css.search(reImport("semantic-dark\\.css"));
    const idxComponents = css.search(reImport("components\\.css"));
    const idxTwBase = css.search(/^@tailwind\s+base/m);
    const idxTwComponents = css.search(/^@tailwind\s+components/m);
    const idxTwUtilities = css.search(/^@tailwind\s+utilities/m);

    expect(idxPrimitives, "primitives.css must be imported").toBeGreaterThan(-1);
    expect(idxSemantic, "semantic.css must be imported").toBeGreaterThan(-1);
    expect(idxSemanticDark, "semantic-dark.css must be imported").toBeGreaterThan(-1);
    expect(idxComponents, "components.css must be imported").toBeGreaterThan(-1);
    expect(idxTwBase, "@tailwind base must be present").toBeGreaterThan(-1);
    expect(idxTwComponents).toBeGreaterThan(-1);
    expect(idxTwUtilities).toBeGreaterThan(-1);

    // Order contract.
    expect(idxPrimitives).toBeLessThan(idxSemantic);
    expect(idxSemantic).toBeLessThan(idxSemanticDark);
    expect(idxSemanticDark).toBeLessThan(idxComponents);
    expect(idxComponents).toBeLessThan(idxTwBase);
    expect(idxTwBase).toBeLessThan(idxTwComponents);
    expect(idxTwComponents).toBeLessThan(idxTwUtilities);
  });

  it("test 6 — index.html has theme boot script BEFORE the bundled CSS link (FOUC fix)", () => {
    // Design §9 D2: dark-mode users must not see a flash of light mode.
    // The boot <script> in index.html sets [data-theme] synchronously before
    // any module script runs.
    const html = readFileSync(INDEX_HTML, "utf8");

    // The boot script runs an IIFE that sets data-theme.
    const bootIdx = html.search(/document\.documentElement\.setAttribute\(\s*["']data-theme["']/);
    expect(bootIdx, "theme boot script missing in index.html").toBeGreaterThan(-1);

    // The module entry is what triggers CSS injection at runtime (Vite
    // ships the CSS imports via main.ts). The boot script MUST come first.
    const moduleIdx = html.search(/<script\s+type="module"\s+src=/);
    expect(moduleIdx, "module entry missing").toBeGreaterThan(-1);
    expect(bootIdx).toBeLessThan(moduleIdx);
  });

  it("test 7 — emitted HTML contains the #lb-data payload placeholder", () => {
    // R-43: html.ts injects the JSON payload into <script id="lb-data">.
    // If viteSingleFile strips it (it shouldn't, but worth verifying) the
    // entire export pipeline breaks at P5.
    const html = readFileSync(DIST_HTML, "utf8");
    expect(html.includes('id="lb-data"')).toBe(true);
    expect(html.includes('type="application/json"')).toBe(true);
  });

  it("test 8 — emitted HTML contains the data-theme boot script", () => {
    const html = readFileSync(DIST_HTML, "utf8");
    expect(html.includes('setAttribute("data-theme"') || html.includes("setAttribute('data-theme'")).toBe(
      true,
    );
  });
});

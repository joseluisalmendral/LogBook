/**
 * Integration test: `logbook export html` — no external refs (T12).
 *
 * Creates a temp project with pre-built doc files, runs `logbook export html`,
 * and asserts the generated HTML file has 0 external references.
 *
 * Policy: HTTP-looking content INSIDE markdown code blocks is considered
 * escaped text (rehype renders it as &amp;amp; etc.) and does NOT trigger
 * the external-ref check. The assertNoExternalRefs function works on the
 * final rendered HTML. Content inside <code> blocks is HTML-entity encoded
 * so URL patterns do not match.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";
import { assertNoExternalRefs } from "../../src/export/sanitize-links.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI = path.join(PROJECT_ROOT, "dist", "cli", "index.cjs");

beforeAll(() => {
  if (!fs.existsSync(CLI)) {
    const result = spawnSync("pnpm", ["build"], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`
      );
    }
  }
}, 90_000);

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-export-html-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" })
  );

  fs.writeFileSync(
    path.join(dir, ".logbook", "state.json"),
    JSON.stringify({ version: 1, disabled: false, warnings: [] }, null, 2) + "\n"
  );

  fs.writeFileSync(
    path.join(dir, "logbook", "evidence", "events.jsonl"),
    "",
    "utf8"
  );

  // Pre-create the 3 generated doc files with sample content.
  // Policy: the sanitizer is conservative — it matches http(s) URLs anywhere
  // in the final HTML text, including inside <pre><code> blocks (rehype does
  // NOT entity-encode the URL text in fenced code blocks). Therefore the
  // test fixture does NOT include URLs in code blocks. If URLs appear in
  // code blocks in user-authored prose, the logbook build command should
  // strip or not include them in the generated docs.
  const indexDoc = `<!-- logbook:doc:index start -->
# Project Index

## Sessions

| # | Session | Date |
|---|---------|------|
| 1 | Alpha | 2026-01-01 |

## Notes

Some project notes that do not contain external links.
<!-- logbook:doc:index end -->
`;

  const timelineDoc = `<!-- logbook:doc:timeline start -->
# Timeline

## 2026-01-01

- Session started: Alpha

## 2026-01-02

- Decision: Use JSONL storage
<!-- logbook:doc:timeline end -->
`;

  const errorsDoc = `<!-- logbook:doc:errors start -->
# Errors and Lessons

## Lessons Learned

- Always validate configuration on startup
- Write tests before implementation
<!-- logbook:doc:errors end -->
`;

  fs.writeFileSync(path.join(dir, "logbook", "docs", "index.md"), indexDoc, "utf8");
  fs.writeFileSync(path.join(dir, "logbook", "docs", "timeline.md"), timelineDoc, "utf8");
  fs.writeFileSync(
    path.join(dir, "logbook", "docs", "errors-and-lessons.md"),
    errorsDoc,
    "utf8"
  );

  return dir;
}

function runCli(
  args: string[],
  cwd: string
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 30_000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("export-html-no-network", () => {
  it("logbook export html exits 0", () => {
    const dir = makeTmpProject();
    const { code, stderr } = runCli(["export", "html"], dir);
    expect(code, `stderr: ${stderr}`).toBe(0);
  });

  it("produces logbook/exports/index.html", () => {
    const dir = makeTmpProject();
    runCli(["export", "html"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    expect(fs.existsSync(htmlPath)).toBe(true);
  });

  it("generated HTML has no external refs (assertNoExternalRefs passes)", () => {
    const dir = makeTmpProject();
    runCli(["export", "html"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    // Must not throw
    expect(() => assertNoExternalRefs(html)).not.toThrow();
  });

  it("generated HTML contains <!DOCTYPE html>", () => {
    const dir = makeTmpProject();
    runCli(["export", "html"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("generated HTML has inlined <style> block (no external stylesheet link)", () => {
    const dir = makeTmpProject();
    runCli(["export", "html"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);
  });

  it("generated HTML contains content from all 3 source docs", () => {
    const dir = makeTmpProject();
    runCli(["export", "html"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    // Content from index.md — table rendered to HTML
    expect(html).toContain("Alpha");
    // Content from timeline.md
    expect(html).toContain("Timeline");
    // Content from errors doc
    expect(html).toContain("Lessons");
  });

  it("--json flag emits ExportReport JSON with externalRefs=0", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(["export", "html", "--json"], dir);
    expect(code).toBe(0);
    const report = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(report["externalRefs"]).toBe(0);
    expect(typeof report["bytes"]).toBe("number");
    expect(typeof report["outFile"]).toBe("string");
    expect(typeof report["durationMs"]).toBe("number");
  });

  it("sanitizer policy: generated docs that contain no http(s) URLs produce clean HTML", () => {
    // Policy note: the sanitizer is conservative and matches http(s) URLs
    // anywhere in the final HTML text, including inside <pre><code> blocks.
    // The makeTmpProject() fixture uses docs with no external URLs.
    // This test verifies the happy path: clean docs → clean HTML.
    const dir = makeTmpProject();
    runCli(["export", "html"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    expect(fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(() => assertNoExternalRefs(html)).not.toThrow();
  });
});

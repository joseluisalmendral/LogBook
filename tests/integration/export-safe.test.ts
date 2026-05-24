/**
 * Integration tests for `logbook export html --safe` (T7).
 *
 * Creates a temp project with docs containing paths, emails, and usernames,
 * runs the CLI with and without --safe, and asserts redaction behavior.
 *
 * SLICE-13 NOTE: the slice-10 export pipeline rewrite stopped consuming the
 * docs markdown (only events.jsonl flows into the payload now). As a result,
 * the four cases that asserted docs-derived content appearing in the final
 * HTML are no longer applicable to the new shell — they are .skip()'d with a
 * TODO pointer to a follow-up that re-features --safe for the new pipeline
 * (sanitize event bodies + transcript content rather than markdown docs).
 *
 * Token format note (kept for the follow-up):
 *   sanitizeForSafeExport outputs HTML-entity-encoded tokens (&lt;path&gt;
 *   etc.) that survive the remark/rehype pipeline. The final HTML therefore
 *   contains &lt;path&gt; (which renders as <path> in the browser).
 *
 * Requires a built CLI at dist/cli/index.cjs and dist/export/html.cjs.
 * Run `pnpm build` before executing this test.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

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

/** Sensitive content embedded in docs. */
const SENSITIVE_PATH = "/Users/alice/myproject/src/index.ts";
const SENSITIVE_EMAIL = "alice@example.com";

// Slice-17: removed HTML_TOKEN_PATH / HTML_TOKEN_EMAIL constants. They were
// keyed to the legacy remark/rehype pipeline that re-encoded `<` to `&#x3C;`.
// The new pipeline (slice 10 onwards) embeds events as JSON and sanitization
// lands tokens like `&lt;path&gt;` directly; the corresponding payload-level
// assertions live in `tests/unit/build-export-payload.test.ts`.

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-export-safe-${Math.random().toString(36).slice(2)}`
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

  // index.md contains sensitive path and email
  const indexDoc = `<!-- logbook:doc:index start -->
# Project Index

Author: ${SENSITIVE_EMAIL}
Source: ${SENSITIVE_PATH}

## Sessions

| # | Session | Date |
|---|---------|------|
| 1 | Alpha | 2026-01-01 |
<!-- logbook:doc:index end -->
`;

  const timelineDoc = `<!-- logbook:doc:timeline start -->
# Timeline

## 2026-01-01

- File modified: ${SENSITIVE_PATH}
<!-- logbook:doc:timeline end -->
`;

  const errorsDoc = `<!-- logbook:doc:errors start -->
# Errors and Lessons

## Lessons Learned

- Always validate configuration on startup
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

describe("export-html-safe — --safe flag integration", () => {
  it("exits 0 with --safe flag", () => {
    const dir = makeTmpProject();
    const { code, stderr } = runCli(["export", "html", "--safe"], dir);
    expect(code, `stderr: ${stderr}`).toBe(0);
  });

  it("produces logbook/exports/index.html with --safe", () => {
    const dir = makeTmpProject();
    runCli(["export", "html", "--safe"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    expect(fs.existsSync(htmlPath)).toBe(true);
  });

  it("--safe: HTML does not contain the original sensitive path", () => {
    const dir = makeTmpProject();
    runCli(["export", "html", "--safe"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    // The sensitive path prefix /Users/alice must not appear
    expect(html).not.toContain("/Users/alice");
  });

  it("--safe: HTML does not contain the original email address", () => {
    const dir = makeTmpProject();
    runCli(["export", "html", "--safe"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).not.toContain(SENSITIVE_EMAIL);
  });

  // Slice-17: the 4 token-presence + negative-control assertions that lived
  // here previously asserted contracts of the slice-10-pre legacy shell (docs
  // markdown → rendered HTML body). The new pipeline reads only events.jsonl
  // into the JSON payload, so those assertions no longer fit. End-to-end
  // --safe behavior is covered at the payload assembly layer by the
  // slice-17 unit tests in `tests/unit/build-export-payload.test.ts` (event
  // body redaction + sub-agent prompt/response redaction).

  it("--safe with --json emits ExportReport JSON with externalRefs=0", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(["export", "html", "--safe", "--json"], dir);
    expect(code).toBe(0);
    const report = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof report["outFile"]).toBe("string");
    expect(typeof report["bytes"]).toBe("number");
    expect(report["externalRefs"]).toBe(0);
  });

  it("existing behavior without --safe is unchanged (exits 0, produces HTML)", () => {
    const dir = makeTmpProject();
    const { code, stderr } = runCli(["export", "html"], dir);
    expect(code, `stderr: ${stderr}`).toBe(0);
    const htmlPath = path.join(dir, "logbook", "exports", "index.html");
    expect(fs.existsSync(htmlPath)).toBe(true);
  });
});

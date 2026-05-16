/**
 * Integration test: `logbook export instructor-pack --safe` (iter5).
 *
 * Verifies that the --safe flag redacts paths and emails from the bundle
 * before the remark/rehype pipeline runs. Token format: HTML-entity-encoded
 * &#x3C;path> and &#x3C;email> (same as export html --safe — see export-safe.test.ts).
 *
 * Requires a built CLI. Run `pnpm build` first.
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
      timeout: 90_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`
      );
    }
  }
}, 120_000);

/** Sensitive content that must be redacted when --safe is active. */
const SENSITIVE_PATH = "/Users/alice/code/foo.ts";
const SENSITIVE_EMAIL = "alice@example.com";

/**
 * Redaction tokens after remark/rehype pipeline (same encoding as export-safe.test.ts).
 * sanitizeForSafeExport emits &lt;path&gt; in the markdown.
 * remark-parse decodes to literal `<`, rehype-stringify re-encodes as &#x3C;
 */
const HTML_TOKEN_PATH = "&#x3C;path>";
const HTML_TOKEN_EMAIL = "&#x3C;email>";

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-instructor-safe-${Math.random().toString(36).slice(2)}`
  );

  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "decisions"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "teaching-scripts"), { recursive: true });
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

  // Core docs — plain (no sensitive content)
  fs.writeFileSync(
    path.join(dir, "logbook", "docs", "index.md"),
    "# Project Index\n\n## Sessions\n\n| # | Session | Date |\n|---|---------|------|\n| 1 | Alpha | 2026-01-01 |\n"
  );
  fs.writeFileSync(
    path.join(dir, "logbook", "docs", "timeline.md"),
    "# Timeline\n\n## 2026-01-01\n\n- Session started\n"
  );
  fs.writeFileSync(
    path.join(dir, "logbook", "docs", "errors-and-lessons.md"),
    "# Errors and Lessons\n\n## Lessons\n\n- Write tests first\n"
  );

  // ADR with sensitive content
  fs.writeFileSync(
    path.join(dir, "logbook", "decisions", "0001-use-vite.md"),
    `# Use Vite\n\n## Context\n\nAuthor: ${SENSITIVE_EMAIL}\nSource: ${SENSITIVE_PATH}\n\n## Decision\n\nUse Vite.\n`
  );

  // Teaching script (plain)
  fs.writeFileSync(
    path.join(dir, "logbook", "teaching-scripts", "session-01.md"),
    "# Session 01\n\n## Introduction\n\nTeaching content.\n"
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

describe("cli-export-instructor-pack-safe", () => {
  it("exits 0 with --safe", () => {
    const dir = makeTmpProject();
    const { code, stderr } = runCli(
      ["export", "instructor-pack", "--safe"],
      dir
    );
    expect(code, `stderr: ${stderr}`).toBe(0);
  });

  it("produces instructor-pack.html with --safe", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack", "--safe"], dir);
    const htmlPath = path.join(
      dir,
      "logbook",
      "exports",
      "instructor-pack.html"
    );
    expect(fs.existsSync(htmlPath)).toBe(true);
  });

  it("--safe: HTML does not contain the original sensitive path", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack", "--safe"], dir);
    const htmlPath = path.join(
      dir,
      "logbook",
      "exports",
      "instructor-pack.html"
    );
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).not.toContain("/Users/alice");
  });

  it("--safe: HTML contains HTML-encoded <path> token", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack", "--safe"], dir);
    const htmlPath = path.join(
      dir,
      "logbook",
      "exports",
      "instructor-pack.html"
    );
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain(HTML_TOKEN_PATH);
  });

  it("--safe: HTML does not contain the original email", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack", "--safe"], dir);
    const htmlPath = path.join(
      dir,
      "logbook",
      "exports",
      "instructor-pack.html"
    );
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).not.toContain(SENSITIVE_EMAIL);
  });

  it("--safe: HTML contains HTML-encoded <email> token", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack", "--safe"], dir);
    const htmlPath = path.join(
      dir,
      "logbook",
      "exports",
      "instructor-pack.html"
    );
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain(HTML_TOKEN_EMAIL);
  });

  it("--safe with --json emits ExportReport JSON with externalRefs=0", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(
      ["export", "instructor-pack", "--safe", "--json"],
      dir
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof report["outFile"]).toBe("string");
    expect(typeof report["bytes"]).toBe("number");
    expect(report["externalRefs"]).toBe(0);
  });

  it("negative control: without --safe, original path appears in HTML", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack"], dir);
    const htmlPath = path.join(
      dir,
      "logbook",
      "exports",
      "instructor-pack.html"
    );
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain("/Users/alice");
  });

  it("negative control: without --safe, original email appears in HTML", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack"], dir);
    const htmlPath = path.join(
      dir,
      "logbook",
      "exports",
      "instructor-pack.html"
    );
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain(SENSITIVE_EMAIL);
  });
});

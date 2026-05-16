/**
 * Integration test: `logbook export instructor-pack` — full flow (iter5).
 *
 * Sets up a temp project with all required docs, ADRs, and teaching scripts,
 * runs the CLI, and asserts the generated HTML is self-contained.
 *
 * Requires a built CLI at dist/cli/index.cjs and dist/export/html.cjs.
 * Run `pnpm build` before executing this test.
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
      timeout: 90_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`
      );
    }
  }
}, 120_000);

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-instructor-pack-${Math.random().toString(36).slice(2)}`
  );

  // Standard project skeleton
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

  // Core docs
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

  // Two ADRs
  fs.writeFileSync(
    path.join(dir, "logbook", "decisions", "0001-use-vite.md"),
    "# Use Vite\n\n## Context\n\nWe evaluated bundlers.\n\n## Decision\n\nUse Vite for its speed.\n"
  );
  fs.writeFileSync(
    path.join(dir, "logbook", "decisions", "0002-use-typescript.md"),
    "# Use TypeScript\n\n## Decision\n\nStrict mode enabled.\n"
  );

  // One teaching script
  fs.writeFileSync(
    path.join(dir, "logbook", "teaching-scripts", "session-01.md"),
    "# Session 01\n\n## Introduction\n\nTeaching content for session 1.\n"
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

describe("cli-export-instructor-pack", () => {
  it("exits 0", () => {
    const dir = makeTmpProject();
    const { code, stderr } = runCli(["export", "instructor-pack", "--json"], dir);
    expect(code, `stderr: ${stderr}`).toBe(0);
  });

  it("--json output has filePath and externalRefs=0", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(["export", "instructor-pack", "--json"], dir);
    expect(code).toBe(0);
    const report = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof report["outFile"]).toBe("string");
    expect(report["externalRefs"]).toBe(0);
    expect(typeof report["bytes"]).toBe("number");
    expect(typeof report["durationMs"]).toBe("number");
  });

  it("produces instructor-pack.html at the default path", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(["export", "instructor-pack", "--json"], dir);
    expect(code).toBe(0);
    const report = JSON.parse(stdout.trim()) as { outFile: string };
    expect(fs.existsSync(report.outFile)).toBe(true);
    expect(report.outFile).toContain("instructor-pack.html");
  });

  it("HTML contains ADRs section", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "instructor-pack.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain("ADRs");
  });

  it("HTML contains Teaching Scripts section", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "instructor-pack.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain("Teaching Scripts");
  });

  it("HTML contains a TOC", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "instructor-pack.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    // TOC contains links — both ADR IDs should appear as anchors
    expect(html).toContain("0001-use-vite");
    expect(html).toContain("0002-use-typescript");
  });

  it("assertNoExternalRefs passes on generated HTML", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "instructor-pack.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(() => assertNoExternalRefs(html)).not.toThrow();
  });

  it("HTML contains content from all core docs", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "instructor-pack.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain("Timeline");
    expect(html).toContain("Errors");
    expect(html).toContain("Alpha");
  });

  it("HTML is a complete document (DOCTYPE + html + head + body)", () => {
    const dir = makeTmpProject();
    runCli(["export", "instructor-pack"], dir);
    const htmlPath = path.join(dir, "logbook", "exports", "instructor-pack.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
    expect(html).toContain("<style>");
  });
});

/**
 * Integration test: `logbook build` determinism (T11).
 *
 * Manually prepares a minimal events.jsonl + state.json fixture,
 * runs `logbook build` twice in succession, and asserts byte-identical output
 * for all 3 generated docs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";

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

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-build-det-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logbook", "evidence"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" })
  );

  // Minimal state.json
  fs.writeFileSync(
    path.join(dir, ".logbook", "state.json"),
    JSON.stringify({ version: 1, disabled: false, warnings: [], staleLocksReleased: 0, adrCounter: 2 }, null, 2) + "\n"
  );

  // events.jsonl with a mix of event types
  const events = [
    { id: "S01", type: "manual.session_start", ts: "2026-01-01T00:00:00.000Z", title: "Alpha Session" },
    { id: "D01", type: "manual.decision", ts: "2026-01-02T00:00:00.000Z", title: "Use JSONL", adrCounter: 1, status: "Accepted", chosen: "JSONL", adrPath: "logbook/decisions/0001-use-jsonl.md" },
    { id: "D02", type: "manual.decision", ts: "2026-01-03T00:00:00.000Z", title: "Use SQLite", adrCounter: 2, status: "Proposed", chosen: "SQLite", adrPath: "logbook/decisions/0002-use-sqlite.md" },
    { id: "E01", type: "manual.error", ts: "2026-01-04T00:00:00.000Z", title: "Config parse failed", kind: "ParseError" },
    { id: "F01", type: "manual.fix", ts: "2026-01-05T00:00:00.000Z", title: "Fixed parser", errorId: "E01", description: "Added try/catch" },
    { id: "L01", type: "manual.lesson", ts: "2026-01-06T00:00:00.000Z", title: "Always validate config", promotable: true },
    { id: "M01", type: "manual.milestone", ts: "2026-01-07T00:00:00.000Z", title: "MVP ready", description: "All done" },
  ];

  fs.writeFileSync(
    path.join(dir, "logbook", "evidence", "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
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

const DOC_FILES = [
  path.join("logbook", "docs", "index.md"),
  path.join("logbook", "docs", "timeline.md"),
  path.join("logbook", "docs", "errors-and-lessons.md"),
];

describe("build-deterministic", () => {
  it("logbook build exits 0", () => {
    const dir = makeTmpProject();
    const { code, stderr } = runCli(["build"], dir);
    // Allow stderr to contain non-fatal SQLite warnings
    expect(code, `stderr: ${stderr}`).toBe(0);
  });

  it("logbook build produces all 3 doc files", () => {
    const dir = makeTmpProject();
    runCli(["build"], dir);
    for (const relPath of DOC_FILES) {
      const absPath = path.join(dir, relPath);
      expect(fs.existsSync(absPath), `Missing: ${relPath}`).toBe(true);
    }
  });

  it("two consecutive builds produce byte-identical output for all 3 docs", () => {
    const dir = makeTmpProject();

    const { code: code1 } = runCli(["build"], dir);
    expect(code1).toBe(0);

    const hashes1: Record<string, string> = {};
    for (const relPath of DOC_FILES) {
      hashes1[relPath] = sha256(
        fs.readFileSync(path.join(dir, relPath), "utf8")
      );
    }

    const { code: code2 } = runCli(["build"], dir);
    expect(code2).toBe(0);

    for (const relPath of DOC_FILES) {
      const hash2 = sha256(fs.readFileSync(path.join(dir, relPath), "utf8"));
      expect(hash2, `Non-deterministic output for ${relPath}`).toBe(
        hashes1[relPath]
      );
    }
  });

  it("build with --json flag prints BuildReport JSON", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(["build", "--json"], dir);
    expect(code).toBe(0);
    const report = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(Array.isArray(report["generated"])).toBe(true);
    expect(typeof report["durationMs"]).toBe("number");
  });
});

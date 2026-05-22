/**
 * Integration test: `logbook decision` CLI command (T10b).
 *
 * Tests:
 *  1. exit 0, stdout JSON has id, counter: 1, adrPath matches expected pattern
 *  2. ADR file exists with Nygard template content
 *  3. events.jsonl has manual.decision event
 *  4. state.json has adrCounter: 1
 *  5. Second decision call → counter: 2, second ADR file
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
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`,
      );
    }
  }
}, 90_000);

function makeTmpProject(): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const dir = path.join(
    tmp,
    `lb-decision-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(path.join(dir, ".logbook"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.1" }),
  );
  return dir;
}

function runCli(
  args: string[],
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readState(dir: string): Record<string, unknown> {
  const p = path.join(dir, ".logbook", "state.json");
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
}

function readEvents(dir: string): unknown[] {
  const p = path.join(dir, "logbook", "evidence", "events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const ULID_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

describe("cli-decision", () => {
  it("exits 0 and returns id, counter:1, adrPath in JSON stdout", () => {
    const dir = makeTmpProject();
    const { code, stdout } = runCli(
      [
        "decision",
        "--title",
        "Use Vite",
        "--chosen",
        "Vite",
        "--context",
        "Bundle speed",
        "--consequences",
        "Smaller config",
      ],
      dir,
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof out["id"]).toBe("string");
    expect(ULID_RE.test(out["id"] as string)).toBe(true);
    expect(out["counter"]).toBe(1);
    expect(out["adrPath"]).toBe("logbook/decisions/0001-use-vite.md");
  });

  it("creates the ADR file with Nygard template content", () => {
    const dir = makeTmpProject();
    runCli(
      [
        "decision",
        "--title",
        "Use Vite",
        "--chosen",
        "Vite",
        "--context",
        "Bundle speed",
        "--consequences",
        "Smaller config",
      ],
      dir,
    );
    const adrPath = path.join(dir, "logbook", "decisions", "0001-use-vite.md");
    expect(fs.existsSync(adrPath)).toBe(true);
    const content = fs.readFileSync(adrPath, "utf8");
    expect(content).toContain("# 0001. Use Vite");
    expect(content).toContain("## Status");
    expect(content).toContain("## Context");
    expect(content).toContain("## Decision");
    expect(content).toContain("## Consequences");
    expect(content).toContain("Bundle speed");
    expect(content).toContain("Smaller config");
  });

  it("appends a user_entry/decision event to events.jsonl", () => {
    const dir = makeTmpProject();
    runCli(
      [
        "decision",
        "--title",
        "Use Vite",
        "--chosen",
        "Vite",
      ],
      dir,
    );
    const events = readEvents(dir);
    // Shape-A: kind=user_entry, payload.entryType=decision
    const decEvent = events.find(
      (e) => (e as { kind?: string; payload?: Record<string, unknown> }).kind === "user_entry" &&
             ((e as { payload?: Record<string, unknown> }).payload?.["entryType"] === "decision"),
    ) as Record<string, unknown> | undefined;
    expect(decEvent).toBeDefined();
    expect(decEvent?.["schemaVersion"]).toBe(3);
    const payload = decEvent?.["payload"] as Record<string, unknown>;
    expect(payload?.["title"]).toBe("Use Vite");
    expect(payload?.["chosen"]).toBe("Vite");
    expect(typeof payload?.["adrCounter"]).toBe("number");
    expect(payload?.["adrCounter"]).toBe(1);
  });

  it("persists adrCounter: 1 in state.json", () => {
    const dir = makeTmpProject();
    runCli(
      [
        "decision",
        "--title",
        "Use Vite",
        "--chosen",
        "Vite",
      ],
      dir,
    );
    const state = readState(dir);
    expect(state["adrCounter"]).toBe(1);
  });

  it("second decision call produces counter: 2 and second ADR file", () => {
    const dir = makeTmpProject();

    const { stdout: first } = runCli(
      ["decision", "--title", "Use Vite", "--chosen", "Vite"],
      dir,
    );
    const firstOut = JSON.parse(first.trim()) as Record<string, unknown>;
    expect(firstOut["counter"]).toBe(1);

    const { code, stdout: second } = runCli(
      ["decision", "--title", "Use ESM only", "--chosen", "ESM"],
      dir,
    );
    expect(code).toBe(0);
    const secondOut = JSON.parse(second.trim()) as Record<string, unknown>;
    expect(secondOut["counter"]).toBe(2);
    expect(secondOut["adrPath"]).toBe("logbook/decisions/0002-use-esm-only.md");

    const adr2 = path.join(dir, "logbook", "decisions", "0002-use-esm-only.md");
    expect(fs.existsSync(adr2)).toBe(true);
  });
});

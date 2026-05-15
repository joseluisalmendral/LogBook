/**
 * S9.T8 — disable state prevents ingest from writing to JSONL.
 *
 * When logbook is disabled, piping a hook payload must produce no events
 * in events.jsonl. Re-enable should allow writes again.
 *
 * Closes S8 deferred check: the S8 stub always read-and-discarded; now the
 * real pipeline checks state.disabled before any heavy work.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");
const FIXTURE = path.join(ROOT, "tests/fixtures/claude-hook-payloads/user-message.json");

function runCli(
  args: string[],
  cwd: string,
  stdinPayload?: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    input: stdinPayload ?? "",
    encoding: "utf8",
    env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function countEventLines(cwd: string): number {
  const eventsPath = path.join(cwd, "logbook", "evidence", "events.jsonl");
  if (!fs.existsSync(eventsPath)) return 0;
  return fs
    .readFileSync(eventsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim()).length;
}

describe("state-disable-noop — disable prevents JSONL writes", () => {
  let tmp: string;
  const payload = fs.readFileSync(FIXTURE, "utf8");

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-disable-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    const initResult = spawnSync("node", [CLI, "init", "--preset", "minimal", "--yes"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, LOGBOOK_HOOK_PATH: HOOK_CJS },
    });
    if ((initResult.status ?? 1) !== 0) {
      throw new Error(`init failed: ${initResult.stderr}`);
    }
  });

  it("ingest writes a line when enabled (sanity check)", () => {
    const result = runCli(["ingest", "claude"], tmp, payload);
    expect(result.code).toBe(0);
    expect(countEventLines(tmp)).toBeGreaterThanOrEqual(1);
  });

  it("disable exits 0", () => {
    const result = runCli(["disable"], tmp);
    expect(result.code).toBe(0);
  });

  it("ingest writes NOTHING when disabled", () => {
    const linesBefore = countEventLines(tmp);
    const result = runCli(["ingest", "claude"], tmp, payload);
    expect(result.code).toBe(0);
    const linesAfter = countEventLines(tmp);
    expect(linesAfter).toBe(linesBefore); // no new lines
  });

  it("enable exits 0", () => {
    const result = runCli(["enable"], tmp);
    expect(result.code).toBe(0);
  });

  it("ingest writes a line again after enable", () => {
    const linesBefore = countEventLines(tmp);
    const result = runCli(["ingest", "claude"], tmp, payload);
    expect(result.code).toBe(0);
    const linesAfter = countEventLines(tmp);
    expect(linesAfter).toBe(linesBefore + 1);
  });
});

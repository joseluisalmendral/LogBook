/**
 * I5 — disable / enable toggle state.json correctly.
 *
 * Setup: init first, then toggle disable/enable, assert state.json changes.
 * Also verifies ingest claude stub exits 0 (S8 stub).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");

function runCli(
  args: string[],
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      LOGBOOK_HOOK_PATH: HOOK_CJS,
    },
    input: "", // empty stdin for ingest stub
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readState(cwd: string): { disabled: boolean } {
  const statePath = path.join(cwd, ".logbook", "state.json");
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

describe("I5 — state disable/enable", () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-i5-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    const initResult = runCli(["init", "--preset", "minimal", "--yes"], tmp);
    if (initResult.code !== 0) {
      throw new Error(`init failed: ${initResult.stderr}`);
    }
  });

  it("state starts as disabled: false after init", () => {
    const state = readState(tmp);
    expect(state.disabled).toBe(false);
  });

  it("disable sets disabled: true", () => {
    const result = runCli(["disable"], tmp);
    expect(result.code).toBe(0);
    const state = readState(tmp);
    expect(state.disabled).toBe(true);
  });

  it("enable sets disabled: false", () => {
    const result = runCli(["enable"], tmp);
    expect(result.code).toBe(0);
    const state = readState(tmp);
    expect(state.disabled).toBe(false);
  });

  it("disable again sets disabled: true again", () => {
    const result = runCli(["disable"], tmp);
    expect(result.code).toBe(0);
    const state = readState(tmp);
    expect(state.disabled).toBe(true);
  });

  it("ingest claude (S8 stub) exits 0 regardless of disable state", () => {
    // S8 stub simply reads stdin and exits 0; disable state is S9 concern
    const result = runCli(["ingest", "claude"], tmp);
    expect(result.code).toBe(0);
  });

  it("enable reverts disabled: false", () => {
    const result = runCli(["enable"], tmp);
    expect(result.code).toBe(0);
    const state = readState(tmp);
    expect(state.disabled).toBe(false);
  });
});

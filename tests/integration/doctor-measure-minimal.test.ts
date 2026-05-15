/**
 * I4 — doctor --measure --json after minimal init.
 *
 * Asserts:
 * - fixedContextTokens === 0 (iter1 minimal installs hooks + gitignore, no agent-context artifacts)
 * - All breakdown values are 0
 * - verify array length matches manifest (2 entries), all ok:true
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
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("I4 — doctor --measure --json", () => {
  let tmp: string;
  let doctorOutput: {
    fixedContextTokens: number;
    breakdown: {
      skill: number;
      augmentClaudemd: number;
      mcpToolDescriptions: number;
      sessionStart: number;
    };
    verify: Array<{ id: string; kind: string; ok: boolean; reason?: string }>;
  };

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-i4-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    // Run init
    const initResult = runCli(["init", "--preset", "minimal", "--yes"], tmp);
    if (initResult.code !== 0) {
      throw new Error(`init failed: ${initResult.stderr}`);
    }

    // Run doctor --measure --json
    const doctorResult = runCli(["doctor", "--measure", "--json"], tmp);
    if (doctorResult.code !== 0) {
      throw new Error(`doctor failed (code ${doctorResult.code}): ${doctorResult.stderr}`);
    }

    doctorOutput = JSON.parse(doctorResult.stdout);
  });

  it("exits 0", () => {
    const result = runCli(["doctor", "--measure", "--json"], tmp);
    expect(result.code).toBe(0);
  });

  it("reports fixedContextTokens === 0", () => {
    expect(doctorOutput.fixedContextTokens).toBe(0);
  });

  it("reports all breakdown values as 0", () => {
    expect(doctorOutput.breakdown.skill).toBe(0);
    expect(doctorOutput.breakdown.augmentClaudemd).toBe(0);
    expect(doctorOutput.breakdown.mcpToolDescriptions).toBe(0);
    expect(doctorOutput.breakdown.sessionStart).toBe(0);
  });

  it("reports verify array with 2 entries, all ok:true", () => {
    expect(Array.isArray(doctorOutput.verify)).toBe(true);
    expect(doctorOutput.verify).toHaveLength(2);
    for (const entry of doctorOutput.verify) {
      expect(entry.ok).toBe(true);
    }
  });
});

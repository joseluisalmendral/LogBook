/**
 * I-DOC — doctor --measure --json after init --preset standard.
 *
 * T13: Verifies real token counting for augment_claudemd, mcp_server, and
 * slash_command artifacts. Total fixedContextTokens must be ≤ 200 (design
 * budget 180 + tolerance).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../../");
const CLI = path.join(ROOT, "dist/cli/index.cjs");
const HOOK_CJS = path.join(ROOT, "dist/connectors/claude-code/hook.cjs");
const MCP_CJS = path.join(ROOT, "dist/mcp/server.cjs");

interface DoctorOutput {
  fixedContextTokens: number;
  breakdown: {
    skill: number;
    augmentClaudemd: number;
    mcpToolDescriptions: number;
    slashCommandDescriptions: number;
    sessionStart: number;
  };
  verify: Array<{ id: string; kind: string; ok: boolean; reason?: string }>;
}

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
      LOGBOOK_MCP_SERVER_PATH: MCP_CJS,
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("I-DOC — doctor --measure --json after preset standard install", () => {
  let tmp: string;
  let output: DoctorOutput;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }

    // Create temp project and install standard preset
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-doc-std-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.0" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    const initResult = runCli(["init", "--preset", "standard", "--yes"], tmp);
    if (initResult.code !== 0) {
      throw new Error(`init failed:\n${initResult.stderr}`);
    }

    // Run doctor --measure --json
    const doctorResult = runCli(["doctor", "--measure", "--json"], tmp);
    if (doctorResult.code !== 0) {
      throw new Error(`doctor failed:\n${doctorResult.stderr}`);
    }

    try {
      output = JSON.parse(doctorResult.stdout) as DoctorOutput;
    } catch (err) {
      throw new Error(`Failed to parse doctor JSON output:\n${doctorResult.stdout}\n${err}`);
    }
  });

  it("fixedContextTokens is a positive number", () => {
    expect(typeof output.fixedContextTokens).toBe("number");
    expect(output.fixedContextTokens).toBeGreaterThan(0);
  });

  it("fixedContextTokens is within budget (≤ 200)", () => {
    expect(output.fixedContextTokens).toBeLessThanOrEqual(200);
  });

  it("breakdown.augmentClaudemd > 0 (augment block is installed)", () => {
    expect(output.breakdown.augmentClaudemd).toBeGreaterThan(0);
  });

  it("breakdown.mcpToolDescriptions > 0 (MCP server has 9 tools)", () => {
    expect(output.breakdown.mcpToolDescriptions).toBeGreaterThan(0);
  });

  it("breakdown.slashCommandDescriptions > 0 (8 slash files installed)", () => {
    expect(output.breakdown.slashCommandDescriptions).toBeGreaterThan(0);
  });

  it("breakdown.skill === 0 (iter3 deferred)", () => {
    expect(output.breakdown.skill).toBe(0);
  });

  it("breakdown.sessionStart === 0 (iter4 deferred)", () => {
    expect(output.breakdown.sessionStart).toBe(0);
  });

  it("all verify entries are ok: true", () => {
    for (const entry of output.verify) {
      expect(entry.ok, `entry ${entry.id} (${entry.kind}) should be ok`).toBe(true);
    }
  });

  it("verify has 12 entries (all preset standard artifacts: hook+mcp+augment+8slash+gitignore)", () => {
    // 1 hook + 1 mcp_server + 1 augment_claudemd + 8 slash_command + 1 gitignore_entry = 12
    expect(output.verify).toHaveLength(12);
  });
});

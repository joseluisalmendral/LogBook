/**
 * I-DOC-TEACH — doctor --measure --json after init --preset teaching.
 *
 * T8 (iter4): HARD GATE — fixedContextTokens MUST be ≤ 500 for the teaching preset.
 *
 * Token budget math (conservative worst-case):
 *   iter3 standard baseline:   381 tokens
 *   + SessionStart (max 120):  +120
 *   + subagent descriptions:   +0  (UI index surface, NOT agent context per design §4)
 *   + statusline:              +0  (UI element, per design §5)
 *   - SKILL.md trim (T8.1):    -2  (813→806 chars: 204→202 tokens)
 *   = 499 tokens projected ≤ 500 HARD GATE.
 *
 * This test is the CI enforcement point. If fixedContextTokens > 500, abort:
 * there is a bug in the trim plan or the token math.
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
    subagentDescriptions: number;
    statusline: number;
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
      LOGBOOK_ASSETS_ROOT: path.join(ROOT, "assets"),
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("I-DOC-TEACH — doctor --measure --json after teaching preset (HARD GATE ≤ 500)", () => {
  let tmp: string;
  let output: DoctorOutput;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`Built CLI not found at ${CLI}. Run \`pnpm build\` first.`);
    }
    if (!fs.existsSync(MCP_CJS)) {
      throw new Error(`Built MCP server not found at ${MCP_CJS}. Run \`pnpm build\` first.`);
    }

    // Create temp project
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-doc-teach-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.0" }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

    // Install teaching preset
    const initResult = runCli(["init", "--preset", "teaching", "--yes"], tmp);
    if (initResult.code !== 0) {
      throw new Error(`init --preset teaching failed:\n${initResult.stderr}`);
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

  it("HARD GATE: fixedContextTokens ≤ 500 (iter4 budget ceiling)", () => {
    // This is the primary gate. If this fails, the trim plan or token math is wrong.
    expect(
      output.fixedContextTokens,
      `HARD GATE FAILED: fixedContextTokens=${output.fixedContextTokens} exceeds 500. ` +
      `Budget breakdown: skill=${output.breakdown.skill} augment=${output.breakdown.augmentClaudemd} ` +
      `mcp=${output.breakdown.mcpToolDescriptions} slash=${output.breakdown.slashCommandDescriptions} ` +
      `subagentDesc=${output.breakdown.subagentDescriptions} statusline=${output.breakdown.statusline} ` +
      `sessionStart=${output.breakdown.sessionStart}`,
    ).toBeLessThanOrEqual(500);
  });

  it("fixedContextTokens is a positive number", () => {
    expect(typeof output.fixedContextTokens).toBe("number");
    expect(output.fixedContextTokens).toBeGreaterThan(0);
  });

  it("breakdown.sessionStart === 120 (conservative max per design §6/T8.D1)", () => {
    // T8.D1: doctor uses conservative max (120 tokens) for sessionStart.
    // This guarantees worst-case visibility in the budget.
    expect(output.breakdown.sessionStart).toBe(120);
  });

  it("breakdown.subagentDescriptions === 0 (subagent descriptions are in UI index, NOT agent context)", () => {
    // Design §4: subagent descriptions appear only in Claude Code's subagent index (UI surface),
    // NOT injected into the main agent context. Therefore they count 0 toward fixed context.
    expect(output.breakdown.subagentDescriptions).toBe(0);
  });

  it("breakdown.statusline === 0 (statusline is a UI element, not in agent context)", () => {
    // Design §5: statusline output is rendered in the status bar, never injected into agent context.
    expect(output.breakdown.statusline).toBe(0);
  });

  it("breakdown.skill > 0 (SKILL.md trimmed to 806 chars → ≤ 202 tokens)", () => {
    expect(output.breakdown.skill).toBeGreaterThan(0);
    // Post-T8.1 trim: 806 chars → ceil(806/4) = 202 tokens
    expect(output.breakdown.skill).toBeLessThanOrEqual(202);
  });

  it("breakdown.augmentClaudemd > 0", () => {
    expect(output.breakdown.augmentClaudemd).toBeGreaterThan(0);
  });

  it("breakdown.mcpToolDescriptions > 0", () => {
    expect(output.breakdown.mcpToolDescriptions).toBeGreaterThan(0);
  });

  it("breakdown.slashCommandDescriptions > 0", () => {
    expect(output.breakdown.slashCommandDescriptions).toBeGreaterThan(0);
  });

  it("all verify entries are ok: true", () => {
    for (const entry of output.verify) {
      expect(entry.ok, `entry ${entry.id} (${entry.kind}) should be ok`).toBe(true);
    }
  });

  it("verify has 20 entries (teaching preset: 3hooks+mcp+augment+8slash+2skill+2subagent+statusline+sessionstart-hook+gitignore)", () => {
    // 3 hook (PostToolUse+UserPromptSubmit+Stop) + mcp + augment + 8slash + 2skill + 2subagent + statusline + sessionstart-hook + gitignore
    // = 3+1+1+8+2+2+1+1+1 = 20
    expect(output.verify).toHaveLength(20);
  });

  it("breakdown sums to fixedContextTokens", () => {
    const expected =
      output.breakdown.skill +
      output.breakdown.augmentClaudemd +
      output.breakdown.mcpToolDescriptions +
      output.breakdown.slashCommandDescriptions +
      (output.breakdown.subagentDescriptions ?? 0) +
      (output.breakdown.statusline ?? 0) +
      output.breakdown.sessionStart;
    expect(output.fixedContextTokens).toBe(expected);
  });
});

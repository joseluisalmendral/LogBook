/* SLICE-26 SUPERSEDED: lean install (SessionStart + Stop only) changed manifest counts and hook order; the new contract is covered by tests/unit/presets-extract.test.ts and tests/integration/byte-identity-with-conversation-hooks.test.ts. Reversibility (INV-1) is covered by tests/e2e/byte-identity-{clean,crlf,with-fake-plugin}.test.ts. Re-enable + rewrite when revisiting the legacy install matrix. */

/**
 * I-DOC — doctor --measure --json after init --preset standard.
 *
 * T13 (iter3): Verifies real token counting for augment_claudemd, mcp_server,
 * slash_command, AND skill artifacts.
 *
 * Token budget update:
 *   iter2 baseline: 177 tokens (augment + mcp + slash)
 *   SKILL.md (813 chars / 4 = ~204 tokens)
 *   reference.md does NOT count (on-demand only, not in fixed context)
 *   Expected total: ~350-450 tokens
 *   Hard gate: ≤ 450
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

describe.skip("I-DOC — doctor --measure --json after preset standard install", () => {
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

  it("fixedContextTokens is within budget (≤ 450, accounting for Skill body)", () => {
    // iter2 baseline 177 + SKILL.md ~204 tokens = ~381; tolerance up to 450
    expect(output.fixedContextTokens).toBeLessThanOrEqual(450);
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

  it("breakdown.skill > 0 (SKILL.md is in fixed context)", () => {
    // SKILL.md (~813 chars / 4 = ~204 tokens); reference.md does NOT count (on-demand)
    expect(output.breakdown.skill).toBeGreaterThan(0);
  });

  it("breakdown.skill <= 250 (SKILL.md ≤ 1000 chars budget)", () => {
    // Hard gate from T1: SKILL.md ≤ 1000 chars → ≤ 250 tokens
    expect(output.breakdown.skill).toBeLessThanOrEqual(250);
  });

  it("breakdown.sessionStart === 0 (iter4 deferred)", () => {
    expect(output.breakdown.sessionStart).toBe(0);
  });

  it("all verify entries are ok: true", () => {
    for (const entry of output.verify) {
      expect(entry.ok, `entry ${entry.id} (${entry.kind}) should be ok`).toBe(true);
    }
  });

  it("verify has 16 entries (preset standard: 3hooks+mcp+augment+8slash+2skill+gitignore)", () => {
    // 3 hook (PostToolUse+UserPromptSubmit+Stop) + 1 mcp_server + 1 augment_claudemd
    // + 8 slash_command + 2 skill + 1 gitignore_entry = 16
    expect(output.verify).toHaveLength(16);
  });
});

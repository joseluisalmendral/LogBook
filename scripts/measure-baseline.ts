/**
 * scripts/measure-baseline.ts
 *
 * Measure the iter3 standard-preset token baseline via `logbook doctor --measure --json`.
 * Spawns a temporary project, installs the standard preset, runs the doctor command,
 * and prints the fixedContextTokens breakdown along with the iter4 budget projection.
 *
 * Usage:
 *   pnpm tsx scripts/measure-baseline.ts
 *
 * Requires a built CLI bundle at dist/cli/index.cjs.
 * Run `pnpm build` first if dist/ is stale.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "dist/cli/index.cjs");
const ASSETS_ROOT = path.join(REPO_ROOT, "assets");
const HOOK_PATH = path.join(REPO_ROOT, "dist/connectors/claude-code/hook.cjs");
const MCP_PATH = path.join(REPO_ROOT, "dist/mcp/server.cjs");

// Iter4 additions (worst-case max for budget planning):
const ITER4_SESSION_START_MAX_TOKENS = 120; // 480 chars / 4 — conservative max
const ITER4_SUBAGENT_TOKENS = 0;            // descriptions live in UI index, not agent context
const ITER4_STATUSLINE_TOKENS = 0;          // UI element, never enters agent context

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Verify CLI bundle exists
  if (!fs.existsSync(CLI)) {
    console.error(`ERROR: CLI bundle not found at ${CLI}`);
    console.error("Run `pnpm build` first.");
    process.exit(1);
  }

  // Create temp project
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logbook-measure-"));
  console.log(`Temp project: ${tmpDir}`);

  try {
    // Scaffold
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "tmp-measure", version: "0.0.1" }),
    );

    const env = {
      ...process.env,
      LOGBOOK_ASSETS_ROOT: ASSETS_ROOT,
      LOGBOOK_HOOK_PATH: HOOK_PATH,
      LOGBOOK_MCP_SERVER_PATH: MCP_PATH,
    };

    // Install standard preset
    execSync(`node "${CLI}" init --preset standard --yes`, {
      cwd: tmpDir,
      env,
      stdio: "pipe",
    });
    console.log("Standard preset installed.");

    // Run doctor --measure --json
    const raw = execSync(`node "${CLI}" doctor --measure --json`, {
      cwd: tmpDir,
      env,
      stdio: "pipe",
    }).toString("utf8");

    const result = JSON.parse(raw) as {
      fixedContextTokens: number;
      breakdown: {
        skill: number;
        augmentClaudemd: number;
        mcpToolDescriptions: number;
        slashCommandDescriptions: number;
        sessionStart: number;
      };
    };

    // Compute projection
    const baseline = result.fixedContextTokens;
    const iter4Addition =
      ITER4_SESSION_START_MAX_TOKENS +
      ITER4_SUBAGENT_TOKENS +
      ITER4_STATUSLINE_TOKENS;
    const projected = baseline + iter4Addition;
    const headroom = 500 - projected;
    const decision = projected <= 500 ? "NO-TRIM" : "TRIM";

    // Output
    console.log("\n=== Doctor --measure output ===");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n=== Iter4 Budget Projection ===");
    console.log(`Baseline (iter3 standard):  ${baseline} tokens`);
    console.log(`  skill:                    ${result.breakdown.skill}`);
    console.log(`  augmentClaudemd:          ${result.breakdown.augmentClaudemd}`);
    console.log(`  mcpToolDescriptions:      ${result.breakdown.mcpToolDescriptions}`);
    console.log(`  slashCommandDescriptions: ${result.breakdown.slashCommandDescriptions}`);
    console.log(`  sessionStart:             ${result.breakdown.sessionStart} (iter3 placeholder)`);
    console.log(`Iter4 additions:`);
    console.log(`  sessionStart (max):       +${ITER4_SESSION_START_MAX_TOKENS}`);
    console.log(`  subagent descriptions:    +${ITER4_SUBAGENT_TOKENS} (UI index only, not agent context)`);
    console.log(`  statusline:               +${ITER4_STATUSLINE_TOKENS} (UI element, not agent context)`);
    console.log(`Projected total:            ${projected} tokens`);
    console.log(`Headroom vs 500-token gate: ${headroom > 0 ? "+" : ""}${headroom} tokens`);
    console.log(`\nDecision: ${decision}`);

    if (decision === "TRIM") {
      const tokensToTrim = Math.abs(headroom); // tokens over budget
      const charsToTrim = tokensToTrim * 4;    // minimum chars to remove
      console.log(`\nTrim plan:`);
      console.log(`  Tokens to trim:   ${tokensToTrim} token(s)`);
      console.log(`  Chars to trim:    ≥${charsToTrim} chars from assets/skill/SKILL.md`);
      console.log(`  Candidate:        Remove " during this session" from description line`);
      console.log(`                    (20 chars → saves 5 tokens → new total ~${projected - 5} tokens)`);
      console.log(`  Apply in:         T8.1 (before activating sessionStart counting)`);
    } else {
      console.log(`\nNo trim needed. Proceeding with iter4 as designed.`);
    }

    // Summary JSON for machine consumption
    console.log("\n=== Summary JSON ===");
    console.log(
      JSON.stringify(
        {
          baseline,
          breakdown: result.breakdown,
          iter4Addition,
          projected,
          headroom,
          decision,
          budgetGate: 500,
        },
        null,
        2,
      ),
    );
  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\nTemp dir cleaned: ${tmpDir}`);
  }
}

main();

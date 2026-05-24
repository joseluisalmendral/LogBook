/**
 * logbook doctor — diagnose install health and measure context cost.
 *
 * --measure computes fixedContextTokens for the current manifest.
 *
 * Token counting strategy (T8 iter4 — real counting):
 *
 * hook / gitignore_entry   → 0 tokens (not visible to agent)
 * augment_claudemd         → Math.ceil(blockBody.length / 4)
 *                            where blockBody is the content INSIDE the markers
 *                            (the body written by the installer, NOT including
 *                            the marker lines themselves — those don't appear
 *                            in the agent's CLAUDE.md context, the body does)
 * slash_command            → Math.ceil(description.length / 4) per file
 *                            where description is the YAML frontmatter
 *                            `description:` field value (only the description
 *                            appears in the agent's slash command index; the
 *                            body of the slash file does not)
 * mcp_server               → sum of Math.ceil(desc.length / 4) per tool
 *                            Descriptions are STATIC — baked as a constant
 *                            from the same ToolDef array used by the server.
 *                            This avoids spawning the MCP server at doctor time.
 * skill                    → Math.ceil(content.length / 4) for SKILL.md ONLY.
 *                            reference.md is on-demand (loaded by agent when needed),
 *                            NOT in fixed context → counted as 0.
 *                            Distinction: basename === "SKILL.md" → count; else → 0.
 * subagent                 → 0 tokens in main agent context.
 *                            Subagent descriptions appear in Claude Code's subagent
 *                            index (a separate UI surface), NOT injected into the main
 *                            agent context. subagentDescriptions breakdown = 0.
 *                            T8.D1: This design decision is enforced and tested by
 *                            doctor-measure-teaching.test.ts (HARD GATE ≤ 500 tokens).
 *                            If Claude Code 2026 changes subagent injection semantics,
 *                            update this constant and re-run the gate test.
 * statusline               → 0 tokens (UI element rendered in status bar, never
 *                            injected into agent context per design §5).
 * sessionStart hook        → 120 tokens (conservative maximum per design §6/T8.D1).
 *                            The SessionStart hook prints a summary to stdout which
 *                            Claude Code injects into the agent context for the session.
 *                            The actual summary is ≤120 tokens (≤480 chars), so we
 *                            use 120 as the hard worst-case constant for budget math.
 *                            Using the conservative max guarantees the budget test
 *                            catches any real overage.
 *
 * SG-C: bundle size soft warning (D5/D6/D7 from v1.2 design).
 * softThresholdKb / classifyBundle / formatBundleLine exported for unit tests.
 */

import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProjectRoot, makePaths, type ProjectPaths } from "../../core/paths.js";
import { readManifest } from "../../core/manifest.js";
import type { Manifest } from "../../types/manifest.js";
import { bootstrapClaudeCodeInstallers } from "../../connectors/claude-code/artifacts/index.js";
import { getInstaller } from "../../connectors/claude-code/artifacts/registry.js";
import { readState } from "../../core/state.js";
import { generateUlid } from "../../util/ulid.js";
import { renderTable, renderKv, renderJson } from "../render.js";
import { computeTokenBreakdown } from "../../core/token-measure.js";
import { readContext } from "../../generate/render-context.js";

// ---------- SG-C bundle helpers (exported for unit tests) ----------

export type BundleStatus = "ok" | "warn" | "fail" | "not_built";

export interface BundleResult {
  name: string;
  path: string;
  capKb: number;
  softKb: number;
  status: BundleStatus;
  sizeKb?: number;
}

/** D6: soft = cap-20 if cap>=200, else floor(cap*0.95) */
export function softThresholdKb(c: number): number {
  return c >= 200 ? c - 20 : Math.floor(c * 0.95);
}

/** Classify actual bytes vs cap KB → "ok"|"warn"|"fail" */
export function classifyBundle(b: number, c: number): Exclude<BundleStatus, "not_built"> {
  const s = softThresholdKb(c) * 1024;
  return b >= c * 1024 ? "fail" : b >= s ? "warn" : "ok";
}

/** Format one bundle result as a human-readable line (D7). nc=true strips ANSI. */
export function formatBundleLine(r: BundleResult, nc: boolean): string {
  const p = r.path.padEnd(44);
  if (r.status === "not_built") return nc ? `- ${p} (not built)` : `\x1b[2m- ${p} (not built)\x1b[0m`;
  const s = `${r.sizeKb!.toFixed(2).padStart(7)} KB  (cap ${r.capKb} KB, soft ${r.softKb} KB)`;
  const [an, sy] = r.status==="fail" ? ["\x1b[31m","✗"] : r.status==="warn" ? ["\x1b[33m","⚠"] : ["\x1b[32m","✓"];
  return `${nc ? sy : an+sy+"\x1b[0m"} ${p} ${s}`;
}

// D6: bundle cap table — [name, path-relative-to-root, capKb]
const BC=[["cli","dist/cli/index.cjs",400],["hook","dist/connectors/claude-code/hook.cjs",50],["mcp","dist/mcp/server.cjs",100],["html","dist/export/html.cjs",400]] as [string,string,number][];
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _fs=require("node:fs") as {statSync:(p:string)=>{size:number}};
function checkBundles(root: string): BundleResult[] {
  return BC.map(([name,p,cap])=>{
    const softKb=softThresholdKb(cap);
    try{const sz=_fs.statSync(`${root}/${p}`).size;return{name,path:p,capKb:cap,softKb,status:classifyBundle(sz,cap),sizeKb:sz/1024};}
    catch{return{name,path:p,capKb:cap,softKb,status:"not_built" as const};}
  });
}

// -------------------------------------------------------------------
// MCP project-root arg check (Req 1.2 — warns on old manifests)
// -------------------------------------------------------------------

export interface McpProjectRootCheckResult {
  ok: boolean;
  /** Human-readable warning message when ok === false. */
  warning?: string;
}

/**
 * Check that the installed logbook-mcp entry in .mcp.json carries
 * `--project-root <paths.root>` in its args array.
 *
 * Emits a WARNING (not a failure) when:
 *   - `--project-root` is absent from args (old manifest, pre-upgrade).
 *   - `--project-root` is present but the stored value does not match `paths.root`.
 *
 * Returns { ok: true } when the check passes or when the mcp_server artifact is
 * not installed (nothing to warn about).
 *
 * Never throws — all I/O errors are silently swallowed (doctor degrades gracefully).
 */
export function checkMcpProjectRootArg(
  paths: ProjectPaths,
  manifest: Manifest,
): McpProjectRootCheckResult {
  const hasMcpArtifact = manifest.artifacts.some((a) => a.kind === "mcp_server");
  if (!hasMcpArtifact) return { ok: true };

  const mcpJsonPath = join(paths.root, ".mcp.json");
  if (!existsSync(mcpJsonPath)) return { ok: true };

  try {
    const raw = readFileSync(mcpJsonPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers = parsed["mcpServers"] as Record<string, unknown> | undefined;
    if (!mcpServers) return { ok: true };

    const entry = mcpServers["logbook-mcp"] as Record<string, unknown> | undefined;
    if (!entry) return { ok: true };

    const args = entry["args"];
    if (!Array.isArray(args)) {
      return {
        ok: false,
        warning:
          "logbook-mcp entry in .mcp.json has no args array — missing --project-root. Re-run `logbook install` to upgrade.",
      };
    }

    const prIdx = (args as unknown[]).indexOf("--project-root");
    if (prIdx === -1) {
      return {
        ok: false,
        warning:
          "logbook-mcp entry in .mcp.json is missing --project-root arg. Re-run `logbook install` to upgrade.",
      };
    }

    const storedRoot = (args as unknown[])[prIdx + 1];
    if (storedRoot !== paths.root) {
      return {
        ok: false,
        warning: `logbook-mcp --project-root value ("${String(storedRoot)}") does not match current project root ("${paths.root}"). Re-run \`logbook install\` to fix.`,
      };
    }

    return { ok: true };
  } catch {
    // Silently ignore I/O / JSON errors — doctor never crashes.
    return { ok: true };
  }
}

// -------------------------------------------------------------------
// Truncation counter
// -------------------------------------------------------------------

/**
 * Count events in the last 24 hours that have `meta.truncated === true`.
 * These indicate hook stdin reads that timed out before the payload was
 * fully received. Returns 0 when events.jsonl is absent or unreadable.
 */
export async function countTruncatedLast24h(paths: ProjectPaths): Promise<number> {
  try {
    const ctx = await readContext(paths);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return ctx.all.filter((event) => {
      // Only count events within the last 24h.
      if (event.ts < cutoff) return false;
      // Check meta.truncated === true.
      const meta = event["meta"];
      if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return false;
      return (meta as Record<string, unknown>)["truncated"] === true;
    }).length;
  } catch {
    // Never crash doctor — degrade silently.
    return 0;
  }
}

// -------------------------------------------------------------------

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Diagnose install health and measure context cost",
  },
  args: {
    measure: {
      type: "boolean",
      default: false,
      description: "Measure token budget consumed by installed artifacts",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    let root: string;
    try {
      root = resolveProjectRoot();
    } catch (err) {
      process.stderr.write(
        `error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    const paths = makePaths(root);
    const manifest = readManifest(paths.manifestPath);

    if (manifest === null) {
      process.stdout.write("LogBook not installed.\n");
      process.exit(0);
    }

    bootstrapClaudeCodeInstallers();

    const state = readState(paths.statePath);
    const now = () => new Date().toISOString();
    const ulid = generateUlid;

    const installCtx = {
      projectRoot: paths.root,
      preset: manifest.preset,
      manifest,
      backups: new Map(),
      dryRun: false,
      dryRunContext: undefined,
      now,
      ulid,
      paths,
    };

    // Verify each artifact
    const verifyResults: Array<{
      id: string;
      kind: string;
      file: string;
      ok: boolean;
      reason?: string;
    }> = [];

    for (const entry of manifest.artifacts) {
      let ok = false;
      let reason: string | undefined;
      try {
        const installer = getInstaller(entry.kind);
        const result = await installer.verify(entry, installCtx);
        ok = result.ok;
        reason = result.reason;
      } catch {
        ok = false;
        reason = "unknown-kind";
      }
      if (reason !== undefined) {
        verifyResults.push({ id: entry.id, kind: entry.kind, file: entry.file_path, ok, reason });
      } else {
        verifyResults.push({ id: entry.id, kind: entry.kind, file: entry.file_path, ok });
      }
    }

    // Check MCP --project-root arg health (Req 1.2 — warns on old manifests).
    const mcpRootCheck = checkMcpProjectRootArg(paths, manifest);

    // Measure token budget — real chars/4 counting (T8 iter4).
    // Logic extracted to src/core/token-measure.ts (iter6 T1).
    const breakdown = computeTokenBreakdown(manifest, paths.root);

    const fixedContextTokens =
      breakdown.skill +
      breakdown.augmentClaudemd +
      breakdown.mcpToolDescriptions +
      breakdown.slashCommandDescriptions +
      breakdown.subagentDescriptions +
      breakdown.statusline +
      breakdown.sessionStart;

    // D6/D7: check bundle sizes (statSync, relative to project root)
    const bundles = checkBundles(root);

    // Count truncated hook events in the last 24h (persistence-truthfulness spec).
    const truncatedCount = await countTruncatedLast24h(paths);

    if (args["json"]) {
      process.stdout.write(
        renderJson({
          fixedContextTokens,
          breakdown,
          verify: verifyResults.map(({ id, kind, ok, reason }) => ({
            id,
            kind,
            ok,
            ...(reason !== undefined ? { reason } : {}),
          })),
          disabled: state.disabled,
          bundles: bundles.map(({ name, path: p, capKb, softKb, status, sizeKb }) => ({ name, path: p, capKb, softKb, status, sizeKb })),
          mcpProjectRootCheck: { ok: mcpRootCheck.ok, ...(mcpRootCheck.warning !== undefined ? { warning: mcpRootCheck.warning } : {}) },
          truncatedEvents24h: truncatedCount,
        }),
      );
      return;
    }

    // Human-readable output
    const verifyRows = verifyResults.map((r) => [
      r.id,
      r.kind,
      r.file,
      r.ok ? "ok" : `FAIL (${r.reason ?? "unknown"})`,
    ]);

    process.stdout.write(
      renderTable(
        [
          { header: "id" },
          { header: "kind" },
          { header: "file" },
          { header: "status" },
        ],
        verifyRows,
      ),
    );

    if (args["measure"]) {
      process.stdout.write(
        renderKv([
          ["fixedContextTokens", String(fixedContextTokens)],
          ["skill", String(breakdown.skill)],
          ["augmentClaudemd", String(breakdown.augmentClaudemd)],
          ["mcpToolDescriptions", String(breakdown.mcpToolDescriptions)],
          ["slashCommandDescriptions", String(breakdown.slashCommandDescriptions)],
          ["subagentDescriptions", String(breakdown.subagentDescriptions)],
          ["statusline", String(breakdown.statusline)],
          ["sessionStart", String(breakdown.sessionStart)],
        ]),
      );
    }

    // Emit MCP project-root warning when the check finds an issue.
    if (!mcpRootCheck.ok && mcpRootCheck.warning !== undefined) {
      process.stdout.write(`\nWARNING: ${mcpRootCheck.warning}\n`);
    }

    // Emit truncation warning only when N > 0 — no noise on healthy runs.
    if (truncatedCount > 0) {
      process.stdout.write(
        renderKv([["truncated-events-24h", String(truncatedCount)]]),
      );
      process.stdout.write(
        `WARN: ${truncatedCount} event(s) were truncated by stdin timeout — hook payloads are exceeding 150ms read budget\n`,
      );
    }

    // D7: emit Bundles section (D5: never changes exit code)
    const nc = !process.stdout.isTTY || process.env.NO_COLOR === "1";
    process.stdout.write("\nBundles\n");
    for (const r of bundles) process.stdout.write(formatBundleLine(r, nc) + "\n");
  },
});

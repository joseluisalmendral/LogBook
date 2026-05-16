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
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readManifest } from "../../core/manifest.js";
import { bootstrapClaudeCodeInstallers } from "../../connectors/claude-code/artifacts/index.js";
import { getInstaller } from "../../connectors/claude-code/artifacts/registry.js";
import { readState } from "../../core/state.js";
import { generateUlid } from "../../util/ulid.js";
import { renderTable, renderKv, renderJson } from "../render.js";
import { toLF } from "../../util/crlf.js";

// ---------------------------------------------------------------------------
// Static MCP tool description constants (T13.D1 — pragmatic bake-in)
//
// These are the exact description strings from src/mcp/tools/*.ts.
// They are duplicated here instead of imported from the MCP bundle because:
//   1. Importing from a CJS bundle would create a circular dep risk at runtime.
//   2. The MCP server bundle is not guaranteed to be on the module resolution
//      path when doctor runs (it is spawned by Claude Code, not by us).
//   3. The descriptions are STATIC — they won't change without a version bump.
//
// When descriptions change in the tool files, update this array too.
// The inline-css-sync pattern from T12 could be applied here in iter3 if
// description drift becomes a concern (a test asserting exact-match).
// ---------------------------------------------------------------------------
const MCP_TOOL_DESCRIPTIONS: readonly string[] = [
  "Log an architectural decision.",         // logbook_decision
  "Log a didactic error.",                  // logbook_error
  "Link a fix to an error.",               // logbook_fix
  "Log a lesson learned (human-authored).", // logbook_lesson
  "Log an external resource.",             // logbook_resource
  "Close a phase with a milestone.",       // logbook_milestone
  "Switch active phase.",                  // logbook_phase
  "Queue a suggestion for human review.",  // logbook_suggest
  "Get current phase, session, pending.",  // logbook_state
];

// ---------------------------------------------------------------------------
// Augment block marker constants — mirrors claudemd.ts
// ---------------------------------------------------------------------------
const START_MARKER = "<!-- logbook:generated start v=1 -->";
const END_MARKER = "<!-- logbook:generated end -->";
const BLOCK_RE = /<!--\s*logbook:generated start v=(\d+)\s*-->([\s\S]*?)<!--\s*logbook:generated end\s*-->/;

// T8.D1 — SessionStart conservative max (design §6):
// The SessionStart hook summary is ≤120 tokens (≤480 chars).
// Doctor uses this constant for worst-case budget math.
// If the sessionStart hook is not installed, this constant is NOT applied (stays 0).
const SESSION_START_CONSERVATIVE_MAX_TOKENS = 120;

// Artifact kinds that contribute to fixed context (iter2+)
// In iter1 minimal, none of these are installed.
const CONTEXT_CONTRIBUTING_KINDS = new Set(["skill", "augment_claudemd", "mcp_server", "slash_command", "hook"]);

// ---------------------------------------------------------------------------
// Token counting helpers
// ---------------------------------------------------------------------------

/**
 * Read the augment_claudemd body from the installed CLAUDE.md.
 * Returns the body (content between the markers, NOT including the markers).
 * Returns null if the file or block is not found.
 */
function readAugmentBody(projectRoot: string, filePath: string): string | null {
  const absPath = path.join(projectRoot, filePath);
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const { content } = toLF(raw);
  BLOCK_RE.lastIndex = 0;
  const match = BLOCK_RE.exec(content);
  if (!match) return null;
  // match[2] is the content between start and end markers (the body)
  // trim leading/trailing whitespace that the upsert primitive adds as \n separators
  return match[2]?.trim() ?? null;
}

/**
 * Parse the YAML frontmatter `description:` field from a slash command file.
 * Returns null if the field is absent.
 *
 * We use a simple line-scan rather than a full YAML parser to avoid adding a
 * dependency. The frontmatter format is guaranteed by the slash asset templates:
 *   ---
 *   description: Some text here
 *   ---
 */
function parseSlashDescription(content: string): string | null {
  const lines = content.split("\n");
  let inFrontmatter = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        // End of frontmatter
        break;
      }
    }
    if (inFrontmatter && trimmed.startsWith("description:")) {
      return trimmed.slice("description:".length).trim();
    }
  }
  return null;
}

/**
 * Read the description field from an installed slash command file.
 * Returns null if the file is absent or has no description.
 */
function readSlashDescription(projectRoot: string, filePath: string): string | null {
  const absPath = path.join(projectRoot, filePath);
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  return parseSlashDescription(raw);
}

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

    // Measure token budget — real chars/4 counting (T8 iter4)
    const breakdown = {
      skill: 0,                    // SKILL.md only (Math.ceil(content.length / 4))
      augmentClaudemd: 0,
      mcpToolDescriptions: 0,
      slashCommandDescriptions: 0,
      subagentDescriptions: 0,     // T8: always 0 (UI index, NOT agent context per design §4)
      statusline: 0,               // T8: always 0 (UI element, per design §5)
      sessionStart: 0,             // T8: 120 when SessionStart hook installed; 0 otherwise
    };

    // Track whether a SessionStart hook is installed (for conservative max accounting).
    let hasSessionStartHook = false;

    // Per-kind token contribution:
    //   augment_claudemd    → chars/4 of the block body (NOT the markers)
    //   mcp_server          → sum of chars/4 per tool description (static constant)
    //   slash_command       → chars/4 of the YAML description: field per file
    //   skill               → chars/4 of SKILL.md only (reference.md = 0, on-demand)
    //   hook (SessionStart) → SESSION_START_CONSERVATIVE_MAX_TOKENS (120) — T8.D1
    //   hook (other)        → 0 (PostToolUse hooks are not injected into agent context)
    //   subagent            → 0 (UI index only, not agent context — T8.D1)
    //   statusline          → 0 (UI element, not agent context — design §5)
    //   gitignore_entry     → 0
    for (const entry of manifest.artifacts) {
      if (!CONTEXT_CONTRIBUTING_KINDS.has(entry.kind)) continue;

      if (entry.kind === "augment_claudemd") {
        // Read the body from the installed CLAUDE.md file
        const body = readAugmentBody(paths.root, entry.file_path);
        if (body !== null) {
          breakdown.augmentClaudemd += Math.ceil(body.length / 4);
        }
      } else if (entry.kind === "mcp_server") {
        // Sum chars/4 over all tool descriptions (static constant — no subprocess)
        for (const desc of MCP_TOOL_DESCRIPTIONS) {
          breakdown.mcpToolDescriptions += Math.ceil(desc.length / 4);
        }
      } else if (entry.kind === "slash_command") {
        // Parse description: field from the installed slash file
        const desc = readSlashDescription(paths.root, entry.file_path);
        if (desc !== null) {
          breakdown.slashCommandDescriptions += Math.ceil(desc.length / 4);
        }
      } else if (entry.kind === "skill") {
        // Only SKILL.md is in fixed context (loaded by Claude Code into agent context).
        // reference.md is on-demand — the agent reads it only when needed → 0 tokens.
        const basename = path.basename(entry.file_path);
        if (basename === "SKILL.md") {
          const absPath = path.join(paths.root, entry.file_path);
          let content: string;
          try {
            content = fs.readFileSync(absPath, "utf8");
            breakdown.skill += Math.ceil(content.length / 4);
          } catch {
            // File missing: 0 tokens (verify will report it as FAIL)
          }
        }
        // reference.md → 0 (on-demand only, not in fixed context)
      } else if (entry.kind === "hook") {
        // Only SessionStart hooks contribute to fixed context (stdout injected into session).
        // PostToolUse and other hook events do NOT inject context → 0.
        // We detect SessionStart via the manifest entry id (lb-hook-sessionstart-*).
        // T8.D1: use conservative maximum (120 tokens) regardless of actual summary length.
        const id = entry.id as string;
        if (id.includes("sessionstart") || id.includes("session-start")) {
          hasSessionStartHook = true;
        }
        // subagent / statusline / gitignore_entry → skip (not in CONTEXT_CONTRIBUTING_KINDS for explicit tracking)
      }
      // subagentDescriptions = 0 always (UI index only, not agent context)
      // statusline = 0 always (UI element, not agent context)
    }

    // Apply SessionStart conservative max after the loop
    if (hasSessionStartHook) {
      breakdown.sessionStart = SESSION_START_CONSERVATIVE_MAX_TOKENS;
    }

    const fixedContextTokens =
      breakdown.skill +
      breakdown.augmentClaudemd +
      breakdown.mcpToolDescriptions +
      breakdown.slashCommandDescriptions +
      breakdown.subagentDescriptions +
      breakdown.statusline +
      breakdown.sessionStart;

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
  },
});

/**
 * logbook doctor — diagnose install health and measure context cost.
 *
 * --measure computes fixedContextTokens for the current manifest.
 *
 * Token counting strategy (T13 — real counting):
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
 * skill                    → 0 (iter3)
 * subagent / statusline    → 0 (iter4)
 * sessionStart             → 0 (iter4)
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

// Artifact kinds that contribute to fixed context (iter2+)
// In iter1 minimal, none of these are installed.
const CONTEXT_CONTRIBUTING_KINDS = new Set(["skill", "augment_claudemd", "mcp_server", "slash_command"]);

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

    // Measure token budget — real chars/4 counting (T13)
    const breakdown = {
      skill: 0,              // iter3 deferred
      augmentClaudemd: 0,
      mcpToolDescriptions: 0,
      slashCommandDescriptions: 0,
      sessionStart: 0,       // iter4 deferred
    };

    // Per-kind token contribution:
    //   augment_claudemd → chars/4 of the block body (NOT the markers)
    //   mcp_server       → sum of chars/4 per tool description (static constant)
    //   slash_command    → chars/4 of the YAML description: field per file
    //   skill / hook / gitignore_entry / subagent / statusline → 0
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
      }
      // "skill" → 0 (iter3)
    }

    const fixedContextTokens =
      breakdown.skill +
      breakdown.augmentClaudemd +
      breakdown.mcpToolDescriptions +
      breakdown.slashCommandDescriptions +
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
          ["sessionStart", String(breakdown.sessionStart)],
        ]),
      );
    }
  },
});

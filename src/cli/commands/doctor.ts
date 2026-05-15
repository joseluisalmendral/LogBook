/**
 * logbook doctor — diagnose install health and measure context cost.
 *
 * --measure computes fixedContextTokens for the current manifest.
 * iter1 minimal installs only hooks + gitignore_entry, neither of which
 * contributes to the agent's fixed context — so the value is always 0.
 */

import { defineCommand } from "citty";
import { resolveProjectRoot, makePaths } from "../../core/paths.js";
import { readManifest } from "../../core/manifest.js";
import { bootstrapClaudeCodeInstallers } from "../../connectors/claude-code/artifacts/index.js";
import { getInstaller } from "../../connectors/claude-code/artifacts/registry.js";
import { readState } from "../../core/state.js";
import { generateUlid } from "../../util/ulid.js";
import { renderTable, renderKv, renderJson } from "../render.js";

// Artifact kinds that contribute to fixed context (iter2+)
// In iter1 minimal, none of these are installed.
const CONTEXT_CONTRIBUTING_KINDS = new Set(["skill", "augment_claudemd", "mcp_server", "slash_command"]);

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

    // Measure token budget (iter1 minimal = 0 for all categories)
    const breakdown = {
      skill: 0,
      augmentClaudemd: 0,
      mcpToolDescriptions: 0,
      sessionStart: 0,
    };

    // Future: iterate manifest.artifacts, for context-contributing kinds,
    // read their content and compute Math.ceil(textLen / 4).
    // iter1 minimal: hooks and gitignore_entry contribute 0 tokens.
    for (const entry of manifest.artifacts) {
      if (CONTEXT_CONTRIBUTING_KINDS.has(entry.kind)) {
        // Would compute token contribution here in iter2+.
        // For now this branch is never reached in minimal preset.
      }
    }

    const fixedContextTokens =
      breakdown.skill + breakdown.augmentClaudemd + breakdown.mcpToolDescriptions + breakdown.sessionStart;

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
          ["sessionStart", String(breakdown.sessionStart)],
        ]),
      );
    }
  },
});

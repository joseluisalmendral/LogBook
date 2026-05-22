/**
 * MCPServerInstaller — ArtifactInstaller<{kind:"mcp_server"}> for .mcp.json.
 *
 * Install strategy (design §5, T4):
 * - Target: `.mcp.json` at the PROJECT ROOT (committable, project-scoped).
 *   This is the canonical location Claude Code reads for project-scoped MCP
 *   servers (equivalent to `claude mcp add <name> --scope project`).
 * - Anchor: json_object_key with /mcpServers/logbook-mcp + _logbookId
 * - Install: setJsonObjectKey(source, "/mcpServers", "logbook-mcp", entryJson) when
 *   the mcpServers key already exists; controlled JSON.parse+JSON.stringify when absent.
 * - Uninstall: removeJsonObjectKey(source, "/mcpServers", "logbook-mcp")
 *
 * PATH MIGRATION 2026-05-22:
 * Before today the target file was `.claude/mcp.json`. Claude Code does NOT read
 * MCP config from that path — it reads `.mcp.json` at project root for the
 * `project` scope. User-reported symptom: "MCP server existe y arranca pero no
 * está cargado en esta sesión". The dist binary was writing the entry to the
 * wrong place. The fix: write to the canonical `.mcp.json` at root, accepting
 * that Claude Code will prompt the user to approve the server on first session
 * (correct security behavior for project-scoped MCP).
 *
 * CONTROLLED RE-SERIALIZE POLICY (T4.D2):
 * We permit JSON.parse+JSON.stringify ONLY when the mcpServers key does NOT yet exist
 * in the file. Once mcpServers is present, ALL edits go through string-patch primitives
 * to preserve byte-identity for the bytes outside the insertion span.
 *
 * Limitation: when we inject mcpServers into a file that already has OTHER top-level
 * keys (e.g. {"otherKey":"value"}), the controlled re-serialize reformats the entire
 * file at 2-space indent. The pre-existing bytes outside the new mcpServers key are
 * NOT preserved byte-for-byte. This is documented as T4.D2 and is acceptable because:
 * - The file had no mcpServers key (so Claude Code wasn't reading MCP config from it).
 * - We record createdMcpServersKey=true so uninstall can remove the key symmetrically.
 * - Real-world `.mcp.json` files always have mcpServers at the top level.
 *
 * CONTENT HASH POLICY:
 * content_hash is computed over canonical JSON (sorted keys, no whitespace) of the
 * inserted value object. This makes verify() byte-layout-independent: it re-parses
 * the located object and canonicalizes before hash comparison.
 *
 * CRLF POLICY (T3):
 * All read/write paths flow through toLF/fromLF. The detectedLineEnding is captured
 * at install time and stored in the ManifestArtifact for symmetric uninstall.
 */

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import type {
  ArtifactInstaller,
  InstallContext,
  DetectionResult,
  VerifyResult,
} from "./installer.js";
import type { Artifact } from "../../../types/artifact.js";
import type { ManifestArtifact } from "../../../types/manifest.js";
import {
  setJsonObjectKey,
  removeJsonObjectKey,
  AnchorNotFoundError,
} from "../../../util/json-string-patch.js";
import { sha256 } from "../../../util/hash.js";
import { toLF, fromLF } from "../../../util/crlf.js";
import type { LineEnding } from "../../../util/crlf.js";

type McpServerArtifact = Extract<Artifact, { kind: "mcp_server" }>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The key we insert under /mcpServers in .mcp.json. */
const MCP_KEY = "logbook-mcp";

/**
 * Project-relative path of the target file.
 *
 * Was `.claude/mcp.json` before 2026-05-22. Claude Code does NOT read MCP
 * config from there. The canonical project-scope location is `.mcp.json` at
 * the project root (matches `claude mcp add <name> --scope project`).
 */
const MCP_JSON_PATH = ".mcp.json";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Canonical JSON: stringify with sorted keys and no whitespace, for stable hashing. */
function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = (obj as Record<string, unknown>)[key];
  }
  return JSON.stringify(sorted);
}

/** Atomic write: write to a tmp file then rename. */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);
}

/** Read file as UTF-8. Returns null if absent. */
async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Build the JSON value text for the logbook MCP server entry.
 *
 * Production path: resolves absolute path to dist/mcp/server.cjs relative to
 * this file's location in the compiled output (dist/connectors/claude-code/artifacts/).
 * Test override: set LOGBOOK_MCP_SERVER_PATH env var (T7 will produce the real bundle).
 */
function buildMcpServerPath(artifact: McpServerArtifact): string {
  // Allow test override so tests can use a placeholder path without the bundle existing.
  if (process.env["LOGBOOK_MCP_SERVER_PATH"]) {
    return process.env["LOGBOOK_MCP_SERVER_PATH"];
  }
  // When args are provided by the caller, use the first arg directly.
  if (artifact.args.length > 0 && artifact.args[0]) {
    return artifact.args[0];
  }
  // Production fallback: resolve relative to compiled output.
  // Compiled layout: dist/connectors/claude-code/artifacts/mcp.cjs → dist/mcp/server.cjs
  return nodePath.resolve(__dirname, "../../../mcp/server.cjs");
}

/** Build the JSON text of the value object to insert under /mcpServers/logbook-mcp. */
function buildEntryJson(artifact: McpServerArtifact): string {
  const serverPath = buildMcpServerPath(artifact);
  const entry: Record<string, unknown> = {
    type: "stdio",
    command: artifact.command,
    args: [serverPath],
    _logbookId: artifact._logbookId,
  };
  if (artifact.env && Object.keys(artifact.env).length > 0) {
    entry["env"] = artifact.env;
  }
  return JSON.stringify(entry);
}

/**
 * Locate and parse the entry under /mcpServers/logbook-mcp by key name.
 * Used by verify() as the primary lookup (key-based, not id-based).
 * Returns the parsed value object or null if the key is absent.
 *
 * We parse only the bounded slice of the value — not the full source.
 */
function locateEntryByKey(
  source: string,
  key: string
): Record<string, unknown> | null {
  // Quick pre-check: the key must appear as a JSON string in the file
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp(`"${escapedKey}"\\s*:`);
  if (!keyPattern.test(source)) return null;

  // Full parse the mcpServers object to extract the key's value.
  // We do a JSON.parse on the full source here — this is ONLY in verify(),
  // not in install/uninstall which must preserve byte-identity.
  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    const mcpServers = parsed["mcpServers"];
    if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
      return null;
    }
    const entry = (mcpServers as Record<string, unknown>)[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    return entry as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// MCPServerInstaller
// ---------------------------------------------------------------------------

export class MCPServerInstaller implements ArtifactInstaller<McpServerArtifact> {
  readonly kind = "mcp_server" as const;

  async detect(artifact: McpServerArtifact, ctx: InstallContext): Promise<DetectionResult> {
    // Check the manifest for an existing logbook entry for this file + id.
    // Coexistence with other plugins is handled by key namespacing (our key is "logbook-mcp").
    const existing = ctx.manifest.artifacts.find(
      (a) =>
        a.file_path === MCP_JSON_PATH &&
        a.anchor.type === "json_object_key" &&
        a.anchor.idValue === artifact._logbookId
    );
    if (existing) {
      return { status: "occupied-by-logbook", existing };
    }
    return { status: "empty" };
  }

  async install(artifact: McpServerArtifact, ctx: InstallContext): Promise<ManifestArtifact> {
    const targetPath = nodePath.join(ctx.projectRoot, MCP_JSON_PATH);
    const logbookId = artifact._logbookId;
    const entryJson = buildEntryJson(artifact);

    // Compute content_hash over canonical JSON of the inserted object.
    // Canonical form is sort-key-normalized — layout-independent for verify().
    const parsedEntry = JSON.parse(entryJson) as Record<string, unknown>;
    const contentHash = sha256(canonicalJson(parsedEntry));

    const rawSource = await readFileOrNull(targetPath);

    // Track whether we created the file from scratch (for uninstall cleanup).
    const createdFile = rawSource === null;

    // CRLF normalize: work in LF internally for all string operations.
    // fromLF restores original line endings on write.
    const { content: source, original: detectedEnding } = rawSource !== null
      ? toLF(rawSource)
      : { content: '{"mcpServers":{}}', original: "lf" as LineEnding };

    let next: string;
    let createdMcpServersKey = false;

    // Detect whether the mcpServers key already exists in the source.
    const mcpServersKeyPresent = /"mcpServers"\s*:/.test(source);

    if (!mcpServersKeyPresent) {
      // CONTROLLED RE-SERIALIZE PATH: mcpServers does not yet exist in the file.
      // We must inject the mcpServers structure. We only do this when the target
      // key is absent — never when existing mcpServers bytes would be mangled.
      //
      // Parse the LF-normalized content (safe because we'll re-serialize the
      // whole thing; no existing mcpServers bytes to preserve outside the span).
      //
      // WHY controlled re-serialize instead of string-patch:
      // String-patch (setJsonObjectKey) can only insert a key inside an EXISTING
      // object at jsonPath. When mcpServers doesn't exist, we'd need to insert it
      // at the ROOT level, which requires a new parent key — a two-level insertion
      // that the string-patch primitive does not support. The alternative would be
      // a full JSON tokenizer rewrite to handle nested key creation. The controlled
      // re-serialize is the pragmatic, auditable path: limited scope (only fires
      // when mcpServers is absent), and the limitation (reformatting outer content
      // when other top-level keys exist) is documented as T4.D2.
      const parsed = JSON.parse(source) as Record<string, unknown>;

      if (!parsed["mcpServers"] || typeof parsed["mcpServers"] !== "object") {
        parsed["mcpServers"] = {};
        createdMcpServersKey = true;
      }

      // Re-serialize with 2-space indent to get a clean base.
      const reserializedBase = JSON.stringify(parsed, null, 2) + "\n";

      // Now insert our key using string-patch (which handles the existing {} cleanly).
      const insertResult = setJsonObjectKey({
        source: reserializedBase,
        jsonPath: "/mcpServers",
        key: MCP_KEY,
        valueJson: entryJson,
      });
      next = insertResult.next;
    } else {
      // STRING-PATCH PATH: mcpServers already exists — use setJsonObjectKey
      // to preserve every byte outside the insertion span.
      const insertResult = setJsonObjectKey({
        source,
        jsonPath: "/mcpServers",
        key: MCP_KEY,
        valueJson: entryJson,
      });
      next = insertResult.next;
    }

    // Ensure parent directory exists (in case .claude/ was absent)
    await fs.mkdir(nodePath.dirname(targetPath), { recursive: true });

    // Restore original line endings before writing (CRLF normalize — T3).
    await atomicWrite(targetPath, fromLF(next, detectedEnding));

    return {
      id: logbookId,
      kind: "mcp_server",
      file_path: MCP_JSON_PATH,
      anchor: {
        type: "json_object_key",
        jsonPath: `/mcpServers/${MCP_KEY}`,
        idField: "_logbookId",
        idValue: logbookId,
        ...(createdMcpServersKey ? { createdMcpServersKey: true } : {}),
        ...(createdFile ? { createdFile: true } : {}),
      },
      content_hash: contentHash,
      installed_at: ctx.now(),
      detectedLineEnding: detectedEnding,
    };
  }

  async uninstall(entry: ManifestArtifact, ctx: InstallContext): Promise<void> {
    const targetPath = nodePath.join(ctx.projectRoot, MCP_JSON_PATH);

    if (entry.anchor.type !== "json_object_key") {
      throw new AnchorNotFoundError(
        `MCPServerInstaller.uninstall: expected json_object_key anchor, got ${entry.anchor.type}`
      );
    }

    const anchor = entry.anchor;

    // If we created the file from scratch, delete it entirely on uninstall.
    if (anchor.createdFile === true) {
      try {
        await fs.unlink(targetPath);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        // Already gone — idempotent.
      }
      return;
    }

    const rawSource = await readFileOrNull(targetPath);
    if (rawSource === null) {
      // File missing — nothing to remove; idempotent.
      return;
    }

    // CRLF normalize: work in LF for all string operations.
    // Use entry.detectedLineEnding as the target; fall back to "lf" for
    // backward compat with entries that lack this field.
    const targetEnding = entry.detectedLineEnding ?? "lf";
    const { content: source } = toLF(rawSource);

    const shouldRemoveMcpServersKey = anchor.createdMcpServersKey === true;

    let next: string;

    // Remove our key from /mcpServers using the string-patch primitive.
    const removeResult = removeJsonObjectKey({
      source,
      jsonPath: "/mcpServers",
      key: MCP_KEY,
    });
    next = removeResult.next;

    // If we injected the mcpServers key during install, remove it entirely now
    // that our entry is gone, restoring the file to its pre-install state.
    if (shouldRemoveMcpServersKey) {
      next = this._removeMcpServersKeyIfEmpty(next);
    }

    // Restore original line endings before writing (CRLF normalize — T3).
    await atomicWrite(targetPath, fromLF(next, targetEnding));
  }

  /**
   * After removeJsonObjectKey, if mcpServers is now empty AND we own the key,
   * remove the mcpServers key entirely via controlled parse+stringify.
   *
   * The re-serialized result will match the original if the original was
   * re-serialized the same way (which it was, in install's controlled path).
   */
  private _removeMcpServersKeyIfEmpty(source: string): string {
    try {
      const parsed = JSON.parse(source) as Record<string, unknown>;
      const mcpServers = parsed["mcpServers"];
      if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
        return source;
      }
      const mcpObj = mcpServers as Record<string, unknown>;

      // Only remove if now empty (our entry was just removed)
      if (Object.keys(mcpObj).length === 0) {
        delete parsed["mcpServers"];
      }

      return JSON.stringify(parsed, null, 2) + "\n";
    } catch {
      return source;
    }
  }

  async verify(entry: ManifestArtifact, ctx: InstallContext): Promise<VerifyResult> {
    const targetPath = nodePath.join(ctx.projectRoot, MCP_JSON_PATH);
    const rawSource = await readFileOrNull(targetPath);

    if (rawSource === null) {
      return { ok: false, reason: "file_missing" };
    }

    if (entry.anchor.type !== "json_object_key") {
      return { ok: false, reason: "anchor_missing" };
    }

    // CRLF normalize before locate: the canonical JSON hash is layout-independent
    // (sorted keys, no whitespace), so CRLF does not affect hash correctness.
    const { content: source } = toLF(rawSource);

    // Primary lookup: find the entry by key name ("logbook-mcp") under mcpServers.
    // This is key-based, not id-based, so it catches tampering of _logbookId too.
    // If the key is absent → anchor_missing.
    // If the key is present but hash mismatches → hash_mismatch.
    const located = locateEntryByKey(source, MCP_KEY);
    if (!located) {
      return { ok: false, reason: "anchor_missing" };
    }

    // Recompute canonical hash over the located object
    const recomputedHash = sha256(canonicalJson(located));
    if (recomputedHash !== entry.content_hash) {
      return { ok: false, reason: "hash_mismatch" };
    }

    return { ok: true };
  }
}

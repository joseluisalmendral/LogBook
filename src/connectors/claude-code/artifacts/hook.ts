/**
 * HookInstaller — ArtifactInstaller<{kind:"hook"}> for .claude/settings.local.json.
 *
 * Install strategy (design §5):
 * - Target: .claude/settings.local.json
 * - Anchor: json_field with _logbookId
 * - Install: insertIntoJsonArray when the array already exists;
 *   controlled JSON.parse+JSON.stringify when the hooks structure is absent.
 * - Uninstall: removeFromJsonArray (find by _logbookId, not by position).
 *
 * CONTROLLED RE-SERIALIZE POLICY:
 * We permit JSON.parse+JSON.stringify ONLY when the target structure
 * (hooks.<Event>) does not yet exist in the file. Once the array is present,
 * ALL edits go through string-patch to preserve byte-identity for the bytes
 * outside the insertion span. This is documented as a S7 decision.
 *
 * CONTENT HASH POLICY:
 * content_hash is computed over canonical JSON (sorted keys, no whitespace)
 * of the inserted object. This makes verify() byte-layout-independent:
 * it re-parses the located object and canonicalizes for the hash comparison.
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
import { ID_PREFIXES } from "./kinds.js";
import {
  insertIntoJsonArray,
  removeFromJsonArray,
  AnchorNotFoundError,
} from "../../../util/json-string-patch.js";
import { sha256 } from "../../../util/hash.js";
// CRLF normalize before string-patch — see crlf.ts (T3 retro-touch)
import { toLF, fromLF } from "../../../util/crlf.js";
import type { LineEnding } from "../../../util/crlf.js";

type HookArtifact = Extract<Artifact, { kind: "hook" }>;

// Canonical JSON: stringify with sorted keys and no whitespace, for stable hashing.
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

/**
 * Build the JSON object text for a hook entry.
 * The entry is the object we insert into the hooks array.
 */
function buildHookEntryJson(
  artifact: HookArtifact,
  logbookId: string
): string {
  const obj: Record<string, unknown> = {
    type: "command",
    command: artifact.command,
    _logbookId: logbookId,
  };
  if (artifact.matcher !== undefined) {
    obj["matcher"] = artifact.matcher;
  }
  return JSON.stringify(obj);
}

/**
 * Resolve the settings.local.json absolute path from InstallContext.
 */
function settingsPath(ctx: InstallContext): string {
  return nodePath.join(ctx.projectRoot, ".claude", "settings.local.json");
}

/**
 * Atomic write: write to a tmp file then rename.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Read file as UTF-8. Returns null if absent.
 */
async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Regex to find an object containing `"_logbookId": "<id>"` in the raw source.
// Used by verify() to locate the installed entry for hash recomputation.
// ---------------------------------------------------------------------------

function makeIdPattern(idValue: string): RegExp {
  // Escape special regex chars in the id value
  const escaped = idValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`"_logbookId"\\s*:\\s*"${escaped}"`);
}

/**
 * Parse the JSON object at the first match of idPattern in source.
 * Returns the parsed object or null if not found or unparseable.
 *
 * We only parse the located bounded slice — not the entire source.
 */
function locateInstalledEntry(
  source: string,
  idValue: string
): Record<string, unknown> | null {
  const pattern = makeIdPattern(idValue);
  const match = pattern.exec(source);
  if (!match) return null;

  // Walk backwards from the match to find the opening `{`
  let braceStart = match.index;
  while (braceStart >= 0 && source[braceStart] !== "{") braceStart--;
  if (braceStart < 0) return null;

  // Walk the JSON object forward from braceStart to find the matching `}`
  let depth = 0;
  let inStr = false;
  let escaped = false;
  let pos = braceStart;

  while (pos < source.length) {
    const ch = source[pos];
    if (escaped) {
      escaped = false;
    } else if (inStr) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const slice = source.slice(braceStart, pos + 1);
          try {
            return JSON.parse(slice) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
    pos++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// HookInstaller
// ---------------------------------------------------------------------------

export class HookInstaller implements ArtifactInstaller<HookArtifact> {
  readonly kind = "hook" as const;

  async detect(artifact: HookArtifact, ctx: InstallContext): Promise<DetectionResult> {
    // Look in manifest for an existing logbook entry for this file + id
    const existing = ctx.manifest.artifacts.find(
      (a) =>
        a.file_path === ".claude/settings.local.json" &&
        a.anchor.type === "json_field" &&
        a.anchor.idValue === artifact._logbookId
    );
    if (existing) {
      return { status: "occupied-by-logbook", existing };
    }
    // Other plugins present in the file are handled by the engine's fingerprint
    // scan — we don't block on them, we coexist by appending last.
    return { status: "empty" };
  }

  async install(artifact: HookArtifact, ctx: InstallContext): Promise<ManifestArtifact> {
    const targetPath = settingsPath(ctx);
    const logbookId = artifact._logbookId;
    const hookEvent = artifact.hookEvent;
    const arrayJsonPath = `/hooks/${hookEvent}`;
    const entryJson = buildHookEntryJson(artifact, logbookId);

    // Compute content_hash over canonical JSON of the inserted object.
    // Canonical form is sort-key-normalized — layout-independent for verify().
    const parsedEntry = JSON.parse(entryJson) as Record<string, unknown>;
    const contentHash = sha256(canonicalJson(parsedEntry));

    const rawSource = await readFileOrNull(targetPath);
    // CRLF normalize: work in LF internally for all string operations.
    // fromLF restores original line endings on write.
    const { content: source, original: detectedEnding } = rawSource !== null
      ? toLF(rawSource)
      : { content: "{}", original: "lf" as LineEnding };

    let next: string;
    let insertedPosition: number;
    let createdHooksStructure = false;

    // Detect whether the hooks.<Event> array path already exists in the source.
    const hooksKeyPresent = /"hooks"\s*:/.test(source);
    const eventArrayPresent =
      hooksKeyPresent &&
      new RegExp(`"${hookEvent}"\\s*:`).test(source);

    if (!eventArrayPresent) {
      // CONTROLLED RE-SERIALIZE PATH: the array doesn't exist yet.
      // We must inject the hooks structure. We only do this when the target
      // structure is absent — never when existing bytes would be mangled.
      //
      // Parse the LF-normalized content (safe because we'll re-serialize the
      // whole thing; no existing hooks bytes to preserve outside the span).
      const parsed = JSON.parse(source) as Record<string, unknown>;

      // Inject the hooks structure
      if (!parsed["hooks"] || typeof parsed["hooks"] !== "object") {
        parsed["hooks"] = {};
        createdHooksStructure = true;
      } else {
        // hooks key existed but the event array was missing
        createdHooksStructure = false;
      }
      const hooks = parsed["hooks"] as Record<string, unknown[]>;
      if (!Array.isArray(hooks[hookEvent])) {
        hooks[hookEvent] = [];
      }

      // Serialize back to a clean LF structure (2-space indent).
      // Byte-identity on uninstall is achievable because:
      // - if createdHooksStructure=true, we own the entire hooks key and will
      //   remove it entirely on uninstall.
      // - if createdHooksStructure=false, the hooks key existed but the event
      //   array didn't — we re-serialize, which may not be byte-identical for
      //   the surrounding content. Known limitation documented in apply-progress.
      const reserializedBase = JSON.stringify(parsed, null, 2) + "\n";

      // Now use insertIntoJsonArray on the re-serialized LF string.
      const insertResult = insertIntoJsonArray({
        source: reserializedBase,
        jsonPath: arrayJsonPath,
        entryJson,
      });
      next = insertResult.next;
      insertedPosition = insertResult.position;
    } else {
      // STRING-PATCH PATH: array already exists — use insertIntoJsonArray
      // to preserve every byte outside the insertion span.
      const insertResult = insertIntoJsonArray({
        source,
        jsonPath: arrayJsonPath,
        entryJson,
      });
      next = insertResult.next;
      insertedPosition = insertResult.position;
    }

    // Restore original line endings before writing (CRLF normalize — T3).
    await atomicWrite(targetPath, fromLF(next, detectedEnding));

    return {
      id: logbookId,
      kind: "hook",
      file_path: ".claude/settings.local.json",
      anchor: {
        type: "json_field",
        jsonPath: `${arrayJsonPath}/${insertedPosition}`,
        idField: "_logbookId",
        idValue: logbookId,
        ...(createdHooksStructure ? { createdHooksStructure: true } : {}),
      },
      content_hash: contentHash,
      installed_at: ctx.now(),
      detectedLineEnding: detectedEnding,
    };
  }

  async uninstall(entry: ManifestArtifact, ctx: InstallContext): Promise<void> {
    const targetPath = settingsPath(ctx);
    const rawSource = await readFileOrNull(targetPath);
    if (rawSource === null) {
      // File missing — nothing to remove; idempotent.
      return;
    }

    if (entry.anchor.type !== "json_field") {
      throw new AnchorNotFoundError(
        `HookInstaller.uninstall: expected json_field anchor, got ${entry.anchor.type}`
      );
    }

    // Extract the hookEvent from the anchor jsonPath: /hooks/<Event>/<index>
    const pathSegments = entry.anchor.jsonPath.split("/");
    // pathSegments: ["", "hooks", "<Event>", "<index>"]
    const hookEvent = pathSegments[2];
    if (!hookEvent) {
      throw new AnchorNotFoundError(
        `HookInstaller.uninstall: cannot extract hookEvent from jsonPath: ${entry.anchor.jsonPath}`
      );
    }

    // CRLF normalize: work in LF for all string operations (T3 retro-touch).
    // Use entry.detectedLineEnding as the target; fall back to "lf" for
    // backward compat with iter1-installed manifests that lack this field.
    const targetEnding = entry.detectedLineEnding ?? "lf";
    const { content: source } = toLF(rawSource);

    // Only remove the hooks structure entirely if we created it during install.
    // This flag is persisted in the anchor to enable byte-identical uninstall
    // for the empty.json case (where we injected the entire hooks key).
    const shouldRemoveHooksKey =
      entry.anchor.type === "json_field" &&
      "createdHooksStructure" in entry.anchor &&
      entry.anchor.createdHooksStructure === true;

    let next: string;
    try {
      next = removeFromJsonArray({
        source,
        jsonPath: `/hooks/${hookEvent}`,
        idField: entry.anchor.idField,
        idValue: entry.anchor.idValue,
      });
    } catch (err) {
      if (err instanceof AnchorNotFoundError) {
        // Already removed — idempotent.
        return;
      }
      throw err;
    }

    // If we created the hooks structure during install, remove it entirely now
    // that our entry is gone, restoring the file to its pre-install state.
    if (shouldRemoveHooksKey) {
      next = this._removeHooksKeyIfEmpty(next, hookEvent);
    }

    // Restore original line endings before writing (CRLF normalize — T3).
    await atomicWrite(targetPath, fromLF(next, targetEnding));
  }

  /**
   * After removeFromJsonArray, if hooks.<Event> is now empty AND hooks has no
   * other events, remove the hooks key entirely via controlled parse+stringify.
   *
   * The re-serialized result will match the original if the original was
   * re-serialized the same way (which it was, in install's controlled path).
   */
  private _removeHooksKeyIfEmpty(source: string, hookEvent: string): string {
    try {
      const parsed = JSON.parse(source) as Record<string, unknown>;
      const hooks = parsed["hooks"];
      if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
        return source;
      }
      const hooksObj = hooks as Record<string, unknown>;
      const arr = hooksObj[hookEvent];
      if (!Array.isArray(arr) || arr.length > 0) {
        return source;
      }

      // Remove the empty event array
      delete hooksObj[hookEvent];

      // If hooks object is now empty, remove hooks key entirely
      if (Object.keys(hooksObj).length === 0) {
        delete parsed["hooks"];
      }

      return JSON.stringify(parsed, null, 2) + "\n";
    } catch {
      return source;
    }
  }

  async verify(entry: ManifestArtifact, ctx: InstallContext): Promise<VerifyResult> {
    const targetPath = settingsPath(ctx);
    const rawSource = await readFileOrNull(targetPath);

    if (rawSource === null) {
      return { ok: false, reason: "file_missing" };
    }

    if (entry.anchor.type !== "json_field") {
      return { ok: false, reason: "anchor_missing" };
    }

    // CRLF normalize before locate: the canonical JSON hash is layout-independent
    // (sorted keys, no whitespace), so CRLF does not affect hash correctness.
    // Normalizing to LF ensures locateInstalledEntry works on CRLF files (T3).
    const { content: source } = toLF(rawSource);

    // Locate the object with matching _logbookId
    const located = locateInstalledEntry(source, entry.anchor.idValue);
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

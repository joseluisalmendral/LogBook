/**
 * HookInstaller — ArtifactInstaller<{kind:"hook"}> for .claude/settings.local.json.
 *
 * Install strategy (design §5):
 * - Target: .claude/settings.local.json
 * - Anchor: json_field with _logbookId
 * - Install: pure string-patch for ALL cases — no JSON.parse+JSON.stringify on source.
 *   Step 1: if hooks key absent, inject "hooks": {} via setJsonObjectKey (root).
 *   Step 2: if hooks.<Event> array absent, inject "<Event>": [] via setJsonObjectKey (/hooks).
 *   Step 3: insertIntoJsonArray to append the hook entry into the (now-present) array.
 * - Uninstall: reverse the above steps via string-patch only:
 *   Step 1: removeFromJsonArray to remove our entry.
 *   Step 2: if createdHookEvent → removeJsonObjectKey to remove the now-empty event array.
 *   Step 3: if createdHooksStructure → removeJsonObjectKey to remove the now-empty hooks key.
 *
 * PURE STRING-PATCH POLICY (T-FIX-HOOK):
 * ALL edits to settings.local.json use string operations that preserve every byte
 * outside the insertion/removal span. JSON.parse+JSON.stringify is NEVER called
 * on the source. This guarantees byte-identity after install+uninstall regardless
 * of pre-existing whitespace style.
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
  setJsonObjectKey,
  removeJsonObjectKey,
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
 *
 * Claude Code's settings.local.json schema for hook events expects each
 * element of `hooks.<Event>` to be a MATCHER OBJECT with an INNER `hooks`
 * ARRAY of command descriptors:
 *
 *   {
 *     "matcher": "",                          // tool-name pattern; "" = all
 *     "hooks": [
 *       { "type": "command", "command": "…" } // the actual command
 *     ],
 *     "_logbookId": "lb-hook-…"               // our tracking id (extra field)
 *   }
 *
 * Before 2026-05-21 we wrote the inner command descriptor DIRECTLY into the
 * outer array, causing Claude Code to fail with
 *   `hooks: Expected array, but received undefined`
 * at session start (the inner `hooks` array was missing). Users had to
 * uninstall + reinstall to recover.
 *
 * `_logbookId` is kept at the OUTER level on purpose: uninstall's regex
 * locates the field, walks back to the nearest `{`, and removes the
 * enclosing object — we need that to be the WHOLE matcher entry (so the
 * inner `hooks` array goes with it), not just one nested command.
 */
function buildHookEntryJson(
  artifact: HookArtifact,
  logbookId: string
): string {
  const innerCommand: Record<string, unknown> = {
    type: "command",
    command: artifact.command,
  };
  // IMPORTANT: `_logbookId` is the FIRST key by design.
  //
  // `locateInstalledEntry` finds the id field via regex and then walks
  // backwards looking for the nearest `{`. If `_logbookId` came AFTER the
  // `hooks` array, the nearest `{` walking backwards would be the INNER
  // command object's brace (`{"type":"command",…}`), not the outer matcher
  // object — uninstall would then remove only the inner command and leave a
  // dangling matcher entry. Putting `_logbookId` immediately after the outer
  // `{` guarantees the walk-back lands on the correct enclosing object.
  //
  // `canonicalJson` sorts keys alphabetically before hashing, so the hash is
  // not affected by this insertion order.
  const obj: Record<string, unknown> = {
    _logbookId: logbookId,
    matcher: artifact.matcher ?? "",
    hooks: [innerCommand],
  };
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

    let working = source;
    let createdHooksStructure = false;
    let createdHookEvent: string | undefined;

    // Step 1: if the top-level "hooks" key is absent, inject it as an empty object.
    // Uses setJsonObjectKey with jsonPath="" (root) — pure string-patch, no re-serialize.
    const hooksKeyPresent = /"hooks"\s*:/.test(working);
    if (!hooksKeyPresent) {
      const r = setJsonObjectKey({
        source: working,
        jsonPath: "",
        key: "hooks",
        valueJson: "{}",
      });
      working = r.next;
      createdHooksStructure = true;
    }

    // Step 2: if the hooks.<Event> array is absent, inject it as an empty array.
    // Uses setJsonObjectKey with jsonPath="/hooks" — pure string-patch.
    const eventArrayPresent = new RegExp(`"${hookEvent}"\\s*:`).test(working);
    if (!eventArrayPresent) {
      const r = setJsonObjectKey({
        source: working,
        jsonPath: "/hooks",
        key: hookEvent,
        valueJson: "[]",
      });
      working = r.next;
      createdHookEvent = hookEvent;
    }

    // Step 3: insert the hook entry into the (now-guaranteed-present) array.
    // Uses insertIntoJsonArray — pure string-patch; preserves all bytes outside the span.
    const insertResult = insertIntoJsonArray({
      source: working,
      jsonPath: arrayJsonPath,
      entryJson,
    });
    const next = insertResult.next;
    const insertedPosition = insertResult.position;

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
        ...(createdHookEvent !== undefined ? { createdHookEvent } : {}),
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

    // Read the flags recorded during install that tell us what structures we created.
    // These drive the symmetric reversal: we only tear down what we built.
    const shouldRemoveHookEvent =
      entry.anchor.type === "json_field" &&
      "createdHookEvent" in entry.anchor &&
      typeof entry.anchor.createdHookEvent === "string";

    const shouldRemoveHooksKey =
      entry.anchor.type === "json_field" &&
      "createdHooksStructure" in entry.anchor &&
      entry.anchor.createdHooksStructure === true;

    // Step 1: remove our entry from hooks.<Event> array via string-patch.
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

    // Step 2: if we injected the event array key, remove it now via string-patch.
    // This is the inverse of setJsonObjectKey(source, "/hooks", hookEvent, "[]").
    if (shouldRemoveHookEvent) {
      const r = removeJsonObjectKey({
        source: next,
        jsonPath: "/hooks",
        key: hookEvent,
      });
      next = r.next;
    }

    // Step 3: if we injected the hooks key itself, remove it via string-patch.
    // This is the inverse of setJsonObjectKey(source, "", "hooks", "{}").
    if (shouldRemoveHooksKey) {
      const r = removeJsonObjectKey({
        source: next,
        jsonPath: "",
        key: "hooks",
      });
      next = r.next;
    }

    // Restore original line endings before writing (CRLF normalize — T3).
    await atomicWrite(targetPath, fromLF(next, targetEnding));
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

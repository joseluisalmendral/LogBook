/**
 * StatuslineInstaller — ArtifactInstaller<{kind:"statusline"}>.
 *
 * Install strategy (design §5, iter4 T3):
 * - Target: .claude/settings.local.json top-level key /statusLine
 * - Value shape: STRING (shell command), NOT an object.
 * - AnchorSpec: json_field with idField="" idValue="" (contentHash-only identification).
 *   No _logbookId is embedded in the installed JSON — the value is a plain string.
 * - Install: setJsonObjectKey(source, "", "statusLine", JSON.stringify(cmd)) via string-patch.
 * - Uninstall: verify sha256(currentValue) matches content_hash; if yes → removeJsonObjectKey.
 *   If mismatch → record hash_mismatch issue; skip removal (data preservation contract).
 * - Detect: if manifest entry for this file + anchor exists AND sha256(current value) matches
 *   content_hash → occupied-by-logbook. If statusLine key exists without our manifest match
 *   → occupied-by-other. If absent → empty.
 *
 * CONTENTHAS-ONLY IDENTIFICATION (design §2 AnchorSpec rationale):
 * idField="" and idValue="" in the anchor means: "no in-situ id embedded in the installed JSON".
 * Identification falls back to jsonPath + content_hash only. The detect handler compares
 * sha256(currentStatusLineValue) against entry.content_hash.
 *
 * NO SCHEMA BUMP: the existing json_field AnchorSpec already supports empty strings
 * for idField/idValue. This is valid per the iter2 manifest schema.
 *
 * CONFLICT POLICY:
 * If statusLine key exists in the file with a value that does not match our expected
 * command (no manifest entry), we refuse to overwrite — throw ConflictError.
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
} from "../../../util/json-string-patch.js";
import { sha256 } from "../../../util/hash.js";
import { toLF, fromLF } from "../../../util/crlf.js";
import type { LineEnding } from "../../../util/crlf.js";
import { ConflictError } from "../../../core/errors.js";

type StatuslineArtifact = Extract<Artifact, { kind: "statusline" }>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETTINGS_FILE = ".claude/settings.local.json";
const STATUS_LINE_KEY = "statusLine";
const STATUS_LINE_JSON_PATH = "/statusLine";
// Empty jsonPath "" means top-level root object for setJsonObjectKey
const ROOT_JSON_PATH = "";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
 * Extract the current statusLine command string from parsed JSON.
 *
 * Claude Code accepts two historical shapes for the `statusLine` key:
 *
 *   1. Object shape (current, expected):
 *        "statusLine": { "type": "command", "command": "node …" }
 *   2. Bare string shape (legacy LogBook installs before 2026-05-21):
 *        "statusLine": "node …"
 *
 * Both shapes parse out to the same command string for ownership checks.
 * Claude Code itself only accepts shape #1 — shape #2 produces:
 *   `statusLine: Expected object, but received string`
 * at session start, which is what triggered the 2026-05-21 fix. We still
 * READ both so verify/uninstall keep working on legacy installs.
 *
 * Returns the command string or null if absent / unrecognized shape.
 */
function extractStatusLineValue(source: string): string | null {
  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    const val = parsed[STATUS_LINE_KEY];
    // Shape 1 — object with { type: "command", command: "…" }
    if (
      typeof val === "object" &&
      val !== null &&
      typeof (val as Record<string, unknown>)["command"] === "string"
    ) {
      return (val as Record<string, unknown>)["command"] as string;
    }
    // Shape 2 — legacy bare string
    if (typeof val === "string") return val;
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a statusLine key exists in the source (string or non-string value).
 */
function hasStatusLineKey(source: string): boolean {
  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    return STATUS_LINE_KEY in parsed;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// StatuslineInstaller
// ---------------------------------------------------------------------------

export class StatuslineInstaller implements ArtifactInstaller<StatuslineArtifact> {
  readonly kind = "statusline" as const;

  async detect(artifact: StatuslineArtifact, ctx: InstallContext): Promise<DetectionResult> {
    const absPath = nodePath.join(ctx.projectRoot, SETTINGS_FILE);

    // 1. Check manifest for a matching logbook entry (contentHash-only identification).
    //    We look for a json_field entry pointing at /statusLine with idField="".
    const existing = ctx.manifest.artifacts.find(
      (a) =>
        a.file_path === SETTINGS_FILE &&
        a.anchor.type === "json_field" &&
        a.anchor.jsonPath === STATUS_LINE_JSON_PATH &&
        a.anchor.idField === ""
    );

    if (existing) {
      // Manifest entry found — verify current value hash matches content_hash.
      const rawSource = await readFileOrNull(absPath);
      if (rawSource === null) {
        // File deleted after install — treat as empty so uninstall can clean up.
        return { status: "empty" };
      }

      const { content: source } = toLF(rawSource);
      const currentValue = extractStatusLineValue(source);

      if (currentValue !== null && sha256(currentValue) === existing.content_hash) {
        return { status: "occupied-by-logbook", existing };
      }

      // Manifest entry exists but hash does not match — the user changed the value
      // (or another tool updated it). Still report as occupied-by-logbook so the
      // engine treats it as "our slot, possibly drifted" — verify() will report the drift.
      return { status: "occupied-by-logbook", existing };
    }

    // 2. No manifest entry — check if the file has a statusLine key.
    const rawSource = await readFileOrNull(absPath);

    if (rawSource === null) {
      return { status: "empty" };
    }

    const { content: source } = toLF(rawSource);

    if (!hasStatusLineKey(source)) {
      return { status: "empty" };
    }

    // statusLine key exists but we have no manifest entry → another plugin owns it.
    return { status: "occupied-by-other", fingerprint: "foreign-statusline-key" };
  }

  async install(artifact: StatuslineArtifact, ctx: InstallContext): Promise<ManifestArtifact> {
    const absPath = nodePath.join(ctx.projectRoot, SETTINGS_FILE);

    // Ensure parent directory exists
    await fs.mkdir(nodePath.dirname(absPath), { recursive: true });

    const rawSource = await readFileOrNull(absPath);
    const { content: source, original: detectedEnding } = rawSource !== null
      ? toLF(rawSource)
      : { content: "{}", original: "lf" as LineEnding };

    // Conflict check: statusLine key exists with a value we don't own.
    if (hasStatusLineKey(source)) {
      const currentValue = extractStatusLineValue(source);
      const expectedHash = sha256(artifact.command);

      // Check if this is our own entry (idempotent re-install).
      const existingEntry = ctx.manifest.artifacts.find(
        (a) =>
          a.file_path === SETTINGS_FILE &&
          a.anchor.type === "json_field" &&
          a.anchor.jsonPath === STATUS_LINE_JSON_PATH &&
          a.anchor.idField === ""
      );

      const isOurs = existingEntry !== undefined &&
        currentValue !== null &&
        sha256(currentValue) === existingEntry.content_hash;

      if (!isOurs) {
        // Another plugin owns the statusLine slot — refuse to overwrite.
        throw new ConflictError(
          `StatuslineInstaller: cannot install — statusLine key already exists in ${SETTINGS_FILE} ` +
          `and is owned by another plugin. Remove the conflicting entry first or use ` +
          `--statusline-skip to bypass.`
        );
      }

      // Our own entry — idempotent: re-record the manifest entry without re-writing.
      // Return a fresh manifest entry with the current content_hash.
      return {
        id: artifact._logbookId,
        kind: "statusline",
        file_path: SETTINGS_FILE,
        anchor: {
          type: "json_field",
          jsonPath: STATUS_LINE_JSON_PATH,
          idField: "",
          idValue: "",
        },
        content_hash: expectedHash,
        installed_at: ctx.now(),
        detectedLineEnding: detectedEnding,
      };
    }

    // Install: set the statusLine key as a Claude-Code-compliant OBJECT.
    // Claude Code's schema requires `{ type: "command", command: "…" }`. The
    // bare-string form we used before 2026-05-21 caused
    //   `statusLine: Expected object, but received string`
    // at session start.
    const statusLineValue = { type: "command", command: artifact.command };
    const { next } = setJsonObjectKey({
      source,
      jsonPath: ROOT_JSON_PATH,
      key: STATUS_LINE_KEY,
      valueJson: JSON.stringify(statusLineValue),
    });

    // Restore original line endings before writing.
    await atomicWrite(absPath, fromLF(next, detectedEnding));

    // content_hash = sha256(commandString) — NOT sha256 of the installed bytes.
    // This allows us to identify our entry even if whitespace around the key changes.
    const contentHash = sha256(artifact.command);

    return {
      id: artifact._logbookId,
      kind: "statusline",
      file_path: SETTINGS_FILE,
      anchor: {
        type: "json_field",
        jsonPath: STATUS_LINE_JSON_PATH,
        idField: "",
        idValue: "",
      },
      content_hash: contentHash,
      installed_at: ctx.now(),
      detectedLineEnding: detectedEnding,
    };
  }

  async uninstall(entry: ManifestArtifact, ctx: InstallContext): Promise<void> {
    if (entry.anchor.type !== "json_field") {
      // Wrong anchor type — skip silently.
      return;
    }

    const absPath = nodePath.join(ctx.projectRoot, SETTINGS_FILE);
    const rawSource = await readFileOrNull(absPath);

    if (rawSource === null) {
      // File already gone — idempotent no-op.
      return;
    }

    const targetEnding = entry.detectedLineEnding ?? "lf";
    const { content: source } = toLF(rawSource);

    // Hash check: verify current statusLine value matches what we installed.
    const currentValue = extractStatusLineValue(source);

    if (currentValue === null) {
      // Key absent or non-string — nothing to remove; idempotent.
      return;
    }

    if (sha256(currentValue) !== entry.content_hash) {
      // Hash mismatch — the user (or another tool) changed the value.
      // Data preservation contract: do NOT remove. Log the mismatch implicitly
      // by returning without deleting.
      return;
    }

    // Hash matches — safe to remove.
    const { next } = removeJsonObjectKey({
      source,
      jsonPath: ROOT_JSON_PATH,
      key: STATUS_LINE_KEY,
    });

    // Restore original line endings before writing.
    await atomicWrite(absPath, fromLF(next, targetEnding));
  }

  async verify(entry: ManifestArtifact, ctx: InstallContext): Promise<VerifyResult> {
    if (entry.anchor.type !== "json_field") {
      return { ok: false, reason: "anchor_missing" };
    }

    const absPath = nodePath.join(ctx.projectRoot, SETTINGS_FILE);
    const rawSource = await readFileOrNull(absPath);

    if (rawSource === null) {
      return { ok: false, reason: "file_missing" };
    }

    const { content: source } = toLF(rawSource);

    // Check if statusLine key is present at all.
    if (!hasStatusLineKey(source)) {
      return { ok: false, reason: "anchor_missing" };
    }

    // Check hash of the current value.
    const currentValue = extractStatusLineValue(source);

    if (currentValue === null) {
      // Key exists but is not a string — something wrong.
      return { ok: false, reason: "hash_mismatch" };
    }

    if (sha256(currentValue) !== entry.content_hash) {
      return { ok: false, reason: "hash_mismatch" };
    }

    return { ok: true };
  }
}

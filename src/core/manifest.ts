/**
 * Manifest CRUD — atomic writes, immutable mutators.
 *
 * Design choices:
 * - Writes use tmpfile + fsync + rename for atomicity. fsync ensures the
 *   written bytes reach disk before the rename is visible — critical for a
 *   manifest that tracks installed artifacts.
 * - All mutators (addArtifact, removeArtifactById, addBackup) return NEW
 *   objects and leave the input unchanged. The caller decides when to persist.
 * - readManifest returns null (not throws) for a missing file so callers can
 *   distinguish "never installed" from an actual error.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Manifest, ManifestArtifact, BackupRef } from "../types/manifest.js";
import { LogBookError } from "./errors.js";

export function emptyManifest(preset: Manifest["preset"]): Manifest {
  return {
    version: 1,
    installed_at: new Date().toISOString(),
    preset,
    artifacts: [],
    backups: [],
  };
}

/**
 * Read the manifest from disk.
 * - Returns null if the file does not exist.
 * - Throws LogBookError("MANIFEST_VERSION_UNSUPPORTED") if version !== 1.
 */
export function readManifest(manifestPath: string): Manifest | null {
  if (!fs.existsSync(manifestPath)) return null;

  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Manifest;

  if (parsed.version !== 1) {
    throw new LogBookError(
      "MANIFEST_VERSION_UNSUPPORTED",
      `Manifest at ${manifestPath} has unsupported version ${String(parsed.version)}. Expected 1.`
    );
  }

  return parsed;
}

/**
 * Write the manifest atomically: write to tmpfile, fsync fd, rename.
 * Creates parent directories if needed.
 */
export function writeManifest(manifestPath: string, manifest: Manifest): void {
  const dir = path.dirname(manifestPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${manifestPath}.tmp`;
  const content = JSON.stringify(manifest, null, 2) + "\n";
  fs.writeFileSync(tmp, content, "utf8");

  // fsync via open + fsync + close to ensure bytes reach disk before rename.
  const fd = fs.openSync(tmp, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmp, manifestPath);
}

/** Returns a new manifest with the artifact appended. */
export function addArtifact(manifest: Manifest, artifact: ManifestArtifact): Manifest {
  return {
    ...manifest,
    artifacts: [...manifest.artifacts, artifact],
  };
}

/** Returns a new manifest with the artifact removed (no-op if id not found). */
export function removeArtifactById(manifest: Manifest, id: string): Manifest {
  return {
    ...manifest,
    artifacts: manifest.artifacts.filter((a) => a.id !== id),
  };
}

/** Returns the artifact with the given id, or null if not found. */
export function findArtifactById(manifest: Manifest, id: string): ManifestArtifact | null {
  return manifest.artifacts.find((a) => a.id === id) ?? null;
}

/** Returns a new manifest with the backup appended. */
export function addBackup(manifest: Manifest, backup: BackupRef): Manifest {
  return {
    ...manifest,
    backups: [...manifest.backups, backup],
  };
}

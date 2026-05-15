/**
 * sha256-keyed idempotent backup utility.
 *
 * Algorithm:
 * 1. If source does not exist → return sentinel BackupRef (empty sha256 + backup_path).
 *    Uninstall interprets empty sha256 as "file did not exist before install — delete on uninstall".
 * 2. Compute sha256 of source content.
 * 3. Backup target = <backupsDir>/<sha256[0:16]>-<basename>.
 * 4. If target already exists with matching sha256 → idempotent no-op.
 * 5. If target exists with different sha256 → throw BackupMismatchError.
 * 6. Otherwise copy source to target.
 * 7. Return BackupRef with project-relative paths.
 *
 * I/O choices: synchronous throughout. Backup is a pre-write safety operation
 * that blocks the install step — sync keeps the logic straightforward and
 * there is no benefit to async here (we need the backup to complete before
 * continuing).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { BackupRef } from "../types/manifest.js";
import { BackupMismatchError } from "./errors.js";

export interface BackupContext {
  backupsDir: string;     // absolute path to .logbook/backups
  projectRoot: string;    // absolute project root (for relative path computation)
  now: () => string;      // injectable clock — returns RFC3339 UTC string
}

function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Idempotent backup of a single file.
 *
 * @param filePath  Absolute path to the file to back up.
 * @param ctx       Backup context (dirs, clock).
 * @returns         BackupRef describing the backup taken.
 */
export function backupOnce(filePath: string, ctx: BackupContext): BackupRef {
  const { backupsDir, projectRoot, now } = ctx;

  const relPath = path.relative(projectRoot, filePath);
  const taken_at = now();

  // Non-existent source → sentinel: install will delete this file on uninstall.
  if (!fs.existsSync(filePath)) {
    return { file_path: relPath, backup_path: "", sha256: "", taken_at };
  }

  const sha256 = sha256File(filePath);
  const basename = path.basename(filePath);
  const backupName = `${sha256.slice(0, 16)}-${basename}`;

  fs.mkdirSync(backupsDir, { recursive: true });
  const backupAbs = path.join(backupsDir, backupName);

  if (fs.existsSync(backupAbs)) {
    // Idempotency check: verify the existing backup has the same content.
    const existingSha = sha256File(backupAbs);
    if (existingSha !== sha256) {
      throw new BackupMismatchError(
        `Backup collision: ${backupName} already exists but has sha256 ${existingSha} (expected ${sha256})`
      );
    }
    // Matching backup already exists — no-op.
  } else {
    fs.copyFileSync(filePath, backupAbs);
  }

  const relBackupPath = path.relative(projectRoot, backupAbs);
  return { file_path: relPath, backup_path: relBackupPath, sha256, taken_at };
}

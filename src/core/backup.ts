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

/**
 * Restore a single file from its `BackupRef`.
 *
 * Behaviour:
 *   - `sha256 === ""` → sentinel: the file did not exist before install.
 *     If the file is on disk now, delete it. Otherwise no-op.
 *   - Otherwise → copy the backup file back over the target via a tmp+rename
 *     so the restore is atomic. After restore, verify the on-disk sha256
 *     matches the stored one; if not, throw — something tampered with the
 *     backup.
 *
 * Used by `runInstall`'s rollback path when an installer throws after some
 * shared files have already been mutated. Anchor-based `installer.uninstall`
 * cannot guarantee byte-identity in that situation (the install may have
 * written a malformed intermediate state) — restoring the original backup
 * IS guaranteed to be byte-identical, which is what the §24.8 / §37 spec
 * actually promises.
 *
 * Errors are returned by throwing — the caller is responsible for collecting
 * and aggregating them so other restores still execute.
 *
 * @param backup        The BackupRef captured at install time.
 * @param projectRoot   Absolute project root (BackupRef paths are relative).
 */
export function restoreFromBackup(
  backup: BackupRef,
  projectRoot: string,
): void {
  const targetAbs = path.resolve(projectRoot, backup.file_path);

  // Sentinel: pre-install the file did not exist. Restore = make it not exist.
  if (backup.sha256 === "") {
    if (fs.existsSync(targetAbs)) {
      fs.rmSync(targetAbs, { force: true });
    }
    return;
  }

  const backupAbs = path.resolve(projectRoot, backup.backup_path);
  if (!fs.existsSync(backupAbs)) {
    throw new Error(
      `restoreFromBackup: backup file is missing on disk: ${backup.backup_path}. ` +
        `Cannot restore ${backup.file_path} to its pre-install state.`,
    );
  }

  // Atomic restore: write to tmp + rename, so a crash mid-copy never leaves
  // the target half-written.
  const tmpPath = `${targetAbs}.lb-restore.tmp`;
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  fs.copyFileSync(backupAbs, tmpPath);
  fs.renameSync(tmpPath, targetAbs);

  // Post-condition: verify the restored bytes match the stored sha256.
  const restoredSha = sha256File(targetAbs);
  if (restoredSha !== backup.sha256) {
    throw new Error(
      `restoreFromBackup: post-restore sha256 mismatch for ${backup.file_path}. ` +
        `Expected ${backup.sha256}, got ${restoredSha}. ` +
        `The backup file may have been tampered with.`,
    );
  }
}

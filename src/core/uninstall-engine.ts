/**
 * Uninstall engine — reverse-iterate the manifest and call each installer's
 * uninstall() method. Produces a report of removed / skipped entries.
 *
 * Algorithm (design §6 uninstall variant):
 * 1. Read manifest. If missing → return empty result.
 * 2. Iterate manifest.artifacts in REVERSE order.
 * 3. For each entry, look up its installer. If unknown kind → record as issue.
 * 4. Call installer.verify(). If hash_mismatch → record as issue, skip uninstall.
 *    If anchor_missing or file_missing → record as issue, but still remove from manifest.
 * 5. Call installer.uninstall() for entries that pass verification.
 * 6. After all entries processed, write the updated manifest (may be empty of artifacts).
 *    The CLI decides whether to delete the manifest file afterward.
 * 7. Return final manifest state and issue list.
 */

import * as path from "node:path";
import type { ProjectPaths } from "./paths.js";
import type { ManifestArtifact, Manifest } from "../types/manifest.js";
import { readManifest, writeManifest, removeArtifactById } from "./manifest.js";
import { getInstaller } from "../connectors/claude-code/artifacts/registry.js";
import { generateUlid } from "../util/ulid.js";
import { DryRunContext } from "./dryrun.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunUninstallInput {
  paths: ProjectPaths;
  dryRun: boolean;
  onReport?: (rows: UninstallReportRow[]) => void;
  now?: () => string;
  ulid?: () => string;
}

export interface UninstallReportRow {
  id: string;
  kind: string;
  filePath: string;
  status: "removed" | "anchor-missing" | "hash-mismatch" | "file-missing" | "skipped-dry-run" | "unknown-kind";
  note?: string;
}

export interface RunUninstallResult {
  removed: string[];
  issues: UninstallReportRow[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runUninstall(input: RunUninstallInput): Promise<RunUninstallResult> {
  const { paths, dryRun } = input;
  const now = input.now ?? (() => new Date().toISOString());
  const ulid = input.ulid ?? generateUlid;

  // step 1: Read manifest. If missing → return empty result.
  let manifest: Manifest | null = readManifest(paths.manifestPath);
  if (manifest === null) {
    return { removed: [], issues: [] };
  }

  const removed: string[] = [];
  const issues: UninstallReportRow[] = [];
  const reportRows: UninstallReportRow[] = [];

  const dryRunCtx = dryRun ? new DryRunContext() : undefined;

  // Build install context for uninstall calls (installers may need paths etc.)
  const installCtx = {
    projectRoot: paths.root,
    preset: manifest.preset,
    manifest,
    backups: new Map(),
    dryRun,
    dryRunContext: dryRunCtx,
    now,
    ulid,
    paths,
  };

  // step 2: Iterate in REVERSE order.
  const reversedArtifacts = [...manifest.artifacts].reverse();

  for (const entry of reversedArtifacts) {
    // step 3: Look up installer.
    let installer: ReturnType<typeof getInstaller> | null = null;
    try {
      installer = getInstaller(entry.kind);
    } catch {
      // Unknown kind — likely a manifest from a future version.
      const row: UninstallReportRow = {
        id: entry.id,
        kind: entry.kind,
        filePath: entry.file_path,
        status: "unknown-kind",
        note: `No installer registered for kind '${entry.kind}'. Skipping.`,
      };
      issues.push(row);
      reportRows.push(row);
      continue;
    }

    if (dryRun) {
      const row: UninstallReportRow = {
        id: entry.id,
        kind: entry.kind,
        filePath: entry.file_path,
        status: "skipped-dry-run",
      };
      reportRows.push(row);
      continue;
    }

    // step 4: Call installer.verify().
    const verifyResult = await installer.verify(entry, installCtx);

    if (!verifyResult.ok) {
      const status = mapVerifyReason(verifyResult.reason);

      if (verifyResult.reason === "hash_mismatch") {
        // hash_mismatch → do NOT uninstall; preserve the entry in the manifest.
        const row: UninstallReportRow = {
          id: entry.id,
          kind: entry.kind,
          filePath: entry.file_path,
          status,
          note: "Content has been manually edited. Skipping uninstall to avoid data loss.",
        };
        issues.push(row);
        reportRows.push(row);
        continue;
      }

      // anchor_missing or file_missing → record as issue but still remove from manifest.
      const row: UninstallReportRow = {
        id: entry.id,
        kind: entry.kind,
        filePath: entry.file_path,
        status,
        note: "Artifact is gone from disk; removing manifest entry.",
      };
      issues.push(row);
      reportRows.push(row);
      manifest = removeArtifactById(manifest, entry.id);
      removed.push(entry.id);
      continue;
    }

    // step 5: Call installer.uninstall().
    await installer.uninstall(entry, installCtx);
    manifest = removeArtifactById(manifest, entry.id);
    removed.push(entry.id);

    reportRows.push({
      id: entry.id,
      kind: entry.kind,
      filePath: entry.file_path,
      status: "removed",
    });
  }

  // Deliver report.
  input.onReport?.(reportRows);

  // step 6: Write updated manifest (may be empty of artifacts).
  // The caller (CLI) decides whether to delete the file when artifacts is empty.
  if (!dryRun) {
    writeManifest(paths.manifestPath, manifest);
  }

  return { removed, issues };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapVerifyReason(
  reason: "anchor_missing" | "hash_mismatch" | "file_missing" | undefined
): UninstallReportRow["status"] {
  switch (reason) {
    case "anchor_missing":
      return "anchor-missing";
    case "hash_mismatch":
      return "hash-mismatch";
    case "file_missing":
      return "file-missing";
    default:
      return "anchor-missing";
  }
}

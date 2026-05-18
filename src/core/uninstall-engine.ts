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

import * as fs from "node:fs";
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
  /**
   * When true, override the hash-mismatch safety guard: the engine will still
   * call `installer.uninstall()` for entries whose content has drifted since
   * install. Each installer's `uninstall()` is anchor-based (block markers,
   * line patterns, JSON keys by lb-* id) so removing a drifted entry is safe
   * — but content the user added INSIDE a logbook block will be deleted along
   * with the block. Set this from `--force` only.
   *
   * Default: false (drift-protected behaviour — preserve entries when hash
   * mismatches, surface as an "issue" in the report).
   */
  force?: boolean;
  onReport?: (rows: UninstallReportRow[]) => void;
  now?: () => string;
  ulid?: () => string;
}

export interface UninstallReportRow {
  id: string;
  kind: string;
  filePath: string;
  status:
    | "removed"
    | "removed-forced"
    | "anchor-missing"
    | "hash-mismatch"
    | "file-missing"
    | "skipped-dry-run"
    | "unknown-kind";
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
  const force = input.force ?? false;
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
        if (!force) {
          // hash_mismatch without --force → preserve the entry in the manifest.
          const row: UninstallReportRow = {
            id: entry.id,
            kind: entry.kind,
            filePath: entry.file_path,
            status,
            note: "Content has been manually edited. Skipping uninstall to avoid data loss. Re-run with --force to override.",
          };
          issues.push(row);
          reportRows.push(row);
          continue;
        }

        // hash_mismatch with --force → uninstall anyway. Each installer's
        // uninstall() locates the artifact via anchors (block markers, line
        // patterns, JSON keys by lb-* id) so the removal is safe even when
        // content has drifted. The user has explicitly opted in via --force.
        await installer.uninstall(entry, installCtx);
        manifest = removeArtifactById(manifest, entry.id);
        removed.push(entry.id);

        const row: UninstallReportRow = {
          id: entry.id,
          kind: entry.kind,
          filePath: entry.file_path,
          status: "removed-forced",
          note: "Content had drifted from install-time hash; removed because --force was passed.",
        };
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
  if (!dryRun) {
    writeManifest(paths.manifestPath, manifest);
  }

  // step 7: Sentinel-backup cleanup + manifest deletion.
  //
  // Previously this lived in src/cli/commands/uninstall.ts and src/cli/commands/purge.ts —
  // which meant the TUI (src/tui/persist.ts) and any other programmatic caller of
  // runUninstall() got partial uninstall: artifact bodies removed, but the shared
  // FILES that LogBook created (e.g. .gitignore, .claude/settings.local.json) were
  // left on disk as empty husks (`""`, `"{}"`), and the manifest stayed around.
  // User report 2026-05-18: "hice uninstall y los archivos siguen con lo que
  // logbook les añadió".
  //
  // Pulling the cleanup INTO the engine guarantees every caller gets it. The CLI
  // wrappers no longer need their own copy of this logic.
  //
  // Safety rule (stricter than the old CLI behavior, which deleted unconditionally):
  // only delete a sentinel-backed file if its post-uninstall content is "empty"
  // — i.e. whitespace-only OR an empty JSON container (`{}` / `[]`). If the user
  // (or another tool) added content to the file we created, we leave the file
  // alone. Losing user content is worse than leaving an empty husk.
  if (!dryRun && manifest.artifacts.length === 0) {
    cleanupSentinelFiles(paths.root, manifest.backups);
    deleteManifestIfEmpty(paths.manifestPath);
  }

  return { removed, issues };
}

// ---------------------------------------------------------------------------
// Post-uninstall cleanup helpers
// ---------------------------------------------------------------------------

/**
 * Decide whether the post-uninstall content of a shared file looks "empty enough"
 * to safely delete. Strict: only deletes when LogBook is the only thing that ever
 * touched the file.
 *
 *   - "" / whitespace → empty (gitignore that we created, etc.)
 *   - "{}" / "[]" (with arbitrary whitespace) → empty JSON container
 *   - anything else → preserve (assume user content)
 */
function looksEmpty(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed === "") return true;
  if (trimmed === "{}" || trimmed === "[]") return true;
  // Try a JSON parse — handles things like '  {  }  \n'.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null) return true;
    if (typeof parsed === "object" && Object.keys(parsed as object).length === 0) {
      return true;
    }
  } catch {
    // Not JSON. Already covered the whitespace case above.
  }
  return false;
}

function cleanupSentinelFiles(
  projectRoot: string,
  backups: ReadonlyArray<{ file_path: string; sha256: string }>,
): void {
  for (const backup of backups) {
    if (backup.sha256 !== "") continue; // Not a sentinel — leave alone.
    const absPath = path.join(projectRoot, backup.file_path);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Already gone — idempotent.
        continue;
      }
      // Best-effort cleanup — don't fail the whole uninstall.
      continue;
    }
    if (!looksEmpty(content)) continue;
    try {
      fs.rmSync(absPath, { force: true });
    } catch {
      // Best-effort.
    }
  }
}

function deleteManifestIfEmpty(manifestPath: string): void {
  // We just wrote an empty-artifacts manifest at step 6. If the file now reflects
  // that empty state, remove the file so the project is byte-identical to a
  // never-installed project.
  try {
    const m = readManifest(manifestPath);
    if (m !== null && m.artifacts.length === 0) {
      fs.rmSync(manifestPath, { force: true });
    }
  } catch {
    // Best-effort.
  }
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

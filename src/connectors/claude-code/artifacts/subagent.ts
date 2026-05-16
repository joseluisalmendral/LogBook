/**
 * SubagentInstaller — ArtifactInstaller<{kind:"subagent"}>.
 *
 * Install strategy (design §4, iter4 T2):
 * - Target: .claude/subagents/<name>.md (SUBAGENT_DIR const in src/core/paths.ts)
 * - Anchor: owned_file with expected_sha256 = sha256(body)
 * - Install: write file atomically (temp+rename); record expected_sha256 and any parent dirs created.
 * - Uninstall: delete file IF sha256(current) === expected_sha256; else skip (hash_mismatch, user edited).
 *   After deletion, remove created parent dirs in reverse order if empty.
 *
 * REUSES SkillInstaller pattern verbatim (iter3 T2):
 * - owned_file anchor, sha256 check, parent dir creation/cleanup.
 * - One manifest entry per subagent file (logbook-curator.md, logbook-teacher.md = 2 entries total).
 *
 * PARENT DIR TRACKING:
 * Each call to install() independently checks which dirs need to be created.
 * If curator is installed first, it creates (and records) .claude/subagents/.
 * If teacher is then installed, .claude/subagents/ already exists → records createdParentDirs=[].
 * On uninstall in reverse: teacher entry has createdParentDirs=[] → skips cleanup;
 * curator entry has the dir recorded → cleans iff empty.
 *
 * CONFLICT POLICY:
 * If a file at the target path exists with different content and no manifest entry → ConflictError.
 *
 * UNINSTALL HASH-MISMATCH POLICY:
 * If the file's current sha256 differs from expected_sha256, the user (or another tool)
 * modified the file. We do NOT delete it — data preservation contract.
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
import { sha256 } from "../../../util/hash.js";
import { ConflictError } from "../../../core/errors.js";

type SubagentArtifact = Extract<Artifact, { kind: "subagent" }>;

// ---------------------------------------------------------------------------
// Utilities (mirrors SkillInstaller — kept local for isolation)
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

/** Check if a directory exists. */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** Check if a directory is empty (no entries). */
async function isDirEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

/**
 * Determine which ancestor directories of targetPath (up to and NOT including projectRoot)
 * need to be created. Returns them in order from shallowest to deepest (creation order).
 *
 * We record only dirs that do not already exist so that on uninstall we only remove
 * what we created. The returned paths are project-relative.
 */
async function computeDirsToCreate(
  targetPath: string,
  projectRoot: string
): Promise<string[]> {
  const dirs: string[] = [];
  let current = nodePath.dirname(targetPath);

  while (current !== projectRoot && current.startsWith(projectRoot + nodePath.sep)) {
    if (await dirExists(current)) {
      break; // This dir exists — all ancestors also exist; stop.
    }
    const rel = nodePath.relative(projectRoot, current);
    dirs.unshift(rel); // shallowest first
    current = nodePath.dirname(current);
  }

  return dirs;
}

// ---------------------------------------------------------------------------
// SubagentInstaller
// ---------------------------------------------------------------------------

export class SubagentInstaller implements ArtifactInstaller<SubagentArtifact> {
  readonly kind = "subagent" as const;

  async detect(artifact: SubagentArtifact, ctx: InstallContext): Promise<DetectionResult> {
    const filePath = artifact.file_path;

    // 1. Check manifest for an existing logbook entry for this file path + id.
    const existing = ctx.manifest.artifacts.find(
      (a) =>
        a.file_path === filePath &&
        a.anchor.type === "owned_file" &&
        a.id === artifact._logbookId
    );
    if (existing) {
      return { status: "occupied-by-logbook", existing };
    }

    // 2. Check if file exists on disk.
    const absPath = nodePath.join(ctx.projectRoot, filePath);
    const currentContent = await readFileOrNull(absPath);

    if (currentContent === null) {
      return { status: "empty" };
    }

    // File exists but no manifest entry → report as occupied-by-other.
    return { status: "occupied-by-other", fingerprint: "unknown-subagent-file" };
  }

  async install(artifact: SubagentArtifact, ctx: InstallContext): Promise<ManifestArtifact> {
    const filePath = artifact.file_path;
    const absPath = nodePath.join(ctx.projectRoot, filePath);

    // Defensive conflict check: if a file with different content already exists, abort.
    const existingContent = await readFileOrNull(absPath);
    if (existingContent !== null) {
      const existingHash = sha256(existingContent);
      const bodyHash = sha256(artifact.body);
      if (existingHash !== bodyHash) {
        throw new ConflictError(
          `SubagentInstaller: cannot install ${filePath} — file already exists with different content. ` +
            `Remove the conflicting file first or use --subagent-prefix to avoid the collision.`
        );
      }
      // Same content already there — idempotent: just record the manifest entry.
    }

    // Determine which parent dirs we need to create (project-relative, for uninstall cleanup).
    const parentDirsCreated = await computeDirsToCreate(absPath, ctx.projectRoot);

    // Create parent dirs if needed.
    await fs.mkdir(nodePath.dirname(absPath), { recursive: true });

    // Write atomically.
    await atomicWrite(absPath, artifact.body);

    // Compute hash over the written bytes.
    const expectedSha256 = sha256(artifact.body);

    return {
      id: artifact._logbookId,
      kind: "subagent",
      file_path: filePath,
      anchor: {
        type: "owned_file",
        expected_sha256: expectedSha256,
      },
      content_hash: expectedSha256,
      installed_at: ctx.now(),
      createdParentDirs: parentDirsCreated,
    };
  }

  async uninstall(entry: ManifestArtifact, ctx: InstallContext): Promise<void> {
    if (entry.anchor.type !== "owned_file") {
      throw new Error(
        `SubagentInstaller.uninstall: expected owned_file anchor, got ${entry.anchor.type}`
      );
    }

    const absPath = nodePath.join(ctx.projectRoot, entry.file_path);

    // File may have been manually deleted — idempotent no-op if absent.
    const currentContent = await readFileOrNull(absPath);
    if (currentContent === null) {
      await this._cleanupParentDirs(entry, ctx);
      return;
    }

    // Hash check: refuse to delete if user modified the file.
    const currentHash = sha256(currentContent);
    if (currentHash !== entry.anchor.expected_sha256) {
      // Hash mismatch — data preservation contract — do NOT delete.
      return;
    }

    // Hash matches — safe to delete.
    await fs.unlink(absPath);

    // Clean up empty parent dirs we created.
    await this._cleanupParentDirs(entry, ctx);
  }

  async verify(entry: ManifestArtifact, ctx: InstallContext): Promise<VerifyResult> {
    if (entry.anchor.type !== "owned_file") {
      return { ok: false, reason: "anchor_missing" };
    }

    const absPath = nodePath.join(ctx.projectRoot, entry.file_path);
    const currentContent = await readFileOrNull(absPath);

    if (currentContent === null) {
      return { ok: false, reason: "file_missing" };
    }

    const currentHash = sha256(currentContent);
    if (currentHash !== entry.anchor.expected_sha256) {
      return { ok: false, reason: "hash_mismatch" };
    }

    return { ok: true };
  }

  /**
   * Remove parent dirs we created, in REVERSE order (deepest first).
   * Only removes a dir if it is EMPTY. Stops at the first non-empty dir.
   */
  private async _cleanupParentDirs(entry: ManifestArtifact, ctx: InstallContext): Promise<void> {
    const dirs = entry.createdParentDirs ?? [];

    // Reverse: deepest first (dirs are stored shallowest→deepest).
    for (const relDir of [...dirs].reverse()) {
      const absDir = nodePath.join(ctx.projectRoot, relDir);
      if (await isDirEmpty(absDir)) {
        try {
          await fs.rmdir(absDir);
        } catch {
          // Race condition or already gone — ignore.
          break;
        }
      } else {
        // Non-empty — stop walking up.
        break;
      }
    }
  }
}

/**
 * SlashCommandInstaller — ArtifactInstaller<{kind:"slash_command"}> for .claude/commands/<name>.md.
 *
 * Install strategy (design §5, T6):
 * - Target: .claude/commands/<name>.md (one file per slash command)
 * - Anchor: owned_file with expected_sha256 = sha256(body)
 * - Install: write file atomically (temp+rename); record expected_sha256 and any parent dirs created.
 * - Uninstall: delete file IF sha256(current) === expected_sha256; else skip (hash_mismatch, user edited).
 *   After deletion, remove created parent dirs in reverse order if empty.
 *
 * OWNED-FILE SEMANTICS:
 * The entire file IS the artifact. No byte-identity concerns with surrounding content —
 * we own 100% of the bytes between creation and deletion.
 *
 * CONFLICT POLICY:
 * If a file already exists at the target path AND is not in our manifest, install() throws
 * ConflictError (the engine should call detect() first; this is a defensive guard).
 *
 * UNINSTALL HASH-MISMATCH POLICY:
 * If the file's current sha256 differs from expected_sha256, the user (or another tool)
 * modified the file after we installed it. We record this by silently returning (the engine
 * is expected to receive a hash_mismatch issue from verify() if needed). We do NOT delete
 * the file. This preserves user modifications — consistent with iter1's "data preservation" contract.
 *
 * PARENT DIR CLEANUP:
 * We track which parent dirs we created in createdParentDirs[]. On uninstall, we iterate
 * in REVERSE (deepest first). For each dir: if empty → remove; if not empty → stop.
 * This restores byte-identity when .claude/commands/ was absent before install.
 *
 * CONTENT HASH POLICY:
 * content_hash === expected_sha256 === sha256(body). The owned_file anchor has no
 * normalization layer — the hash is over the literal bytes written.
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

type SlashCommandArtifact = Extract<Artifact, { kind: "slash_command" }>;

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
 * Check if a directory exists.
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a directory is empty (no entries).
 */
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
  // Walk from the parent of the target file up to (but not including) projectRoot.
  const dirs: string[] = [];
  let current = nodePath.dirname(targetPath);

  while (current !== projectRoot && current.startsWith(projectRoot + nodePath.sep)) {
    if (await dirExists(current)) {
      break; // This dir exists — all ancestors also exist; stop.
    }
    // Project-relative path for manifest recording.
    const rel = nodePath.relative(projectRoot, current);
    dirs.unshift(rel); // shallowest first
    current = nodePath.dirname(current);
  }

  return dirs;
}

// ---------------------------------------------------------------------------
// SlashCommandInstaller
// ---------------------------------------------------------------------------

export class SlashCommandInstaller implements ArtifactInstaller<SlashCommandArtifact> {
  readonly kind = "slash_command" as const;

  async detect(artifact: SlashCommandArtifact, ctx: InstallContext): Promise<DetectionResult> {
    const filePath = artifact.file_path;

    // 1. Check manifest for an existing logbook entry for this file path.
    //    For owned_file, matching on file_path is sufficient — we own the whole file.
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
      // File absent → empty slot.
      return { status: "empty" };
    }

    // File exists. Check if its sha256 matches what we would install (same body).
    // If so, it's OUR file (perhaps a remnant from a partial install with no manifest entry).
    // We report occupied-by-other regardless — without a manifest entry, we cannot safely claim it.
    // This matches the orphan-detection pattern from ClaudeMdAugmentInstaller.
    const currentHash = sha256(currentContent);
    const expectedHash = sha256(artifact.body);

    if (currentHash === expectedHash) {
      // Same content but no manifest entry → treat as occupied-by-other (orphan).
      return { status: "occupied-by-other", fingerprint: "orphan-slash-file" };
    }

    // Different content and no manifest entry → another tool or user wrote this file.
    return { status: "occupied-by-other", fingerprint: "unknown-slash-file" };
  }

  async install(artifact: SlashCommandArtifact, ctx: InstallContext): Promise<ManifestArtifact> {
    const filePath = artifact.file_path;
    // Resolve absolute path. We use nodePath.join (same as other installers) because
    // assertWithinProject uses realpathSync which fails on macOS /var→/private/var symlinks
    // when the target file does not yet exist. Path safety is ensured by the install-engine
    // calling detect() first and by the relative-path convention for artifact.file_path.
    const absPath = nodePath.join(ctx.projectRoot, filePath);

    // Defensive conflict check: if a file with different content already exists, abort.
    const existingContent = await readFileOrNull(absPath);
    if (existingContent !== null) {
      const existingHash = sha256(existingContent);
      const bodyHash = sha256(artifact.body);
      if (existingHash !== bodyHash) {
        throw new ConflictError(
          `SlashCommandInstaller: cannot install ${filePath} — file already exists with different content. ` +
            `Remove the conflicting file first or use --cmd-prefix to avoid the collision.`
        );
      }
      // Same content already there — idempotent install: just record the manifest entry.
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
      kind: "slash_command",
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

  async uninstall(entry: ManifestArtifact, _ctx: InstallContext): Promise<void> {
    if (entry.anchor.type !== "owned_file") {
      throw new Error(
        `SlashCommandInstaller.uninstall: expected owned_file anchor, got ${entry.anchor.type}`
      );
    }

    const absPath = nodePath.join(_ctx.projectRoot, entry.file_path);

    // File may have been manually deleted — idempotent no-op if absent.
    const currentContent = await readFileOrNull(absPath);
    if (currentContent === null) {
      // Already gone — still clean up parent dirs if we created them.
      await this._cleanupParentDirs(entry, _ctx);
      return;
    }

    // Hash check: refuse to delete if user modified the file.
    const currentHash = sha256(currentContent);
    if (currentHash !== entry.anchor.expected_sha256) {
      // Hash mismatch — user or another tool modified the file post-install.
      // Do NOT delete. The engine handles the issue via verify() reporting.
      return;
    }

    // Hash matches — safe to delete.
    await fs.unlink(absPath);

    // Clean up empty parent dirs we created.
    await this._cleanupParentDirs(entry, _ctx);
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

/**
 * GitignoreInstaller — ArtifactInstaller<{kind:"gitignore_entry"}> for .gitignore.
 *
 * Install strategy (design §5):
 * - Target: .gitignore (project-relative path from artifact.file_path)
 * - Anchor: line_set
 * - Install: appendLines() from src/util/line-set.ts
 * - Uninstall: removeLines() with recorded addedLeadingNewline + trailingNewlineAdded flags
 *
 * The flags are persisted in the AnchorSpec.line_set variant (S7 retro-touch to
 * src/types/manifest.ts) for symmetric uninstall.
 *
 * CRLF limitation: appendLines uses LF for joined content. Appending into a CRLF
 * file produces mixed newlines (documented in line-set.ts). The roundtrip still
 * works because removeLines uses the recorded flags to undo exactly what was done.
 *
 * CONTENT HASH POLICY:
 * sha256(lines.join("\n")) — the hash covers the raw lines text, not the
 * appended bytes (which include separator newlines added by appendLines).
 * Verify() recomputes the same hash from the anchor's lines field.
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
  appendLines,
  removeLines,
  AnchorNotFoundError,
} from "../../../util/line-set.js";
import { sha256 } from "../../../util/hash.js";

type GitignoreArtifact = Extract<Artifact, { kind: "gitignore_entry" }>;

/**
 * Resolve the .gitignore absolute path from the artifact + context.
 * artifact.file_path is project-relative (e.g. ".gitignore").
 */
function resolveTargetPath(artifact: GitignoreArtifact, ctx: InstallContext): string {
  return nodePath.join(ctx.projectRoot, artifact.file_path);
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
 * Read file as UTF-8. Returns empty string if absent (absent .gitignore = empty).
 */
async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
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

/**
 * Check if all lines are present as a contiguous block in source.
 */
function hasContiguousBlock(source: string, lines: string[]): boolean {
  const block = lines.join("\n");
  return source.includes(block);
}

// ---------------------------------------------------------------------------
// GitignoreInstaller
// ---------------------------------------------------------------------------

export class GitignoreInstaller
  implements ArtifactInstaller<GitignoreArtifact>
{
  readonly kind = "gitignore_entry" as const;

  async detect(
    artifact: GitignoreArtifact,
    ctx: InstallContext
  ): Promise<DetectionResult> {
    const targetPath = resolveTargetPath(artifact, ctx);
    const source = await readFileOrNull(targetPath);

    if (source !== null && hasContiguousBlock(source, artifact.lines)) {
      // Lines are present — check if they belong to us (manifest entry exists)
      const existing = ctx.manifest.artifacts.find(
        (a) =>
          a.file_path === artifact.file_path &&
          a.kind === "gitignore_entry" &&
          a.anchor.type === "line_set"
      );
      if (existing) {
        return { status: "occupied-by-logbook", existing };
      }
      // Lines present but not in manifest — another tool added the same lines.
      // We coexist by NOT inserting again and recording as occupied-by-other.
      return {
        status: "occupied-by-other",
        fingerprint: `Lines already present in ${artifact.file_path} without logbook manifest entry`,
      };
    }

    return { status: "empty" };
  }

  async install(
    artifact: GitignoreArtifact,
    ctx: InstallContext
  ): Promise<ManifestArtifact> {
    const targetPath = resolveTargetPath(artifact, ctx);
    const source = await readFileOrEmpty(targetPath);
    const { lines } = artifact;

    const { next, addedLeadingNewline, trailingNewlineAdded } = appendLines({
      source,
      lines,
    });

    await atomicWrite(targetPath, next);

    const contentHash = sha256(lines.join("\n"));

    return {
      id: artifact.lines[artifact.lines.length - 1]?.replace(/^#\s*/, "") ??
        "lb-gitignore-001",
      kind: "gitignore_entry",
      file_path: artifact.file_path,
      anchor: {
        type: "line_set",
        lines,
        addedLeadingNewline,
        trailingNewlineAdded,
      },
      content_hash: contentHash,
      installed_at: ctx.now(),
    };
  }

  async uninstall(
    entry: ManifestArtifact,
    ctx: InstallContext
  ): Promise<void> {
    if (entry.anchor.type !== "line_set") {
      // Idempotent: wrong anchor type means we can't remove — do nothing.
      return;
    }

    const targetPath = nodePath.join(ctx.projectRoot, entry.file_path);
    const source = await readFileOrNull(targetPath);

    if (source === null) {
      // File missing — nothing to remove; idempotent.
      return;
    }

    let next: string;
    try {
      next = removeLines({
        source,
        lines: entry.anchor.lines,
        ...(entry.anchor.addedLeadingNewline !== undefined
          ? { addedLeadingNewline: entry.anchor.addedLeadingNewline }
          : {}),
        ...(entry.anchor.trailingNewlineAdded !== undefined
          ? { trailingNewlineAdded: entry.anchor.trailingNewlineAdded }
          : {}),
      });
    } catch (err) {
      if (err instanceof AnchorNotFoundError) {
        // Already removed — idempotent.
        return;
      }
      throw err;
    }

    await atomicWrite(targetPath, next);
  }

  async verify(
    entry: ManifestArtifact,
    ctx: InstallContext
  ): Promise<VerifyResult> {
    if (entry.anchor.type !== "line_set") {
      return { ok: false, reason: "anchor_missing" };
    }

    const targetPath = nodePath.join(ctx.projectRoot, entry.file_path);
    const source = await readFileOrNull(targetPath);

    if (source === null) {
      return { ok: false, reason: "file_missing" };
    }

    const { lines } = entry.anchor;

    if (!hasContiguousBlock(source, lines)) {
      return { ok: false, reason: "anchor_missing" };
    }

    // Recompute hash over the same formula used at install time.
    const recomputedHash = sha256(lines.join("\n"));
    if (recomputedHash !== entry.content_hash) {
      return { ok: false, reason: "hash_mismatch" };
    }

    return { ok: true };
  }
}

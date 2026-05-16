/**
 * ClaudeMdAugmentInstaller — ArtifactInstaller<{kind:"augment_claudemd"}> for CLAUDE.md.
 *
 * Install strategy (design §5, T5):
 * - Target: CLAUDE.md (configurable via artifact.file_path; default "CLAUDE.md")
 * - Anchor: markdown_block with markers from iter1's upsertMarkdownBlock primitive.
 * - Install: upsertMarkdownBlock(content, body, {markerVersion: 1}) — inserts or replaces.
 * - Uninstall: removeMarkdownBlock(content, {markerVersion: 1, addedLeadingNewline}) — removes block.
 *
 * AUGMENT BLOCK BODY:
 * The body is bundled in assets/claudemd/augment.md (≤60 tokens by the chars/4 heuristic —
 * verified in tests/unit/claudemd-installer.test.ts token budget test). The body is passed
 * in via artifact.block_content so the installer is not hard-wired to the asset path.
 *
 * CONTENT HASH POLICY:
 * content_hash is sha256 of the full block span:
 *   startMarker + "\n" + body + "\n" + endMarker
 * This matches the bytes that upsertMarkdownBlock writes inside the markers (excluding the
 * outer trailing "\n" that the primitive appends in appended mode). The verify() path
 * re-locates the block by regex and hashes the matched span.
 *
 * CREATED-FILE POLICY:
 * When the target file is absent before install, we create it and record createdFile=true
 * on the anchor. On uninstall, if createdFile=true AND the remaining content is empty or
 * whitespace, the file is deleted to restore pre-install state.
 *
 * ORPHAN DETECTION (detect()):
 * If the file contains our block markers but the manifest has no matching entry, we report
 * occupied-by-other with fingerprint "orphan-logbook-block". This protects against
 * accidental double-install or leftover blocks from a failed previous run.
 *
 * CRLF POLICY (T3):
 * All read/write paths flow through toLF/fromLF. detectedLineEnding is captured at install
 * and stored in ManifestArtifact for symmetric uninstall.
 *
 * IDEMPOTENCY:
 * detect() returning "occupied-by-logbook" means the install-engine skips install().
 * If install() is called despite an existing block (e.g. during an upgrade), upsertMarkdownBlock
 * replaces the block in-place (mode="replaced") — the result is idempotent.
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
  upsertMarkdownBlock,
  removeMarkdownBlock,
  AnchorAmbiguousError,
} from "../../../util/markdown-block.js";
import { sha256 } from "../../../util/hash.js";
import { toLF, fromLF } from "../../../util/crlf.js";
import type { LineEnding } from "../../../util/crlf.js";

type ClaudeMdArtifact = Extract<Artifact, { kind: "augment_claudemd" }>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const START_MARKER = "<!-- logbook:generated start v=1 -->";
const END_MARKER = "<!-- logbook:generated end -->";
const MARKER_VERSION = 1;

/** Regex to detect ANY logbook:generated block (mirrors markdown-block.ts BLOCK_RE). */
const BLOCK_RE =
  /<!--\s*logbook:generated start v=(\d+)\s*-->([\s\S]*?)<!--\s*logbook:generated end\s*-->/g;

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

/** Detect if ANY logbook:generated block exists in the content. */
function hasLogbookBlock(content: string): boolean {
  BLOCK_RE.lastIndex = 0;
  return BLOCK_RE.test(content);
}

/**
 * Compute content_hash for the installed block.
 * Hashes the block span bytes: startMarker + "\n" + body + "\n" + endMarker.
 * This is the same string that upsertMarkdownBlock writes for the block interior.
 */
function computeBlockHash(body: string): string {
  const blockSpan = `${START_MARKER}\n${body}\n${END_MARKER}`;
  return sha256(blockSpan);
}

// ---------------------------------------------------------------------------
// ClaudeMdAugmentInstaller
// ---------------------------------------------------------------------------

export class ClaudeMdAugmentInstaller implements ArtifactInstaller<ClaudeMdArtifact> {
  readonly kind = "augment_claudemd" as const;

  async detect(artifact: ClaudeMdArtifact, ctx: InstallContext): Promise<DetectionResult> {
    const filePath = artifact.file_path;

    // 1. Check manifest for a matching logbook entry (by _logbookId / id).
    // If found, we own this slot — report occupied-by-logbook.
    const existing = ctx.manifest.artifacts.find(
      (a) =>
        a.file_path === filePath &&
        a.anchor.type === "markdown_block" &&
        a.id === artifact._logbookId
    );
    if (existing) {
      return { status: "occupied-by-logbook", existing };
    }

    // 2. Check if the file has our block markers without a manifest entry.
    // This is an orphan — a block left over from a previous (possibly partial) install.
    // Safe action: report occupied-by-other; do NOT install over it.
    const targetPath = nodePath.join(ctx.projectRoot, filePath);
    const rawSource = await readFileOrNull(targetPath);
    if (rawSource !== null) {
      const { content } = toLF(rawSource);
      if (hasLogbookBlock(content)) {
        return { status: "occupied-by-other", fingerprint: "orphan-logbook-block" };
      }
    }

    return { status: "empty" };
  }

  async install(artifact: ClaudeMdArtifact, ctx: InstallContext): Promise<ManifestArtifact> {
    const filePath = artifact.file_path;
    const targetPath = nodePath.join(ctx.projectRoot, filePath);
    const body = artifact.block_content;

    const rawSource = await readFileOrNull(targetPath);

    // Track whether we created the file from scratch (for uninstall cleanup).
    const createdFile = rawSource === null;

    // CRLF normalize: work in LF internally for all string operations.
    // fromLF restores original line endings on write.
    const { content: source, original: detectedEnding } = rawSource !== null
      ? toLF(rawSource)
      : { content: "", original: "lf" as LineEnding };

    // Apply iter1's upsertMarkdownBlock — inserts or replaces in-place.
    const { next, addedLeadingNewline } = upsertMarkdownBlock(source, body, {
      markerVersion: MARKER_VERSION,
    });

    // Ensure parent directory exists (in case CLAUDE.md is in a subdirectory).
    await fs.mkdir(nodePath.dirname(targetPath), { recursive: true });

    // Restore original line endings before writing.
    await atomicWrite(targetPath, fromLF(next, detectedEnding));

    // Compute content_hash over the block span bytes (layout-independent).
    const contentHash = computeBlockHash(body);

    return {
      id: artifact._logbookId,
      kind: "augment_claudemd",
      file_path: filePath,
      anchor: {
        type: "markdown_block",
        start_marker: START_MARKER,
        end_marker: END_MARKER,
        addedLeadingNewline,
        ...(createdFile ? { createdFile: true } : {}),
      },
      content_hash: contentHash,
      installed_at: ctx.now(),
      detectedLineEnding: detectedEnding,
    };
  }

  async uninstall(entry: ManifestArtifact, ctx: InstallContext): Promise<void> {
    if (entry.anchor.type !== "markdown_block") {
      throw new Error(
        `ClaudeMdAugmentInstaller.uninstall: expected markdown_block anchor, got ${entry.anchor.type}`
      );
    }

    const anchor = entry.anchor;
    const targetPath = nodePath.join(ctx.projectRoot, entry.file_path);

    const rawSource = await readFileOrNull(targetPath);

    // File is missing entirely.
    if (rawSource === null) {
      if (anchor.createdFile === true) {
        // We created it AND it's already gone — nothing to do (idempotent).
        return;
      }
      // We did NOT create it but it's gone — nothing to remove; idempotent.
      return;
    }

    // CRLF normalize.
    const targetEnding = entry.detectedLineEnding ?? "lf";
    const { content: source } = toLF(rawSource);

    // Remove our block using iter1's removeMarkdownBlock primitive.
    // Pass addedLeadingNewline so the primitive restores the exact bytes before the block.
    const updated = removeMarkdownBlock(source, {
      markerVersion: MARKER_VERSION,
      addedLeadingNewline: anchor.addedLeadingNewline ?? false,
    });

    // If we created the file AND the remaining content is empty/whitespace, delete it.
    if (anchor.createdFile === true && updated.trim() === "") {
      try {
        await fs.unlink(targetPath);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        // Already gone — idempotent.
      }
      return;
    }

    // Otherwise restore original line endings and write.
    await atomicWrite(targetPath, fromLF(updated, targetEnding));
  }

  async verify(entry: ManifestArtifact, ctx: InstallContext): Promise<VerifyResult> {
    const targetPath = nodePath.join(ctx.projectRoot, entry.file_path);
    const rawSource = await readFileOrNull(targetPath);

    if (rawSource === null) {
      return { ok: false, reason: "file_missing" };
    }

    if (entry.anchor.type !== "markdown_block") {
      return { ok: false, reason: "anchor_missing" };
    }

    // CRLF normalize before locate: the block hash is computed over LF-normalized bytes.
    const { content: source } = toLF(rawSource);

    // Locate the block using the same regex as the primitive.
    BLOCK_RE.lastIndex = 0;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = BLOCK_RE.exec(source)) !== null) {
      matches.push(match[0]);
    }

    if (matches.length === 0) {
      return { ok: false, reason: "anchor_missing" };
    }

    if (matches.length > 1) {
      // Ambiguous — two blocks; cannot reliably verify.
      return { ok: false, reason: "anchor_missing" };
    }

    // Recompute hash over the located block span.
    const locatedHash = sha256(matches[0]!);
    if (locatedHash !== entry.content_hash) {
      return { ok: false, reason: "hash_mismatch" };
    }

    return { ok: true };
  }
}

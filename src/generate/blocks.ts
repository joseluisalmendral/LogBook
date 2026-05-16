/**
 * generate/blocks.ts — Wrapper around upsertMarkdownBlock with named marker families (T11).
 *
 * Reads the file (or uses empty string if absent), runs upsertMarkdownBlock,
 * atomically writes back (temp + rename). Returns `written: false` if the new
 * content matches old (no-op write — idempotency guard for determinism tests).
 */

import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { upsertMarkdownBlock } from "../util/markdown-block.js";

export interface UpsertOpts {
  /** Absolute path to the file to update. Parent dirs are created if missing. */
  file: string;
  /** Marker family name, e.g. "logbook:doc:index", "logbook:doc:timeline". */
  markerName: string;
  /** Block marker version (1 for iter2). */
  markerVersion: number;
  /** Content body to write inside the markers. */
  body: string;
}

/**
 * Upsert a generated block in a file using the given marker family.
 *
 * - Creates the file and any missing parent directories if they don't exist.
 * - Replaces an existing same-family block in-place, preserving all other content.
 * - Returns `{ written: false }` if the resulting file content would be identical
 *   to what's already on disk (no I/O on no-ops).
 */
export async function upsertGeneratedBlock(
  opts: UpsertOpts
): Promise<{ written: boolean }> {
  const { file, markerName, markerVersion, body } = opts;

  // Ensure parent directory exists.
  await fs.mkdir(dirname(file), { recursive: true });

  // Read existing content (or start from empty string if file is absent).
  let existing = "";
  try {
    existing = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Run upsert logic.
  const { next } = upsertMarkdownBlock(existing, body, { markerVersion, markerName });

  // No-op check — if the result is identical, skip the write.
  if (next === existing) {
    return { written: false };
  }

  // Atomic write: temp file + rename.
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, next, "utf8");
  await fs.rename(tmp, file);

  return { written: true };
}

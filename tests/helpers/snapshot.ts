/**
 * Directory snapshot helper for E2E byte-identity tests.
 *
 * Recursively walks a directory, computes sha256 of every file, and returns
 * a sorted snapshot. Used by Test 1 and Test 2 to assert that install +
 * uninstall leaves the project byte-identical to its initial state.
 */

import { promises as fs } from "node:fs";
import { join, relative } from "pathe";
import { createHash } from "node:crypto";

export interface FileSnapshot {
  /** Project-relative path (forward slashes, always). */
  path: string;
  /** sha256 hex digest of the file's bytes. */
  sha256: string;
  /** File size in bytes. */
  bytes: number;
}

export interface DirSnapshot {
  /** Sorted by path ascending for deterministic comparison. */
  entries: FileSnapshot[];
  totalBytes: number;
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

const DEFAULT_IGNORE = [".git", "node_modules"];

/**
 * Walk `root` recursively and return a deterministic snapshot of every file.
 *
 * macOS symlink note: `root` is resolved via `fs.realpath` before walking so
 * `/var/folders/…` and `/private/var/folders/…` are treated as the same path.
 */
export async function snapshotDir(
  root: string,
  opts?: { ignore?: string[] },
): Promise<DirSnapshot> {
  const realRoot = await fs.realpath(root);
  const ignore = opts?.ignore ?? DEFAULT_IGNORE;
  const entries: FileSnapshot[] = [];

  async function walk(dir: string): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const abs = join(dir, item.name);
      const rel = relative(realRoot, abs);

      // Check if this path starts with any ignored prefix
      if (ignore.some((prefix) => rel === prefix || rel.startsWith(prefix + "/"))) {
        continue;
      }

      if (item.isDirectory()) {
        await walk(abs);
      } else if (item.isFile()) {
        const buf = await fs.readFile(abs);
        const hash = createHash("sha256").update(buf).digest("hex");
        entries.push({ path: rel, sha256: hash, bytes: buf.length });
      }
      // Symlinks pointing to directories or files are not followed to keep the
      // snapshot predictable on macOS where /tmp → /private/tmp.
    }
  }

  await walk(realRoot);

  entries.sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = entries.reduce((acc, e) => acc + e.bytes, 0);

  return { entries, totalBytes };
}

/**
 * Compare two snapshots and return the diff.
 *
 * - `added`   — paths present in `after` but not in `before`
 * - `removed` — paths present in `before` but not in `after`
 * - `changed` — paths present in both but with a different sha256
 */
export function diffSnapshots(before: DirSnapshot, after: DirSnapshot): SnapshotDiff {
  const beforeMap = new Map(before.entries.map((e) => [e.path, e.sha256]));
  const afterMap = new Map(after.entries.map((e) => [e.path, e.sha256]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [path, sha] of afterMap) {
    if (!beforeMap.has(path)) {
      added.push(path);
    } else if (beforeMap.get(path) !== sha) {
      changed.push(path);
    }
  }

  for (const path of beforeMap.keys()) {
    if (!afterMap.has(path)) {
      removed.push(path);
    }
  }

  return { added, removed, changed };
}

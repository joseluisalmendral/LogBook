import * as fs from "node:fs";
import * as path from "node:path";
import { PathEscapeError } from "../core/errors.js";

/**
 * Resolves `p` relative to `root` and asserts the result is within `root`.
 *
 * - If the resolved path exists, `fs.realpathSync` is used to follow symlinks.
 * - If the resolved path does not yet exist, the parent directory is checked
 *   instead so we can validate write targets before they are created.
 *
 * @returns The canonicalized absolute path.
 * @throws {Error} when the resolved path would escape the project root.
 */
export function assertWithinProject(p: string, root: string): string {
  const canonicalRoot = (() => {
    try {
      return fs.realpathSync(root);
    } catch {
      return path.resolve(root);
    }
  })();

  // Resolve the candidate — path.resolve handles both relative and absolute.
  const resolved = path.resolve(root, p);

  // Canonicalize via realpath when possible to follow symlinks.
  let canonical: string;
  try {
    canonical = fs.realpathSync(resolved);
  } catch {
    // Target does not exist yet — validate the parent directory instead.
    const parent = path.dirname(resolved);
    let canonicalParent: string;
    try {
      canonicalParent = fs.realpathSync(parent);
    } catch {
      canonicalParent = path.resolve(parent);
    }
    if (
      canonicalParent !== canonicalRoot &&
      !canonicalParent.startsWith(canonicalRoot + path.sep)
    ) {
      throw new PathEscapeError(
        `Path escape detected: "${p}" resolves to "${resolved}" which is outside project root "${canonicalRoot}"`
      );
    }
    return resolved;
  }

  // Confirm the resolved+canonicalized path is within root.
  if (
    canonical !== canonicalRoot &&
    !canonical.startsWith(canonicalRoot + path.sep)
  ) {
    throw new PathEscapeError(
      `Path escape detected: "${p}" resolves to "${canonical}" which is outside project root "${canonicalRoot}"`
    );
  }

  return canonical;
}

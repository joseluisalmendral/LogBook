/**
 * Resolve the `--out` flag of CLI export commands with safe defaults.
 *
 * Behaviour:
 *   - undefined / empty → returns undefined (caller uses its default path).
 *   - Absolute path     → returned as-is. The user explicitly chose a system
 *                         path; they own the responsibility for writing there.
 *   - Relative path     → resolved against the PROJECT ROOT (not cwd). If it
 *                         escapes the project root via `..`, we throw.
 *
 * Rationale (regression 2026-05-21 audit, WARNING #6): the export commands
 * were taking the raw `--out` string and passing it straight through to
 * `writeFile`. A relative `--out ../../etc/foo` resolved against cwd and
 * silently wrote outside the project. This helper makes that explicit:
 *   - Absolute is an opt-in for "yes I know where I'm writing".
 *   - Relative is confined to the project sandbox.
 *
 * Throws when the relative path escapes the project root. The CLI caller
 * should catch and exit non-zero.
 */

import * as path from "node:path";

export class OutPathEscapeError extends Error {
  constructor(public readonly outArg: string, public readonly projectRoot: string) {
    super(
      `Refusing to write outside the project root.\n` +
        `  --out  ${outArg}\n` +
        `  root   ${projectRoot}\n` +
        `Pass an absolute path if you really want to write outside the project.`,
    );
    this.name = "OutPathEscapeError";
  }
}

export function resolveOutPath(
  outArg: string | undefined,
  projectRoot: string,
): string | undefined {
  if (outArg === undefined || outArg === "") return undefined;

  if (path.isAbsolute(outArg)) {
    return outArg;
  }

  const resolved = path.resolve(projectRoot, outArg);
  const relAfterResolve = path.relative(projectRoot, resolved);

  // path.relative returns a string starting with `..` when `resolved` is
  // outside `projectRoot`. An empty string means it IS the project root.
  if (relAfterResolve.startsWith("..") || path.isAbsolute(relAfterResolve)) {
    throw new OutPathEscapeError(outArg, projectRoot);
  }

  return resolved;
}

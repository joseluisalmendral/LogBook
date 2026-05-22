/**
 * Project root resolution and .logbook/* path constants.
 *
 * resolveProjectRoot walks up the directory tree looking for any of:
 *   .git/  .claude/  package.json
 *
 * makePaths is a pure function — no I/O — that builds every known
 * LogBook path from a given root so callers can obtain all paths from
 * a single source of truth.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { join } from "pathe";
import { LogBookError } from "./errors.js";

// Markers that indicate the project root directory.
const ROOT_MARKERS = [".git", ".claude", "package.json"] as const;

/**
 * Target directory for subagent files.
 *
 * Claude Code 2026 uses `.claude/subagents/` per spec §5/§32.
 * Alternative `.claude/agents/` was used in earlier preview builds.
 * This const is the single swap point if the path ever changes.
 */
export const SUBAGENT_DIR = ".claude/subagents" as const;

export interface ProjectPaths {
  root: string;           // absolute project root
  logbookDir: string;     // <root>/.logbook
  manifestPath: string;   // <root>/.logbook/install-manifest.json
  configPath: string;     // <root>/.logbook/config.json
  providersPath: string;  // <root>/.logbook/providers.json
  statePath: string;      // <root>/.logbook/state.json
  indexDbPath: string;    // <root>/.logbook/index.sqlite
  backupsDir: string;     // <root>/.logbook/backups
  dataDir: string;        // <root>/logbook
  evidenceDir: string;    // <root>/logbook/evidence
  eventsJsonl: string;    // <root>/logbook/evidence/events.jsonl
  decisionsJsonl: string; // <root>/logbook/evidence/decisions.jsonl
  errorsJsonl: string;    // <root>/logbook/evidence/errors.jsonl
  lessonsJsonl: string;   // <root>/logbook/evidence/lessons.jsonl
}

/**
 * Walk up from `startFrom` (default: process.cwd()) until a directory
 * contains at least one root marker. Returns the absolute path of that dir.
 *
 * Uses realpathSync to canonicalize symlinks (handles macOS /var → /private/var).
 *
 * **Boundary**: the walk stops at the user's HOME directory (inclusive). We do
 * NOT walk above HOME into `/Users` or `/`. Without this guard, a `logbook
 * init` inside a folder that has no `.git` / `package.json` / `.claude` would
 * silently install in some unrelated parent directory that happens to be a
 * project root — the user-reported symptom 2026-05-21
 * ("se instala en otra ubicación cuando no hay git init").
 *
 * If no marker is found anywhere from `start` up to HOME, this throws
 * PROJECT_ROOT_NOT_FOUND with guidance: run `git init`, or call this with
 * `useCwdAsFallback: true` (i.e. the CLI's `--here` flag) to install at the
 * starting directory regardless.
 *
 * @param startFrom         Directory to start the walk from. Defaults to cwd.
 * @param useCwdAsFallback  If true, return cwd when no marker is found
 *                          instead of throwing. Used by `logbook init --here`.
 * @throws {LogBookError} with code PROJECT_ROOT_NOT_FOUND if no marker found
 *                       within HOME and useCwdAsFallback is false.
 */
export function resolveProjectRoot(
  startFrom?: string,
  useCwdAsFallback: boolean = false,
): string {
  const start = path.resolve(startFrom ?? process.cwd());
  // Canonicalize HOME so the comparison handles macOS /var → /private/var.
  let home: string;
  try {
    home = fs.realpathSync(os.homedir());
  } catch {
    home = os.homedir();
  }

  // Canonicalize the start path for the same reason. Falls back to the raw
  // path if realpath fails (e.g. the dir does not exist yet).
  let current: string;
  try {
    current = fs.realpathSync(start);
  } catch {
    current = start;
  }

  while (true) {
    // HOME itself is NEVER a valid project root. macOS users always have
    // `~/.claude/` (created by Claude Code itself); many devs also have
    // `~/.git` (dotfiles repo). If we accepted HOME as a project root,
    // running `logbook init` from a marker-less subdir would silently
    // install LogBook into the user's home directory, polluting
    // `~/.claude/`, `~/.mcp.json`, etc. — exactly what happened to a user
    // on 2026-05-22. Skip the marker check at HOME and treat it as the
    // walk's stop boundary.
    if (current === home) break;

    for (const marker of ROOT_MARKERS) {
      if (fs.existsSync(path.join(current, marker))) {
        try {
          return fs.realpathSync(current);
        } catch {
          return current;
        }
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root reached

    current = parent;
  }

  if (useCwdAsFallback) {
    try {
      return fs.realpathSync(start);
    } catch {
      return start;
    }
  }

  throw new LogBookError(
    "PROJECT_ROOT_NOT_FOUND",
    `No project root marker (.git, .claude, package.json) found between ${start} and ${home}.\n` +
      `→ Run \`git init\` in the project folder, or rerun with \`--here\` to ` +
      `install at the current directory anyway.`,
  );
}

/**
 * Pure function that constructs all LogBook paths from a given project root.
 * Does not perform any I/O.
 */
export function makePaths(root: string): ProjectPaths {
  const logbookDir = join(root, ".logbook");
  const evidenceDir = join(root, "logbook", "evidence");

  return {
    root,
    logbookDir,
    manifestPath: join(logbookDir, "install-manifest.json"),
    configPath: join(logbookDir, "config.json"),
    providersPath: join(logbookDir, "providers.json"),
    statePath: join(logbookDir, "state.json"),
    indexDbPath: join(logbookDir, "index.sqlite"),
    backupsDir: join(logbookDir, "backups"),
    dataDir: join(root, "logbook"),
    evidenceDir,
    eventsJsonl: join(evidenceDir, "events.jsonl"),
    decisionsJsonl: join(evidenceDir, "decisions.jsonl"),
    errorsJsonl: join(evidenceDir, "errors.jsonl"),
    lessonsJsonl: join(evidenceDir, "lessons.jsonl"),
  };
}

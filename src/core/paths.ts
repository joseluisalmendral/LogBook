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
 * @throws {LogBookError} with code PROJECT_ROOT_NOT_FOUND if no marker found.
 */
export function resolveProjectRoot(startFrom?: string): string {
  const start = path.resolve(startFrom ?? process.cwd());

  let current = start;
  while (true) {
    for (const marker of ROOT_MARKERS) {
      if (fs.existsSync(path.join(current, marker))) {
        // Canonicalize to resolve macOS /var → /private/var symlinks.
        try {
          return fs.realpathSync(current);
        } catch {
          return current;
        }
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding a marker.
      throw new LogBookError(
        "PROJECT_ROOT_NOT_FOUND",
        `No project root marker (.git, .claude, package.json) found starting from: ${start}`
      );
    }
    current = parent;
  }
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

/**
 * MCP server bootstrap context.
 *
 * Resolves the project root, opens SQLite (WAL mode, migrated), and reads
 * state.json. All errors here are fatal — the MCP server cannot operate
 * without a valid project context and database connection.
 *
 * Usage:
 *   const ctx = await bootstrapMcpContext();
 *   // ... serve requests ...
 *   await closeMcpContext(ctx);
 */

import { type Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolveProjectRoot, makePaths, type ProjectPaths } from "../core/paths.js";
import { openIndex } from "../store/sqlite.js";
import { readState, type LogBookState } from "../core/state.js";

export interface MCPContext {
  /** Absolute path to the project root. */
  projectRoot: string;
  /** All LogBook-managed paths derived from the project root. */
  paths: ProjectPaths;
  /** Open SQLite database handle (WAL mode, migrations applied). */
  db: DB;
  /** Last-read state from .logbook/state.json. */
  state: LogBookState;
}

export interface BootstrapOptions {
  /** Override cwd for project root resolution (useful in tests). */
  cwd?: string;
}

/**
 * Bootstrap the MCP server context.
 *
 * Throws if:
 *  - No project root marker is found (fatal; cannot serve any tool).
 *  - SQLite fails to open (fatal; event writes and queries would fail).
 *
 * State read failure is NON-fatal: readState() already degrades to a safe
 * default so the server can still operate in a degraded mode (disabled=false).
 */
export async function bootstrapMcpContext(
  opts: BootstrapOptions = {},
): Promise<MCPContext> {
  // 1. Resolve project root — throws LogBookError with PROJECT_ROOT_NOT_FOUND.
  const projectRoot = resolveProjectRoot(opts.cwd);
  const paths = makePaths(projectRoot);

  // 2. Ensure .logbook/ directory exists before opening SQLite.
  //    better-sqlite3 throws if the parent directory does not exist.
  //    This is safe to call on an already-initialized project.
  mkdirSync(paths.logbookDir, { recursive: true });

  // 3. Open SQLite — throws on binding failure or locked database.
  //    WAL mode and migration are applied inside openIndex().
  const db = openIndex(paths.indexDbPath);

  // 4. Read state — never throws (degrades to defaultState() on any error).
  const state = readState(paths.statePath);

  return { projectRoot, paths, db, state };
}

/**
 * Close the MCP context gracefully.
 * Closes the SQLite connection. Does NOT write or flush JSONL files
 * (those are written per-call and fdatasync'd immediately).
 */
export async function closeMcpContext(ctx: MCPContext): Promise<void> {
  ctx.db.close();
}

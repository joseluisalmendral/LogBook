import Database, { type Database as DB } from "better-sqlite3";
import { migrate } from "./migrate.js";

export interface OpenIndexOptions {
  /** Open in read-only mode. Skips migration. Default: false. */
  readonly?: boolean;
  /** Throw if the file does not already exist. Default: false. */
  fileMustExist?: boolean;
}

/**
 * Open the SQLite index file, apply WAL + foreign-key PRAGMAs, and run
 * migration (unless readonly is set).
 *
 * Surfaces a clear error message when the better-sqlite3 native binding
 * cannot be loaded (e.g. Node/arch mismatch after cross-platform install).
 */
export function openIndex(path: string, opts: OpenIndexOptions = {}): DB {
  const { readonly = false, fileMustExist = false } = opts;

  let db: DB;
  try {
    db = new Database(path, { readonly, fileMustExist });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("Could not locate the bindings file") ||
      msg.includes("binding") ||
      msg.includes("node_modules/better-sqlite3")
    ) {
      throw new Error(
        `[logbook] better-sqlite3 native binding failed to load.\n` +
          `Platform: ${process.platform}/${process.arch}/node${process.versions.node}\n` +
          `Original error: ${msg}\n` +
          `Run: pnpm rebuild better-sqlite3`,
      );
    }
    throw err;
  }

  if (!readonly) {
    // WAL mode: concurrent readers don't block writers; no checkpoint scheduling in iter1.
    db.pragma("journal_mode = WAL");
    // NORMAL synchronous mode: safe with WAL (no fsync on every commit).
    db.pragma("synchronous = NORMAL");
    // Enforce foreign-key constraints at the SQLite level.
    db.pragma("foreign_keys = ON");

    migrate(db);
  } else {
    // Still enable foreign keys in readonly mode — reads benefit from constraint awareness.
    db.pragma("foreign_keys = ON");
  }

  return db;
}

/** Close the database connection. */
export function closeIndex(db: DB): void {
  db.close();
}

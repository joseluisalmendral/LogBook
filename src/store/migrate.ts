import type { Database } from "better-sqlite3";
import { DDL, SCHEMA_VERSION } from "./schema.js";

/**
 * Apply all DDL in a single transaction and update schema_version.
 * Idempotent: safe to call on an already-migrated database.
 *
 * Returns { from: previousVersion, to: SCHEMA_VERSION }.
 *
 * Migration steps applied in order inside the transaction:
 *   v0 → v2: fresh database — run all DDL (creates current-version tables)
 *   v1 → v2: existing database — drop dead `events` and `sessions` tables,
 *             then create all current-version DDL (CREATE IF NOT EXISTS is safe).
 */
export function migrate(db: Database): { from: number; to: number } {
  // Determine current version before touching anything.
  const from = getCurrentVersion(db);

  if (from === SCHEMA_VERSION) {
    // Nothing to do.
    return { from, to: SCHEMA_VERSION };
  }

  // Apply all DDL in one transaction so the database never ends up in a
  // partial state if interrupted between statements.
  db.transaction(() => {
    // v1 → v2: drop dead tables that were never written to.
    // DROP TABLE IF EXISTS is idempotent — safe at any starting version.
    if (from >= 1) {
      db.prepare(`DROP TABLE IF EXISTS events`).run();
      db.prepare(`DROP TABLE IF EXISTS sessions`).run();
    }

    // Apply current-version DDL (all CREATE TABLE/INDEX IF NOT EXISTS).
    for (const sql of Object.values(DDL)) {
      db.prepare(sql).run();
    }

    // Upsert the version row (INSERT OR REPLACE handles both first-time and
    // future migrations that bump SCHEMA_VERSION).
    db.prepare(
      `INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)`,
    ).run(SCHEMA_VERSION, new Date().toISOString());
  })();

  return { from, to: SCHEMA_VERSION };
}

/**
 * Read the current schema version from the database.
 * Returns 0 when the schema_version table does not yet exist (fresh DB).
 */
function getCurrentVersion(db: Database): number {
  // Check if schema_version table exists before querying it.
  const tableExists = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'`,
    )
    .get();

  if (!tableExists) {
    return 0;
  }

  const row = db
    .prepare(`SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`)
    .get() as { version: number } | undefined;

  return row?.version ?? 0;
}

/**
 * Unit tests: sqlite v1 → v2 migration drops dead tables (persistence-truthfulness PR 4).
 *
 * Verifies that:
 *  - A fresh DB (v0) is initialized at v2 with no `events` or `sessions` tables.
 *  - A v1 DB (dead tables present) is migrated to v2 with dead tables dropped.
 *  - The migration is idempotent (running openIndex twice does not error).
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { openIndex, closeIndex } from "../../src/store/sqlite.js";
import { SCHEMA_VERSION } from "../../src/store/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDbs: string[] = [];

function tmpDbPath(): string {
  const p = path.join(os.tmpdir(), `lb-sqlite-test-${Math.random().toString(36).slice(2)}.sqlite`);
  tmpDbs.push(p);
  return p;
}

function getSchemaVersion(db: DB): number {
  const tableExists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'`)
    .get();
  if (!tableExists) return 0;
  const row = db
    .prepare(`SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`)
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}

function tableExists(db: DB, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return row !== undefined;
}

/**
 * Seed a DB file with the v1 DDL (including the dead tables).
 * Returns the path so it can be opened by openIndex.
 */
function seedV1Db(): string {
  const dbPath = tmpDbPath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Create schema_version table and record v1.
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  db.prepare(`INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)`)
    .run(1, new Date().toISOString());

  // Create the dead tables that v2 migration must drop.
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_id TEXT,
    timestamp TEXT NOT NULL,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    kind TEXT NOT NULL,
    phase TEXT,
    redacted INTEGER NOT NULL,
    latency_ms INTEGER,
    payload_text TEXT,
    payload_tool_name TEXT,
    meta_json TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    project_root TEXT NOT NULL,
    agent TEXT NOT NULL,
    model TEXT,
    phase TEXT,
    event_count INTEGER NOT NULL DEFAULT 0,
    decision_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0
  )`);

  db.close();
  return dbPath;
}

afterEach(() => {
  for (const p of tmpDbs) {
    try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(p + "-wal", { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(p + "-shm", { force: true }); } catch { /* ignore */ }
  }
  tmpDbs.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sqlite v1 → v2 migration", () => {
  it("fresh DB (v0) initializes at SCHEMA_VERSION with no dead tables", () => {
    const dbPath = tmpDbPath();
    const db = openIndex(dbPath);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(tableExists(db, "events")).toBe(false);
    expect(tableExists(db, "sessions")).toBe(false);

    closeIndex(db);
  });

  it("v1 DB has `events` and `sessions` tables before migration", () => {
    const dbPath = seedV1Db();
    const db = new Database(dbPath);

    expect(getSchemaVersion(db)).toBe(1);
    expect(tableExists(db, "events")).toBe(true);
    expect(tableExists(db, "sessions")).toBe(true);

    db.close();
  });

  it("v1 DB → openIndex drops dead tables and bumps schema_version to 2", () => {
    const dbPath = seedV1Db();
    const db = openIndex(dbPath);

    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(2);
    expect(tableExists(db, "events")).toBe(false);
    expect(tableExists(db, "sessions")).toBe(false);

    closeIndex(db);
  });

  it("migration is idempotent — running openIndex twice does not error", () => {
    const dbPath = seedV1Db();

    // First open: migrates v1 → v2.
    const db1 = openIndex(dbPath);
    closeIndex(db1);

    // Second open: already at v2, no-op.
    const db2 = openIndex(dbPath);
    expect(getSchemaVersion(db2)).toBe(SCHEMA_VERSION);
    expect(tableExists(db2, "events")).toBe(false);
    expect(tableExists(db2, "sessions")).toBe(false);
    closeIndex(db2);
  });

  it("fresh DB after migration retains all expected v2 tables", () => {
    const dbPath = tmpDbPath();
    const db = openIndex(dbPath);

    // These tables must exist after a fresh v2 init.
    expect(tableExists(db, "schema_version")).toBe(true);
    expect(tableExists(db, "decisions")).toBe(true);
    expect(tableExists(db, "errors")).toBe(true);
    expect(tableExists(db, "fixes")).toBe(true);
    expect(tableExists(db, "lessons")).toBe(true);
    expect(tableExists(db, "resources")).toBe(true);
    expect(tableExists(db, "milestones")).toBe(true);
    expect(tableExists(db, "suggestions")).toBe(true);
    expect(tableExists(db, "links")).toBe(true);

    closeIndex(db);
  });
});

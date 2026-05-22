/**
 * Unit tests for src/store/migrate.ts.
 *
 * Updated for v2 (persistence-truthfulness PR 4):
 *  - SCHEMA_VERSION is now 2.
 *  - Dead tables `events` and `sessions` are dropped on v1 → v2 migration.
 *  - v2 has 9 domain tables (schema_version + decisions + errors + fixes +
 *    lessons + resources + milestones + suggestions + links).
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../../src/store/migrate.js";
import { SCHEMA_VERSION } from "../../src/store/schema.js";

// v2 table count: schema_version + 8 domain tables = 9 total.
const EXPECTED_TABLE_COUNT = 9;

describe("migrate", () => {
  it("fresh in-memory DB: returns {from:0, to:SCHEMA_VERSION}", () => {
    const db = new Database(":memory:");
    const result = migrate(db);
    db.close();
    expect(result).toEqual({ from: 0, to: SCHEMA_VERSION });
  });

  it("after migration: schema_version row exists with version=SCHEMA_VERSION", () => {
    const db = new Database(":memory:");
    migrate(db);
    const row = db
      .prepare("SELECT version FROM schema_version WHERE version = ?")
      .get(SCHEMA_VERSION) as { version: number } | undefined;
    db.close();
    expect(row).toBeDefined();
    expect(row!.version).toBe(SCHEMA_VERSION);
  });

  it("after migration: v2 tables exist and dead tables are absent", () => {
    const db = new Database(":memory:");
    migrate(db);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    db.close();

    const names = rows.map((r) => r.name);

    // v2 tables that MUST exist
    const expected = [
      "decisions",
      "errors",
      "fixes",
      "lessons",
      "links",
      "milestones",
      "resources",
      "schema_version",
      "suggestions",
    ];
    for (const t of expected) {
      expect(names, `table ${t} missing`).toContain(t);
    }

    // Dead tables that must NOT exist
    expect(names, "dead table `events` must be absent").not.toContain("events");
    expect(names, "dead table `sessions` must be absent").not.toContain("sessions");
  });

  it("second call: returns {from:SCHEMA_VERSION, to:SCHEMA_VERSION} — idempotent", () => {
    const db = new Database(":memory:");
    migrate(db); // first
    const result = migrate(db); // second
    db.close();
    expect(result).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
  });

  it("idempotent: tables still exist and counts are stable after second migrate call", () => {
    const db = new Database(":memory:");
    migrate(db);
    migrate(db);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    db.close();
    expect(rows.length).toBeGreaterThanOrEqual(EXPECTED_TABLE_COUNT);
  });

  it("migration runs inside a transaction: entire DDL applied atomically", () => {
    const db = new Database(":memory:");
    migrate(db);
    const tableCount = (
      db
        .prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table'")
        .get() as { c: number }
    ).c;
    db.close();
    // 9 tables defined in v2 DDL (schema_version + 8 domain tables)
    expect(tableCount).toBe(EXPECTED_TABLE_COUNT);
  });

  it("v1 → v2: dead tables in a v1 DB are dropped by migrate", () => {
    // Seed a v1 DB with dead tables.
    const db = new Database(":memory:");

    // Manually create v1 state.
    db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (1, ?)`)
      .run(new Date().toISOString());
    db.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, kind TEXT NOT NULL)`);
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at TEXT NOT NULL)`);

    // Run migrate — should drop dead tables and apply v2 DDL.
    const result = migrate(db);
    db.close();

    expect(result).toEqual({ from: 1, to: SCHEMA_VERSION });
    expect(SCHEMA_VERSION).toBe(2);
  });
});

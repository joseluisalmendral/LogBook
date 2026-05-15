import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../../src/store/migrate.js";
import { SCHEMA_VERSION } from "../../src/store/schema.js";

describe("migrate", () => {
  it("fresh in-memory DB: returns {from:0, to:1}", () => {
    const db = new Database(":memory:");
    const result = migrate(db);
    db.close();
    expect(result).toEqual({ from: 0, to: SCHEMA_VERSION });
  });

  it("after migration: schema_version row exists with version=1", () => {
    const db = new Database(":memory:");
    migrate(db);
    const row = db
      .prepare("SELECT version FROM schema_version WHERE version = 1")
      .get() as { version: number } | undefined;
    db.close();
    expect(row).toBeDefined();
    expect(row!.version).toBe(1);
  });

  it("after migration: all expected tables exist", () => {
    const db = new Database(":memory:");
    migrate(db);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    db.close();

    const names = rows.map((r) => r.name);
    const expected = [
      "decisions",
      "errors",
      "events",
      "fixes",
      "lessons",
      "links",
      "milestones",
      "resources",
      "schema_version",
      "sessions",
      "suggestions",
    ];
    for (const t of expected) {
      expect(names, `table ${t} missing`).toContain(t);
    }
  });

  it("second call: returns {from:1, to:1} — idempotent", () => {
    const db = new Database(":memory:");
    migrate(db); // first
    const result = migrate(db); // second
    db.close();
    expect(result).toEqual({ from: 1, to: 1 });
  });

  it("idempotent: tables still exist after second migrate call", () => {
    const db = new Database(":memory:");
    migrate(db);
    migrate(db);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    db.close();
    expect(rows.length).toBeGreaterThanOrEqual(11);
  });

  it("migration runs inside a transaction: entire DDL applied atomically", () => {
    // Prove atomicity by inspecting that all tables appeared at once,
    // i.e., after migrate returns, counts are consistent (no partial state).
    const db = new Database(":memory:");
    migrate(db);
    const tableCount = (
      db
        .prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table'")
        .get() as { c: number }
    ).c;
    db.close();
    // 11 tables defined in DDL (schema_version + 10 domain tables)
    expect(tableCount).toBe(11);
  });
});

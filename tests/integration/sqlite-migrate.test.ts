/**
 * Integration tests for SQLite openIndex / migrate.
 *
 * Updated for v2 (persistence-truthfulness PR 4):
 *  - schema_version is now 2.
 *  - Dead tables `events` and `sessions` are absent from a fresh DB.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { openIndex, closeIndex } from "../../src/store/sqlite.js";
import { SCHEMA_VERSION } from "../../src/store/schema.js";

// Use realpathSync to resolve macOS /var -> /private/var symlink.
const TMP = realpathSync(tmpdir());

describe("sqlite-migrate integration", () => {
  let tmpDir: string;
  let dbPath: string;

  afterEach(() => {
    // Clean up temp dir after each test.
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function setup() {
    tmpDir = mkdtempSync(join(TMP, "lb-sqlite-"));
    dbPath = join(tmpDir, "index.db");
  }

  it("openIndex creates DB, runs migrate, v2 tables exist and dead tables absent", () => {
    setup();
    const db = openIndex(dbPath);

    const tables = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    closeIndex(db);

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
      expect(tables, `table ${t} missing after openIndex`).toContain(t);
    }

    // Dead tables that must NOT exist
    expect(tables, "dead table `events` must be absent").not.toContain("events");
    expect(tables, "dead table `sessions` must be absent").not.toContain("sessions");
  });

  it("WAL mode is active after openIndex", () => {
    setup();
    const db = openIndex(dbPath);
    const row = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    closeIndex(db);
    expect(row.journal_mode).toBe("wal");
  });

  it("reopening same file: schema_version stays at SCHEMA_VERSION — idempotent", () => {
    setup();
    // First open applies schema.
    const db1 = openIndex(dbPath);
    closeIndex(db1);

    // Second open: migrate should be idempotent.
    const db2 = openIndex(dbPath);
    const row = db2
      .prepare("SELECT version FROM schema_version")
      .get() as { version: number };
    closeIndex(db2);

    expect(row.version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(2);
  });

  it("readonly mode skips migrate and opens successfully at current schema_version", () => {
    setup();
    // Create and migrate first.
    const db1 = openIndex(dbPath);
    closeIndex(db1);

    // Open readonly — should NOT throw.
    const db2 = openIndex(dbPath, { readonly: true });
    const row = db2
      .prepare("SELECT version FROM schema_version")
      .get() as { version: number };
    closeIndex(db2);

    expect(row.version).toBe(SCHEMA_VERSION);
  });

  it("closeIndex closes the db (subsequent prepare throws)", () => {
    setup();
    const db = openIndex(dbPath);
    closeIndex(db);
    expect(() => db.prepare("SELECT 1")).toThrow();
  });

  it("foreign_keys pragma is ON", () => {
    setup();
    const db = openIndex(dbPath);
    const row = db.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    closeIndex(db);
    expect(row.foreign_keys).toBe(1);
  });
});

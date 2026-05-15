import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import Database from "better-sqlite3";
import { openIndex, closeIndex } from "../../src/store/sqlite.js";

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

  it("openIndex creates DB, runs migrate, all tables exist", () => {
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
      expect(tables, `table ${t} missing after openIndex`).toContain(t);
    }
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

  it("reopening same file: migrate returns {from:1, to:1} — idempotent", () => {
    setup();
    // First open applies schema.
    const db1 = openIndex(dbPath);
    closeIndex(db1);

    // Second open: migrate should be idempotent.
    const db2 = openIndex(dbPath);
    // Verify schema_version row is still correct.
    const row = db2
      .prepare("SELECT version FROM schema_version")
      .get() as { version: number };
    closeIndex(db2);

    expect(row.version).toBe(1);
  });

  it("readonly mode skips migrate and opens successfully", () => {
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

    expect(row.version).toBe(1);
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

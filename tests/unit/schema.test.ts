import { describe, it, expect } from "vitest";
import { DDL, SCHEMA_VERSION } from "../../src/store/schema.js";

describe("schema", () => {
  const TABLE_KEYS = [
    "schema_version",
    "events",
    "sessions",
    "decisions",
    "errors",
    "fixes",
    "lessons",
    "resources",
    "milestones",
    "suggestions",
    "links",
  ];
  const INDEX_KEYS = [
    "events_session_idx",
    "events_kind_idx",
    "links_idx",
  ];

  it("SCHEMA_VERSION is 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("DDL has all expected table keys", () => {
    for (const key of TABLE_KEYS) {
      expect(Object.keys(DDL), `missing DDL key: ${key}`).toContain(key);
    }
  });

  it("DDL has all expected index keys", () => {
    for (const key of INDEX_KEYS) {
      expect(Object.keys(DDL), `missing DDL key: ${key}`).toContain(key);
    }
  });

  it("every table DDL starts with CREATE TABLE IF NOT EXISTS", () => {
    for (const key of TABLE_KEYS) {
      expect(
        DDL[key as keyof typeof DDL].trimStart(),
        `DDL[${key}] does not start with CREATE TABLE IF NOT EXISTS`,
      ).toMatch(/^CREATE TABLE IF NOT EXISTS/);
    }
  });

  it("every index DDL starts with CREATE INDEX IF NOT EXISTS", () => {
    for (const key of INDEX_KEYS) {
      expect(
        DDL[key as keyof typeof DDL].trimStart(),
        `DDL[${key}] does not start with CREATE INDEX IF NOT EXISTS`,
      ).toMatch(/^CREATE INDEX IF NOT EXISTS/);
    }
  });

  it("total DDL entry count matches expected (11 tables + 3 indexes)", () => {
    expect(Object.keys(DDL).length).toBe(TABLE_KEYS.length + INDEX_KEYS.length);
  });
});

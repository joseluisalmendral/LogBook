import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { backupOnce, type BackupContext } from "../../src/core/backup.js";
import { BackupMismatchError } from "../../src/core/errors.js";

let tmpDir: string;
let canonicalTmp: string;
let backupsDir: string;
let projectRoot: string;

function makeCtx(overrides: Partial<BackupContext> = {}): BackupContext {
  return {
    backupsDir,
    projectRoot,
    now: () => "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-backup-"));
  canonicalTmp = fs.realpathSync(tmpDir);
  projectRoot = canonicalTmp;
  backupsDir = path.join(canonicalTmp, ".logbook", "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(canonicalTmp, { recursive: true, force: true });
});

describe("backupOnce — existing file", () => {
  it("copies the file to backups dir and returns populated BackupRef", () => {
    const filePath = path.join(projectRoot, "config.json");
    fs.writeFileSync(filePath, '{"key":"value"}');

    const ref = backupOnce(filePath, makeCtx());

    expect(ref.sha256.length).toBeGreaterThan(0);
    expect(ref.file_path).toBe("config.json");
    expect(ref.backup_path).toMatch(/^\.logbook[/\\]backups[/\\]/);
    expect(ref.taken_at).toBe("2026-01-01T00:00:00Z");

    // Backup file must exist on disk
    const backupAbs = path.join(projectRoot, ref.backup_path);
    expect(fs.existsSync(backupAbs)).toBe(true);

    // Content must match
    const origContent = fs.readFileSync(filePath);
    const backupContent = fs.readFileSync(backupAbs);
    expect(origContent.equals(backupContent)).toBe(true);
  });

  it("backup filename includes sha256 prefix and original basename", () => {
    const filePath = path.join(projectRoot, "myfile.txt");
    fs.writeFileSync(filePath, "hello world");
    const ref = backupOnce(filePath, makeCtx());
    const backupName = path.basename(ref.backup_path);
    expect(backupName).toContain("myfile.txt");
    // First 16 chars of sha256 — verify it's a hex prefix
    expect(backupName).toMatch(/^[0-9a-f]{16}-myfile\.txt$/);
  });
});

describe("backupOnce — non-existent file", () => {
  it("returns a BackupRef with empty sha256 and backup_path", () => {
    const filePath = path.join(projectRoot, "does-not-exist.json");
    const ref = backupOnce(filePath, makeCtx());
    expect(ref.sha256).toBe("");
    expect(ref.backup_path).toBe("");
    expect(ref.file_path).toBe("does-not-exist.json");
    expect(ref.taken_at).toBe("2026-01-01T00:00:00Z");
  });
});

describe("backupOnce — idempotency", () => {
  it("second call with same file is a no-op — returns same ref", () => {
    const filePath = path.join(projectRoot, "idem.txt");
    fs.writeFileSync(filePath, "idempotent content");

    const ref1 = backupOnce(filePath, makeCtx());
    const ref2 = backupOnce(filePath, makeCtx());

    expect(ref1.sha256).toBe(ref2.sha256);
    expect(ref1.backup_path).toBe(ref2.backup_path);

    // Only one backup file should exist
    const backupAbs = path.join(projectRoot, ref1.backup_path);
    expect(fs.existsSync(backupAbs)).toBe(true);
  });

  it("throws BackupMismatchError when backup file exists with different content", () => {
    const filePath = path.join(projectRoot, "conflict.txt");
    fs.writeFileSync(filePath, "original content");

    // Create a backup ref manually with the same name but different content
    const ref1 = backupOnce(filePath, makeCtx());
    const backupAbs = path.join(projectRoot, ref1.backup_path);

    // Tamper with the backup file
    fs.writeFileSync(backupAbs, "tampered content");

    // Second backup attempt should detect the mismatch
    let caught: unknown;
    try {
      backupOnce(filePath, makeCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BackupMismatchError);
  });
});

describe("backupOnce — paths are project-relative", () => {
  it("returns relative file_path from projectRoot", () => {
    const subDir = path.join(projectRoot, "subdir");
    fs.mkdirSync(subDir);
    const filePath = path.join(subDir, "nested.txt");
    fs.writeFileSync(filePath, "nested content");

    const ref = backupOnce(filePath, makeCtx());
    expect(ref.file_path).toBe(path.join("subdir", "nested.txt"));
  });
});

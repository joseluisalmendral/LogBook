import { describe, it, expect } from "vitest";
import {
  LogBookError,
  ConflictError,
  BackupMismatchError,
  HashMismatchError,
  PathEscapeError,
  AnchorNotFoundError,
  AnchorAmbiguousError,
} from "../../src/core/errors.js";

describe("LogBookError base class", () => {
  it("sets name, code, and message", () => {
    const err = new LogBookError("TEST_CODE", "test message");
    expect(err.name).toBe("LogBookError");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("test message");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("ConflictError", () => {
  it("is instanceof LogBookError and Error", () => {
    const err = new ConflictError("conflict occurred");
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toBeInstanceOf(LogBookError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has code CONFLICT and the provided message", () => {
    const err = new ConflictError("x");
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("x");
  });
});

describe("BackupMismatchError", () => {
  it("is instanceof LogBookError and Error", () => {
    const err = new BackupMismatchError("backup mismatch");
    expect(err).toBeInstanceOf(BackupMismatchError);
    expect(err).toBeInstanceOf(LogBookError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has code BACKUP_MISMATCH and the provided message", () => {
    const err = new BackupMismatchError("y");
    expect(err.code).toBe("BACKUP_MISMATCH");
    expect(err.message).toBe("y");
  });
});

describe("HashMismatchError", () => {
  it("is instanceof LogBookError and Error", () => {
    const err = new HashMismatchError("hash mismatch");
    expect(err).toBeInstanceOf(HashMismatchError);
    expect(err).toBeInstanceOf(LogBookError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has code HASH_MISMATCH and the provided message", () => {
    const err = new HashMismatchError("z");
    expect(err.code).toBe("HASH_MISMATCH");
    expect(err.message).toBe("z");
  });
});

describe("PathEscapeError", () => {
  it("is instanceof LogBookError and Error", () => {
    const err = new PathEscapeError("path escaped");
    expect(err).toBeInstanceOf(PathEscapeError);
    expect(err).toBeInstanceOf(LogBookError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has code PATH_ESCAPE and the provided message", () => {
    const err = new PathEscapeError("w");
    expect(err.code).toBe("PATH_ESCAPE");
    expect(err.message).toBe("w");
  });
});

describe("Re-exported anchor errors", () => {
  it("AnchorNotFoundError is importable from core/errors and extends Error", () => {
    const err = new AnchorNotFoundError("not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ANCHOR_NOT_FOUND");
    expect(err.message).toBe("not found");
  });

  it("AnchorAmbiguousError is importable from core/errors and extends Error", () => {
    const err = new AnchorAmbiguousError("ambiguous");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("ANCHOR_AMBIGUOUS");
    expect(err.message).toBe("ambiguous");
  });
});

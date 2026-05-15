/**
 * Typed error hierarchy for LogBook.
 *
 * All LogBook-originated errors extend LogBookError so callers can
 * discriminate them with a single `instanceof` check and inspect `.code`
 * for fine-grained handling.
 *
 * S3 defined AnchorNotFoundError and AnchorAmbiguousError inline in
 * json-string-patch.ts. They are re-exported here as the canonical surface
 * so consumers only need to import from core/errors.
 */

export class LogBookError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LogBookError";
    this.code = code;
    // Preserve correct prototype chain in environments where Error is subclassed.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConflictError extends LogBookError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BackupMismatchError extends LogBookError {
  constructor(message: string) {
    super("BACKUP_MISMATCH", message);
    this.name = "BackupMismatchError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class HashMismatchError extends LogBookError {
  constructor(message: string) {
    super("HASH_MISMATCH", message);
    this.name = "HashMismatchError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PathEscapeError extends LogBookError {
  constructor(message: string) {
    super("PATH_ESCAPE", message);
    this.name = "PathEscapeError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Re-export the S3 anchor errors — they remain defined in json-string-patch.ts
// and are NOT changed to extend LogBookError (they predate this hierarchy).
export { AnchorNotFoundError, AnchorAmbiguousError } from "../util/json-string-patch.js";

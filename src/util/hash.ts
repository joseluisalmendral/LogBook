import { createHash } from "node:crypto";

/**
 * Returns the lowercase hex sha256 digest of `input`.
 * Accepts a string (UTF-8 encoded) or a Buffer.
 */
export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Returns the first `len` characters of `hash`.
 * Useful for building human-readable short identifiers.
 */
export function short(hash: string, len = 12): string {
  return hash.slice(0, len);
}

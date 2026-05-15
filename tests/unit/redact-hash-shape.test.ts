/**
 * S9 — Hash-shape filter tests for the entropy pass.
 *
 * A pure hex string whose length is exactly 32 (md5), 40 (sha1), 64 (sha256),
 * or 128 (sha512) is NOT redacted by the entropy pass — these are recognizable
 * hash shapes, not secrets. See apply-progress S2.D5 for the design rationale.
 *
 * Rule-based matches that happen to be hex (e.g. some token formats) are still
 * redacted — only the generic entropy pass is affected by the hash-shape filter.
 */

import { describe, it, expect } from "vitest";
import { redact } from "../../src/redact/index.js";

// Known hash values (deterministic outputs, safe to hardcode in tests).
// sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
// md5("hello")    = 5d41402abc4b2a76b9719d911017c592
// sha1("hello")   = aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
// sha512("hello") = 9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adf9444ad490eef85

const SHA256_HELLO = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"; // 64 hex
const MD5_HELLO    = "5d41402abc4b2a76b9719d911017c592";                                 // 32 hex
const SHA1_HELLO   = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d";                         // 40 hex
const SHA512_HELLO =
  "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca7" +
  "2323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adf9444ad490eef85"; // 128 hex

describe("redact — hash-shape filter (entropy pass skip for known hash lengths)", () => {
  it("does NOT redact SHA-256 of 'hello' (64-char hex — recognized hash shape)", () => {
    const input = `hash: ${SHA256_HELLO}`;
    const result = redact(input);
    // S2.D5: hash-shape filter — sha256 is now NOT redacted (was flagged in original S2)
    expect(result.hits).toHaveLength(0);
    expect(result.redacted).toBe(input);
  });

  it("does NOT redact MD5 of 'hello' (32-char hex — recognized hash shape)", () => {
    const input = `hash: ${MD5_HELLO}`;
    const result = redact(input);
    expect(result.hits).toHaveLength(0);
    expect(result.redacted).toBe(input);
  });

  it("does NOT redact SHA-1 of 'hello' (40-char hex — recognized hash shape)", () => {
    const input = `hash: ${SHA1_HELLO}`;
    const result = redact(input);
    expect(result.hits).toHaveLength(0);
    expect(result.redacted).toBe(input);
  });

  it("does NOT redact SHA-512 of 'hello' (128-char hex — recognized hash shape)", () => {
    const input = `hash: ${SHA512_HELLO}`;
    const result = redact(input);
    expect(result.hits).toHaveLength(0);
    expect(result.redacted).toBe(input);
  });

  it("DOES redact a 38-char hex blob (not a known hash length — high entropy)", () => {
    // 38 chars: not 32, 40, 64, or 128 → entropy pass fires
    const hexBlob = "c3f8e2a190b457d6f123e789abc456def01234"; // exactly 38 hex chars
    expect(hexBlob.length).toBe(38);
    const input = `token: ${hexBlob}`;
    const result = redact(input);
    expect(result.hits.some((h) => h.ruleId === "high-entropy")).toBe(true);
    expect(result.redacted).not.toContain(hexBlob);
  });

  it("does NOT redact mixed-case hex hash (case-insensitive hash-shape check)", () => {
    // Uppercase SHA-256 should also be recognized as a hash shape
    const upperSha = SHA256_HELLO.toUpperCase();
    const input = `hash: ${upperSha}`;
    const result = redact(input);
    expect(result.hits).toHaveLength(0);
    expect(result.redacted).toBe(input);
  });

  it("does NOT redact mixed-case (alternating) SHA-256 (still pure hex, recognized shape)", () => {
    const mixedSha = SHA256_HELLO.split("").map((c, i) => i % 2 === 0 ? c.toUpperCase() : c).join("");
    const input = `hash: ${mixedSha}`;
    const result = redact(input);
    expect(result.hits).toHaveLength(0);
    expect(result.redacted).toBe(input);
  });

  it("DOES still redact rule-based secrets that happen to be hex (e.g. AWS key)", () => {
    // Ensure the hash-shape filter does NOT exempt rule-matched secrets.
    // AWS key AKIAIOSFODNN7EXAMPLE is 20 chars and caught by rule, not entropy.
    const input = "aws=AKIAIOSFODNN7EXAMPLE";
    const result = redact(input);
    expect(result.hits.some((h) => h.ruleId === "aws-access-key-id")).toBe(true);
  });

  it("DOES redact a high-entropy non-hex token of arbitrary length >= 20 (no hash-shape exemption)", () => {
    // This base64 token is high entropy but NOT pure hex — never exempted
    const base64Token = "xK9mP2nR5sT8vW1yZ3bC6dF0gH4jL7oQ";
    expect(base64Token.length).toBeGreaterThanOrEqual(20);
    const input = `token=${base64Token}`;
    const result = redact(input);
    // Must be caught by entropy pass
    expect(result.hits.length).toBeGreaterThan(0);
  });
});

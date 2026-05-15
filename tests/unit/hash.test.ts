import { describe, it, expect } from "vitest";
import { sha256, short } from "../../src/util/hash.js";

describe("sha256", () => {
  it("produces the known sha256 of an empty string", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("produces the known sha256 of 'hello world'", () => {
    expect(sha256("hello world")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
  });

  it("returns a stable value across two calls with the same input", () => {
    const input = "logbook stable hash test";
    expect(sha256(input)).toBe(sha256(input));
  });

  it("accepts a Buffer input", () => {
    const buf = Buffer.from("hello world", "utf8");
    expect(sha256(buf)).toBe(sha256("hello world"));
  });
});

describe("short", () => {
  it("returns the first 12 characters of a hash by default", () => {
    const h = sha256("hello world");
    expect(short(h)).toBe(h.slice(0, 12));
    expect(short(h)).toHaveLength(12);
  });

  it("respects a custom length argument", () => {
    const h = sha256("hello world");
    expect(short(h, 8)).toHaveLength(8);
    expect(short(h, 8)).toBe(h.slice(0, 8));
  });
});

import { describe, it, expect } from "vitest";
import { redact } from "../../src/redact/index.js";

// ---------------------------------------------------------------------------
// POSITIVE CASES — must be redacted
// ---------------------------------------------------------------------------

describe("redact — positive cases (secrets must be replaced)", () => {
  it("redacts an AWS access key ID", () => {
    const input = "My key is AKIAIOSFODNN7EXAMPLE here";
    const result = redact(input);
    expect(result.redacted).toContain("[REDACTED:aws-access-key-id]");
    expect(result.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.ruleId).toBe("aws-access-key-id");
    expect(result.count).toBe(1);
  });

  it("redacts a GitHub PAT (classic)", () => {
    const input = "token=ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    const result = redact(input);
    expect(result.redacted).toContain("[REDACTED:github-pat-classic]");
    expect(result.redacted).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
    expect(result.hits[0]?.ruleId).toBe("github-pat-classic");
  });

  it("redacts an Anthropic API key", () => {
    // Realistic 80+ char Anthropic key pattern
    const secret = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab-cde";
    const input = `Authorization: Bearer ${secret}`;
    const result = redact(input);
    expect(result.redacted).toContain("[REDACTED:anthropic-api-key]");
    expect(result.redacted).not.toContain(secret);
    expect(result.hits[0]?.ruleId).toBe("anthropic-api-key");
  });

  it("redacts an OpenAI API key and does NOT match stripe-secret-key-live", () => {
    // Must NOT start with sk_live_ — that is Stripe territory
    const secret = "sk-abcdefghij1234567890ABCDEFGHIJabcdefgh";
    const input = `OPENAI_API_KEY=${secret}`;
    const result = redact(input);
    // Must be redacted by openai-api-key (or high-entropy at worst), never by stripe
    expect(result.redacted).not.toContain(secret);
    const stripeHit = result.hits.find((h) => h.ruleId === "stripe-secret-key-live");
    expect(stripeHit).toBeUndefined();
  });

  it("redacts a Stripe live secret key", () => {
    const secret = "sk_live_abcdefghijklmnopqrstuvwx";
    const input = `STRIPE_SECRET_KEY=${secret}`;
    const result = redact(input);
    expect(result.redacted).toContain("[REDACTED:stripe-secret-key-live]");
    expect(result.redacted).not.toContain(secret);
    expect(result.hits[0]?.ruleId).toBe("stripe-secret-key-live");
  });

  it("redacts a JWT (3-segment dot-separated base64url token)", () => {
    // Realistic JWT shape: header.payload.signature (all base64url)
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const input = `Authorization: Bearer ${jwt}`;
    const result = redact(input);
    expect(result.redacted).toContain("[REDACTED:jwt]");
    expect(result.redacted).not.toContain(jwt);
    expect(result.hits.some((h) => h.ruleId === "jwt")).toBe(true);
  });

  it("redacts a PEM private key block (multiline, embedded in larger text)", () => {
    const input = `Some preamble text.
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtEsHAAAAAA==
-----END RSA PRIVATE KEY-----
And some trailing text after the key.`;
    const result = redact(input);
    expect(result.redacted).toContain("[REDACTED:pem-private-key]");
    expect(result.redacted).not.toContain("MIIEpAIBAAKCAQEA");
    expect(result.redacted).toContain("Some preamble text.");
    expect(result.redacted).toContain("And some trailing text after the key.");
    expect(result.hits.some((h) => h.ruleId === "pem-private-key")).toBe(true);
  });

  it("redacts a high-entropy generic token (no specific rule match)", () => {
    // 38-char hex blob — NOT a known hash length (32/40/64/128), so the
    // hash-shape filter (S2.D5) does NOT exempt it. Entropy pass fires.
    const hexBlob = "c3f8e2a190b457d6f123e789abc456def01234"; // exactly 38 chars
    expect(hexBlob.length).toBe(38);
    const input = `Some config value: ${hexBlob} other text`;
    const result = redact(input);
    expect(result.redacted).toContain("[REDACTED:high-entropy]");
    expect(result.redacted).not.toContain(hexBlob);
    expect(result.hits.some((h) => h.ruleId === "high-entropy")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE CASES — must NOT be redacted (except SHA-256 which is documented)
// ---------------------------------------------------------------------------

describe("redact — negative cases (benign values must pass through)", () => {
  it("does NOT redact a UUID (low entropy due to format)", () => {
    // UUIDs use hyphens as structural separators. The entropy scanner excludes
    // hyphens from the token character class, so each UUID segment is treated
    // as a separate token (e.g. "e89b" is only 4 chars — below minEntropyLength=20).
    // None of the segments individually reach the threshold.
    const input = "session id: 123e4567-e89b-12d3-a456-426614174000";
    const result = redact(input);
    expect(result.redacted).toBe(input);
    expect(result.hits).toHaveLength(0);
  });

  it("does NOT redact SHA-256 of 'hello' (hash-shape filter, S2.D5)", () => {
    // S9 retro-touch: added hash-shape filter to entropy pass.
    // Pure hex strings of exact known hash lengths (32/40/64/128 chars) are
    // recognized as content hashes, not secrets. See apply-progress S2.D5.
    const sha256Hello = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    const input = `hash: ${sha256Hello}`;
    const result = redact(input);
    // ASSERT: must NOT be flagged — hash-shape filter exempts it
    expect(result.hits).toHaveLength(0);
    expect(result.redacted).toBe(input);
  });

  it("does NOT redact a plain filename", () => {
    const input = "src/components/Button.tsx";
    const result = redact(input);
    expect(result.redacted).toBe(input);
    expect(result.hits).toHaveLength(0);
  });

  it("does NOT redact a plain English sentence", () => {
    const input = "This is a normal English sentence with no secrets in it at all.";
    const result = redact(input);
    expect(result.redacted).toBe(input);
    expect(result.hits).toHaveLength(0);
  });

  it("does NOT redact a short token (under minEntropyLength)", () => {
    // "abc123" is 6 chars — well below the default minEntropyLength of 20
    const input = "code: abc123";
    const result = redact(input);
    expect(result.redacted).toBe(input);
    expect(result.hits).toHaveLength(0);
  });

  it("does NOT redact long absolute file paths (slice-17 regression guard)", () => {
    // Pre-slice-17 the entropy regex included `/`, so a path like
    // `fernandez/Documents/CONSTRUCCION` (35+ chars contiguous via /) matched
    // and produced false-positive `[REDACTED:high-entropy]` chunks inside
    // otherwise harmless absolute paths in tool_input.file_path. The regex
    // now excludes `/`, so each `/`-delimited segment is its own short token.
    const input =
      "/Users/joseluis.fernandez/Documents/CONSTRUCCION FORMACION IA B2B/LogBook-repo/src/export/markdown-to-html.ts";
    const result = redact(input);
    expect(result.redacted).toBe(input);
    expect(result.hits).toHaveLength(0);
  });

  it("does NOT redact MCP tool names (mcp-tool-rendering regression guard)", () => {
    // The entropy regex includes `_` and the `mcp__server__tool` convention
    // produces long underscore-dense tokens that score >= 3.5 entropy. Before
    // the `mcp__` prefix exemption, every MCP tool name EXCEPT
    // `mcp__plugin_engram_engram__mem_save` (whose entropy is 3.4857, just
    // under threshold) was shredded to `[REDACTED:high-entropy]`, so the HTML
    // export could only render `engram · mem_save` chips and dropped the names
    // of mem_search, mem_get_observation, context7, magic, etc.
    const names = [
      "mcp__plugin_engram_engram__mem_save",
      "mcp__plugin_engram_engram__mem_search",
      "mcp__plugin_engram_engram__mem_get_observation",
      "mcp__plugin_engram_engram__mem_session_summary",
      "mcp__context7__query-docs",
      "mcp__context7__resolve-library-id",
      "mcp__magic__21st_magic_component_builder",
    ];
    for (const name of names) {
      const result = redact(name);
      expect(result.redacted).toBe(name);
      expect(result.redacted).not.toContain("[REDACTED");
    }
  });
});

// ---------------------------------------------------------------------------
// MULTIPLE HITS
// ---------------------------------------------------------------------------

describe("redact — multiple hits in one input", () => {
  it("redacts both an AWS key and a GitHub PAT in the same string", () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    const ghPat = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    const input = `aws=${awsKey} gh=${ghPat} benign text here`;
    const result = redact(input);

    expect(result.hits).toHaveLength(2);
    expect(result.count).toBe(2);

    // Both secrets replaced
    expect(result.redacted).not.toContain(awsKey);
    expect(result.redacted).not.toContain(ghPat);

    // Surrounding benign text preserved
    expect(result.redacted).toContain("benign text here");

    // Hits are in order by start position
    const h0 = result.hits[0];
    const h1 = result.hits[1];
    expect(h0).toBeDefined();
    expect(h1).toBeDefined();
    if (h0 !== undefined && h1 !== undefined) {
      expect(h0.start).toBeLessThan(h1.start);
    }

    // Correct rule IDs
    const ruleIds = result.hits.map((h) => h.ruleId);
    expect(ruleIds).toContain("aws-access-key-id");
    expect(ruleIds).toContain("github-pat-classic");
  });
});

// ---------------------------------------------------------------------------
// OVERLAP HANDLING
// ---------------------------------------------------------------------------

describe("redact — overlap handling", () => {
  it("produces valid output even if two rules could match the same span", () => {
    // The Anthropic key could also match the generic openai sk- rule.
    // Overlap merge ensures only one redaction marker, no malformed output.
    const secret = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab-cd";
    const input = `key=${secret}`;
    const result = redact(input);

    // No raw secret in output
    expect(result.redacted).not.toContain(secret);

    // Output is syntactically valid (balanced REDACTED markers)
    const openBrackets = (result.redacted.match(/\[REDACTED:/g) ?? []).length;
    const closeBrackets = (result.redacted.match(/\]/g) ?? []).length;
    expect(openBrackets).toBe(closeBrackets);

    // Hit spans do not overlap in the final merged output
    for (let i = 1; i < result.hits.length; i++) {
      const prev = result.hits[i - 1];
      const cur = result.hits[i];
      if (prev !== undefined && cur !== undefined) {
        expect(cur.start).toBeGreaterThanOrEqual(prev.end);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PURITY / DETERMINISM
// ---------------------------------------------------------------------------

describe("redact — pure function / determinism", () => {
  it("returns deeply equal results on two calls with the same input", () => {
    const input = "aws=AKIAIOSFODNN7EXAMPLE token=ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    const r1 = redact(input);
    const r2 = redact(input);

    expect(r1.redacted).toBe(r2.redacted);
    expect(r1.count).toBe(r2.count);
    expect(r1.hits).toHaveLength(r2.hits.length);
    for (let i = 0; i < r1.hits.length; i++) {
      const h1 = r1.hits[i];
      const h2 = r2.hits[i];
      if (h1 !== undefined && h2 !== undefined) {
        expect(h1.ruleId).toBe(h2.ruleId);
        expect(h1.start).toBe(h2.start);
        expect(h1.end).toBe(h2.end);
      }
    }
  });
});

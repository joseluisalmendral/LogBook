/**
 * Pure redaction pipeline.
 *
 * This module is intentionally free of I/O, Math.random, and side effects.
 * Calling redact() twice with identical input always returns identical output.
 *
 * NOTE: replacement tokens ([REDACTED:<ruleId>]) do NOT preserve byte length.
 * Original byte length is not part of the contract — only redaction completeness is.
 */

import { GITLEAKS_RULES } from "./gitleaks-rules.js";
import { shannonEntropy } from "./entropy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedactionHit {
  /** Rule id that matched, or "high-entropy" for the entropy pass */
  ruleId: string;
  /** Byte offset in the original text (start, inclusive) */
  start: number;
  /** Byte offset in the original text (end, exclusive) */
  end: number;
  /**
   * The secret span from the original text.
   * USED ONLY FOR TEST DEBUG — never persisted to disk.
   */
  original: string;
}

export interface RedactionResult {
  /** Text with secrets replaced by [REDACTED:<ruleId>] */
  redacted: string;
  /** All detected hits (sorted by start, overlaps merged) */
  hits: RedactionHit[];
  /** hits.length — convenience field */
  count: number;
}

export interface RedactOptions {
  /**
   * Minimum token length in characters for the entropy pass.
   * Tokens shorter than this are never flagged as high-entropy.
   * Default: 20
   */
  minEntropyLength?: number;
  /**
   * Entropy threshold for the generic high-entropy pass.
   * Tokens with Shannon entropy >= this value are flagged.
   * Default: 3.5
   */
  entropyThreshold?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Token pattern for the generic entropy pass — contiguous "secret-looking" chars.
 *
 * Intentionally excludes `-` (hyphen) to prevent UUIDs (which use hyphens as
 * structural separators) from being treated as single long tokens. A UUID like
 * "123e4567-e89b-12d3-a456-426614174000" has 5 hyphen-separated segments, each
 * shorter than the minEntropyLength threshold.
 *
 * Slice-17: `/` removed (was: `[A-Za-z0-9+/=_]`). Long absolute file paths like
 * `fernandez/Documents/CONSTRUCCION` were matching this pattern and tripping
 * the entropy pass, producing `[REDACTED:high-entropy]` chunks inside otherwise
 * harmless paths. Real secrets that contain `/`:
 *   - AWS secret access keys (20+ chars with /+=) — caught by AWS-specific
 *     Gitleaks rules first; this entropy pass is a fallback.
 *   - Plain base64 (uses `+/=`) — modern secrets use base64url with `-_` instead.
 * Keeping `+=_` preserves base64-padded / underscore-separated detection.
 */
const ENTROPY_TOKEN_RE = /[A-Za-z0-9+=_]{20,}/g;

/**
 * Collect all regex matches from `text` as RedactionHit objects.
 * Resets lastIndex before and after use so the rule can be reused.
 */
function collectRuleHits(text: string, ruleId: string, pattern: RegExp, minEntropy?: number): RedactionHit[] {
  const hits: RedactionHit[] = [];
  // Always reset lastIndex — the caller may have used this regex elsewhere
  pattern.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const match = m[0];
    // Apply per-rule entropy filter if configured
    if (minEntropy !== undefined && shannonEntropy(match) < minEntropy) {
      continue;
    }
    hits.push({
      ruleId,
      start: m.index,
      end: m.index + match.length,
      original: match,
    });
  }

  pattern.lastIndex = 0;
  return hits;
}

/**
 * Sort hits by start position, then merge overlapping or adjacent ranges.
 * When two hits overlap, keep the one that started earlier (first rule wins).
 */
function mergeHits(hits: RedactionHit[]): RedactionHit[] {
  if (hits.length === 0) return [];

  const sorted = [...hits].sort((a, b) => a.start - b.start || a.end - b.end);
  const first = sorted[0];
  if (first === undefined) return [];

  const merged: RedactionHit[] = [first];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === undefined) continue;

    const last = merged[merged.length - 1];
    if (last === undefined) {
      merged.push(cur);
      continue;
    }

    if (cur.start < last.end) {
      // Overlap — extend the existing hit's end if the new one is longer,
      // but keep the ruleId of the first match (rule ordering matters)
      if (cur.end > last.end) {
        merged[merged.length - 1] = {
          ruleId: last.ruleId,
          start: last.start,
          end: cur.end,
          original: last.original, // preserve original from first match
        };
      }
      // else: current hit is fully contained — skip it
    } else {
      merged.push(cur);
    }
  }

  return merged;
}

/**
 * Build a set of covered ranges from a list of hits, for use in the
 * entropy pass to skip already-matched spans.
 */
function buildCoveredSet(hits: RedactionHit[]): Array<[number, number]> {
  return hits.map((h) => [h.start, h.end]);
}

/**
 * Returns true if [start, end) overlaps any range in `covered`.
 */
function isCovered(start: number, end: number, covered: Array<[number, number]>): boolean {
  return covered.some(([cs, ce]) => start < ce && end > cs);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Redact secrets from `input` using the Gitleaks rule set plus a generic
 * Shannon entropy pass for unknown high-entropy tokens.
 *
 * Pure function — no I/O, no side effects, deterministic.
 */
export function redact(input: string, opts: RedactOptions = {}): RedactionResult {
  const minEntropyLength = opts.minEntropyLength ?? 20;
  const entropyThreshold = opts.entropyThreshold ?? 3.5;

  // ---- Pass 1: Rule-based matching ----------------------------------------
  const ruleHits: RedactionHit[] = [];

  for (const rule of GITLEAKS_RULES) {
    const hits = collectRuleHits(input, rule.id, rule.pattern, rule.minEntropy);
    ruleHits.push(...hits);
  }

  // Merge overlapping rule hits (sort + sweep)
  const mergedRuleHits = mergeHits(ruleHits);

  // ---- Pass 2: Entropy-based matching on remaining text -------------------
  const covered = buildCoveredSet(mergedRuleHits);
  const entropyHits: RedactionHit[] = [];

  // Hash-shape filter: pure hex strings whose length matches a known hash output
  // (md5=32, sha1=40, sha256=64, sha512=128) are almost certainly content hashes,
  // not secrets. Skip entropy redaction for these. See apply-progress S2.D5.
  //
  // The entropy regex includes `=` and `_` so a token like "hash=<sha256>" is
  // extracted as one unit. We therefore also check the value portion after the
  // last `=` sign when the token itself is not pure hex.
  const HASH_HEX_RE = /^[a-f0-9]+$/i;
  const KNOWN_HASH_LENGTHS = new Set([32, 40, 64, 128]);

  // Slice-26: tool_use_id values are NOT secrets — they're internal API
  // ids that downstream code uses to JOIN tool_use ↔ tool_result events
  // during hook ↔ scraper dedup. Without this exception the entropy regex
  // shreds them (`toolu_01...` is base64-shaped) and the dedup fails,
  // producing duplicate tool_result entries on every re-scrape.
  //
  // Stable shape: `toolu_` followed by ~22 base64-url chars. Anthropic
  // documents this prefix in the Messages API; it has been stable for
  // years.
  const TOOL_USE_ID_RE = /^toolu_[A-Za-z0-9]{8,}$/;

  ENTROPY_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTROPY_TOKEN_RE.exec(input)) !== null) {
    const token = m[0];
    const start = m.index;
    const end = start + token.length;

    // Skip tokens shorter than the minimum length (already filtered by regex
    // quantifier {20,} but guard here for explicit opts.minEntropyLength)
    if (token.length < minEntropyLength) continue;

    // Skip spans already claimed by a specific rule
    if (isCovered(start, end, covered)) continue;

    // Hash-shape filter: skip tokens that are (or end with) a pure hex value of
    // a known hash output length. Handles both standalone hashes and key=hash
    // patterns (e.g. "hash=<sha256>") because the entropy regex includes `=`.
    // Only applies to the entropy pass — rule-based hits are never exempted.
    const hashCandidate = token.includes("=") ? token.split("=").pop() ?? token : token;
    if (KNOWN_HASH_LENGTHS.has(hashCandidate.length) && HASH_HEX_RE.test(hashCandidate)) {
      continue;
    }

    // Slice-26: skip Anthropic tool_use_id tokens — they are JOIN keys, not
    // secrets. See the comment on TOOL_USE_ID_RE above.
    if (TOOL_USE_ID_RE.test(token)) continue;

    if (shannonEntropy(token) >= entropyThreshold) {
      entropyHits.push({
        ruleId: "high-entropy",
        start,
        end,
        original: token,
      });
    }
  }
  ENTROPY_TOKEN_RE.lastIndex = 0;

  // ---- Combine, merge, sort -----------------------------------------------
  const allHits = mergeHits([...mergedRuleHits, ...entropyHits]);

  // ---- Build redacted string -----------------------------------------------
  // Process ranges from right to left so earlier indices stay valid
  let redacted = input;
  const hitsRtl = [...allHits].sort((a, b) => b.start - a.start);

  for (const hit of hitsRtl) {
    const marker = `[REDACTED:${hit.ruleId}]`;
    redacted = redacted.slice(0, hit.start) + marker + redacted.slice(hit.end);
  }

  return {
    redacted,
    hits: allHits,
    count: allHits.length,
  };
}

/**
 * Shannon entropy calculation for secret detection.
 *
 * Used by the redaction pipeline to flag high-entropy token candidates
 * that do not match any known rule pattern.
 */

/**
 * Computes the Shannon entropy of a string in bits per symbol.
 *
 * H = -Σ p(x) * log2(p(x))
 *
 * Returns 0 for empty strings or strings with a single distinct character.
 * Returns higher values for strings with more uniform character distributions
 * (e.g., random hex, base64 secrets).
 */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;

  // Count occurrences of each character
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }

  const len = s.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

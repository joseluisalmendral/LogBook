export type LineEnding = "lf" | "crlf" | "mixed";

export function detectLineEnding(source: string): LineEnding {
  const hasCRLF = /\r\n/.test(source);
  // Lookbehind asserts the \n is NOT immediately preceded by \r — i.e., a lone LF.
  const hasLoneLF = /(?<!\r)\n/.test(source);
  if (hasCRLF && hasLoneLF) return "mixed";
  if (hasCRLF) return "crlf";
  return "lf"; // includes empty string and content with no line terminators
}

export function toLF(source: string): { content: string; original: LineEnding } {
  const original = detectLineEnding(source);
  return { content: source.replace(/\r\n/g, "\n"), original };
}

export function fromLF(content: string, target: LineEnding): string {
  if (target === "crlf") return content.replace(/\n/g, "\r\n");
  if (target === "lf") return content;
  // mixed: best-effort — emit as LF; installer records a warning at write time
  return content;
}

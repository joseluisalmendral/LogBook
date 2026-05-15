/** Detected indentation style of a source file. "unknown" when input is empty or ambiguous. */
export type IndentStyle = "tab" | "2-space" | "4-space" | "unknown";

/**
 * Heuristic indent detection. Scans the first 200 lines that start with
 * whitespace and returns the majority style. Used for cosmetic insertion
 * alignment — NOT for round-trip serialization.
 *
 * Tiebreak: 2-space wins over 4-space (lower indentation is more common).
 */
export function detectIndent(source: string): IndentStyle {
  if (source === "") return "unknown";

  const lines = source.split("\n");
  let tabs = 0;
  let twoSpace = 0;
  let fourSpace = 0;
  let scanned = 0;

  for (const line of lines) {
    if (scanned >= 200) break;
    if (line.length === 0) continue;
    const ch = line[0];
    if (ch !== " " && ch !== "\t") continue;

    scanned++;
    if (ch === "\t") {
      tabs++;
    } else {
      // Count leading spaces
      let count = 0;
      for (let i = 0; i < line.length && line[i] === " "; i++) count++;
      if (count % 4 === 0 && count >= 4) {
        fourSpace++;
      } else if (count % 2 === 0 && count >= 2) {
        twoSpace++;
      }
      // Odd-space lines don't count toward any category
    }
  }

  if (scanned === 0) return "unknown";

  const max = Math.max(tabs, twoSpace, fourSpace);
  if (max === 0) return "unknown";

  // On tie, prefer 2-space over 4-space, and tab over space (tab is unambiguous)
  if (tabs === max) return "tab";
  if (twoSpace === max) return "2-space";
  return "4-space";
}

/**
 * Returns the actual indent string (for insertion) given a detected style.
 * Falls back to two spaces on "unknown".
 */
export function indentString(style: IndentStyle): string {
  switch (style) {
    case "tab":
      return "\t";
    case "4-space":
      return "    ";
    case "2-space":
    case "unknown":
    default:
      return "  ";
  }
}

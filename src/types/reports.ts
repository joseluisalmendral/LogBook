/**
 * Structured output types for CLI commands that support --json flag (T11).
 */

export interface BuildReport {
  /** Generated files with byte count and sha256 digest. */
  generated: Array<{
    file: string;
    bytes: number;
    sha256: string;
  }>;
  /** Files where content outside the generated block was preserved. */
  preserved: string[];
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

export interface ExportReport {
  /** Absolute path to the generated HTML file. */
  outFile: string;
  /** File size in bytes. */
  bytes: number;
  /** Number of external references found (must be 0). */
  externalRefs: number;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

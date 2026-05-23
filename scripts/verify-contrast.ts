/*
 * verify-contrast.ts — WCAG AA contrast verifier for the export-ui themes (P5, AG-18).
 *
 * Resolves the semantic tokens from `apps/export-ui/src/lib/tokens/` into
 * concrete hex pairs and asserts every text-on-surface combination meets WCAG
 * AA contrast:
 *
 *   - 4.5:1 for body text (< 18px or < 14px bold)
 *   - 3.0:1 for large text (≥ 18px regular or ≥ 14px bold) and UI components
 *
 * Reads BOTH light and dark theme blocks. Emits a markdown report at
 * /tmp/lb-p5-contrast-report.md and exits non-zero if any pair fails.
 *
 * Uses `color-contrast-checker` (installed as a P5 dev dep). The library
 * exposes `.isLevelAA(hexFg, hexBg, fontSize)` returning a boolean.
 *
 * Spec: AG-18, R-38, INV-4.
 */

import { writeFileSync } from "node:fs";
import ColorContrastChecker from "color-contrast-checker";

interface Pair {
  label: string;
  fg: string;
  bg: string;
  /** Effective font size in pixels — used to decide between 4.5:1 (small) and 3.0:1 (large/UI). */
  size: number;
}

/**
 * Resolved hex values from `apps/export-ui/src/lib/tokens/semantic{,-dark}.css`
 * and the primitive layer. We hard-code them here rather than parse the CSS
 * cascade because (a) the source of truth is reviewed when these change and
 * (b) the script is meant to run BEFORE the UI bundle so a CSS parse would
 * recreate the cascade resolver from scratch. Each value carries its primitive
 * comment for auditability.
 */
const LIGHT = {
  surface: "#FAF8F4",          // p-cream-50
  surfaceRaised: "#FFFFFF",    // p-cream-25
  surfaceSunken: "#F1EEE8",    // p-cream-100
  textPrimary: "#1A1A1F",      // p-graphite-900
  textSecondary: "#5C5C66",    // p-graphite-600
  textTertiary: "#8C8C96",     // p-graphite-400 (large-text only)
  accentPrimary: "#1E3A5F",    // p-navy-700
  accentSecondary: "#9C5226",  // p-terracotta-600
  success: "#2F6B47",          // p-sage-600
  error: "#A33B2A",            // p-brick-600
  decision: "#5B3A8C",         // p-plum-700
  question: "#8C5E1F",         // p-gold-700
};

const DARK = {
  surface: "#0F1014",          // p-ink-950
  surfaceRaised: "#1A1B22",    // p-ink-900
  surfaceSunken: "#070809",    // p-ink-1000
  textPrimary: "#F0EDE6",      // p-paper-50
  textSecondary: "#A8A4A0",    // p-paper-400
  textTertiary: "#6E6B68",     // p-paper-600 (large-text only)
  accentPrimary: "#5B8FD9",    // p-navy-400
  accentSecondary: "#D8824A",  // p-terracotta-400
  success: "#5BB07A",          // p-sage-400
  error: "#E66854",            // p-brick-400
  decision: "#A580E0",         // p-plum-400
  question: "#D9A85C",         // p-gold-400
};

function pairs(mode: "light" | "dark"): Pair[] {
  const t = mode === "light" ? LIGHT : DARK;
  // Body text uses 16px → AA Normal threshold (4.5). Large/heading at 24px.
  // UI components / status accents tested at 14px (still AA Normal — strict).
  return [
    { label: "Body text on surface",        fg: t.textPrimary,   bg: t.surface,       size: 16 },
    { label: "Body text on surface-raised", fg: t.textPrimary,   bg: t.surfaceRaised, size: 16 },
    { label: "Secondary text on surface",   fg: t.textSecondary, bg: t.surface,       size: 16 },
    // Tertiary is REQUIRED only for large text (≥18px) — test at 18 to honor design intent.
    { label: "Tertiary text (large only)",  fg: t.textTertiary,  bg: t.surface,       size: 18 },
    { label: "Link / accent-primary",       fg: t.accentPrimary, bg: t.surfaceRaised, size: 16 },
    { label: "Decision label",              fg: t.decision,      bg: t.surface,       size: 14 },
    { label: "Error label",                 fg: t.error,         bg: t.surface,       size: 14 },
    { label: "Success label",               fg: t.success,       bg: t.surface,       size: 14 },
    { label: "Question/Fork label",         fg: t.question,      bg: t.surface,       size: 14 },
    { label: "Lesson/Resource accent",      fg: t.accentSecondary, bg: t.surface,     size: 14 },
  ];
}

/**
 * WCAG 2.1 relative luminance contrast ratio.
 * Hand-rolled so we don't depend on the library's internals (it lacks a
 * "return the numeric ratio" public method on every version line).
 */
function relLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

interface Row {
  mode: "light" | "dark";
  label: string;
  fg: string;
  bg: string;
  size: number;
  ratio: number;
  threshold: number;
  pass: boolean;
}

function evaluate(mode: "light" | "dark", pair: Pair, ccc: ColorContrastChecker): Row {
  const ratio = contrastRatio(pair.fg, pair.bg);
  // WCAG: ≥ 4.5 normal; ≥ 3.0 large text (≥ 18px regular or ≥ 14px bold) or UI.
  const isLarge = pair.size >= 18;
  const threshold = isLarge ? 3.0 : 4.5;
  // Cross-check against the library — defense in depth; the library returns
  // a boolean and we use it as a second opinion.
  const libPass = ccc.isLevelAA(pair.fg, pair.bg, pair.size);
  const pass = ratio >= threshold && libPass;
  return { mode, label: pair.label, fg: pair.fg, bg: pair.bg, size: pair.size, ratio, threshold, pass };
}

function formatReport(rows: Row[]): string {
  const lines: string[] = [];
  lines.push("# P5 WCAG AA contrast report — export-ui themes");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  for (const mode of ["light", "dark"] as const) {
    lines.push(`## ${mode === "light" ? "Light" : "Dark"} mode`);
    lines.push("");
    lines.push("| Pair | Foreground | Background | Size | Threshold | Ratio | Result |");
    lines.push("|------|-----------|------------|------|-----------|-------|--------|");
    for (const r of rows.filter((x) => x.mode === mode)) {
      lines.push(
        `| ${r.label} | \`${r.fg}\` | \`${r.bg}\` | ${r.size}px | ${r.threshold.toFixed(1)}:1 | ${r.ratio.toFixed(2)}:1 | ${r.pass ? "PASS" : "FAIL"} |`,
      );
    }
    lines.push("");
  }
  const failing = rows.filter((r) => !r.pass);
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`- Total pairs checked: ${rows.length}`);
  lines.push(`- Passing: ${rows.length - failing.length}`);
  lines.push(`- Failing: ${failing.length}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const ccc = new ColorContrastChecker();
  const rows: Row[] = [];
  for (const mode of ["light", "dark"] as const) {
    for (const p of pairs(mode)) rows.push(evaluate(mode, p, ccc));
  }
  const report = formatReport(rows);
  const outPath = "/tmp/lb-p5-contrast-report.md";
  writeFileSync(outPath, report, "utf8");

  // eslint-disable-next-line no-console
  console.log(report);
  // eslint-disable-next-line no-console
  console.log(`\nReport written to ${outPath}`);

  const failing = rows.filter((r) => !r.pass);
  if (failing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\nWCAG AA FAILURES: ${failing.length}`);
    process.exit(1);
  }
}

void main();

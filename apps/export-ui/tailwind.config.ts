import type { Config } from "tailwindcss";

// Tailwind 3.4 — PIN. NOT 4.x (risk #1 from proposal).
//
// Token strategy (design §6.2 + ADR-6):
//   - Tokens live as CSS variables in src/lib/tokens/*.css.
//   - Tailwind's theme.extend.colors maps semantic names → var(--color-*).
//   - A single [data-theme="dark"] attribute swap on <html> re-resolves every utility.
//   - Token CSS files MUST be imported BEFORE @tailwind base (risk D6 / smoke #4).
//
// Safelist (design §6.2): event-kind class names are constructed dynamically in
// Svelte (e.g. `bg-${kind}-50`) and would otherwise be purged.
export default {
  content: ["./index.html", "./src/**/*.{svelte,ts}"],
  // Safelist: event-kind utilities are constructed dynamically in Svelte
  // (e.g. `bg-${kind}` for `kind ∈ {error,decision,...}`) and would otherwise
  // be purged. Our tokens use single-tone CSS vars (no numeric scale), so the
  // utility names are `bg-error`, `text-decision`, etc. — NOT `bg-error-500`.
  safelist: [
    { pattern: /^bg-(error|decision|fix|lesson|question|success|warning|accent|accent-secondary)$/ },
    { pattern: /^text-(error|decision|fix|lesson|question|success|warning|accent|accent-secondary|text-primary|text-secondary|text-tertiary)$/ },
    { pattern: /^border-(error|decision|fix|lesson|question|success|warning|border-hairline)$/ },
  ],
  theme: {
    extend: {
      colors: {
        surface: "var(--color-surface)",
        "surface-raised": "var(--color-surface-raised)",
        "surface-sunken": "var(--color-surface-sunken)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-tertiary": "var(--color-text-tertiary)",
        "border-hairline": "var(--color-border-hairline)",
        accent: "var(--color-accent-primary)",
        "accent-secondary": "var(--color-accent-secondary)",
        success: "var(--color-success)",
        error: "var(--color-error)",
        warning: "var(--color-warning)",
        decision: "var(--color-decision)",
        fix: "var(--color-fix)",
        lesson: "var(--color-lesson)",
        question: "var(--color-question)",
      },
      fontFamily: {
        headline: "var(--font-headline)",
        body: "var(--font-body)",
        mono: "var(--font-mono)",
      },
      fontSize: {
        caption: "var(--font-size-caption)",
        meta: "var(--font-size-meta)",
        body: "var(--font-size-body)",
        lead: "var(--font-size-lead)",
        h3: "var(--font-size-h3)",
        h2: "var(--font-size-h2)",
        h1: "var(--font-size-h1)",
        display: "var(--font-size-display)",
      },
      spacing: {
        "card-pad": "var(--card-padding)",
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
    },
  },
  plugins: [],
} satisfies Config;

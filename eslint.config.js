/**
 * ESLint flat config for LogBook.
 *
 * Key rule: no-restricted-imports bans direct imports of appendJsonl from
 * src/store/jsonl.ts outside src/store/. All writes to events.jsonl MUST go
 * through appendEvent in src/store/index.ts.
 *
 * One annotated exception: src/mcp/tools/suggest.ts writes to
 * pending-suggestions.jsonl (NOT events.jsonl) and keeps its direct import.
 * That file carries an // EXCEPTION: non-events.jsonl write comment on the
 * import line.
 *
 * Static enforcement is ALSO covered by the grep-based vitest guard at
 * tests/unit/store-no-direct-appendJsonl.test.ts — which works without ESLint
 * being installed and runs on every `pnpm test`.
 */

export default [
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Relative imports targeting store/jsonl directly from outside src/store/
              group: ["**/store/jsonl", "**/store/jsonl.js"],
              message:
                "Direct appendJsonl imports are banned outside src/store/. " +
                "Use appendEvent from src/store/index.ts instead. " +
                "Exception: src/mcp/tools/suggest.ts (pending-suggestions.jsonl, non-events write).",
            },
          ],
        },
      ],
    },
  },
  {
    // Allowlist: src/store/ itself may import from ./jsonl freely.
    files: ["src/store/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

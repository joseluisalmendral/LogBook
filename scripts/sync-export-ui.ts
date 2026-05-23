/*
 * sync-export-ui.ts — P5 production version.
 *
 * Reads apps/export-ui/dist/index.html and emits src/export/ui-bundle.ts so
 * the CLI can ship the single-file HTML template without re-running Vite at
 * `logbook export html` time (design §6.3).
 *
 * Emitted file exports:
 *   - UI_BUNDLE: string         the vendored HTML
 *   - UI_BUNDLE_SHA256: string  SHA-256 hex digest (for the CI byte-diff gate, AG-12)
 *
 * Escape strategy: JSON.stringify handles backticks, ${}, newlines, control
 * chars, and the </script> sequence (it escapes "/" only when it precedes
 * "script"-like patterns in JSON strings — that's actually NOT JSON's job;
 * we handle </script> separately in src/export/html.ts at INJECTION time by
 * escaping it in the payload JSON, not here in the bundle).
 *
 * Spec references: R-5, R-46, R-47, AG-12, S-14.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SOURCE = resolve(REPO_ROOT, "apps/export-ui/dist/index.html");
const TARGET = resolve(REPO_ROOT, "src/export/ui-bundle.ts");

if (!existsSync(SOURCE)) {
  // eslint-disable-next-line no-console
  console.error(
    `[sync-export-ui] missing ${SOURCE} — run \`pnpm --filter export-ui build\` first.`,
  );
  process.exit(1);
}

const html = readFileSync(SOURCE, "utf8");
const sha256 = createHash("sha256").update(html, "utf8").digest("hex");
const payload = JSON.stringify(html);
const generatedAt = new Date().toISOString();

const body = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: apps/export-ui/dist/index.html
// Regenerate via: pnpm sync:export-ui
// Generated at: ${generatedAt}
// SHA-256: ${sha256}
//
// Spec: R-5, R-42, R-46, AG-12, S-14.

export const UI_BUNDLE: string = ${payload};

export const UI_BUNDLE_SHA256: string = "${sha256}";
`;

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, body, "utf8");

// eslint-disable-next-line no-console
console.log(
  `[sync-export-ui] wrote ${TARGET} (${html.length} chars, sha256=${sha256.slice(0, 12)}…)`,
);

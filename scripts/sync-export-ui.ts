/*
 * sync-export-ui.ts — P1 stub.
 *
 * Reads apps/export-ui/dist/index.html and emits src/export/ui-bundle.ts so
 * the CLI can ship a single-file HTML template without rebuilding Vite at
 * `logbook export html` time (design §6.3).
 *
 * THIS IS THE P1 STUB. P5 fleshes it out with:
 *   - SHA-256 hash export for the byte-diff CI gate (AG-12)
 *   - JSON.stringify with </script> escape handling (R-43)
 *   - Wire-up into src/export/html.ts
 *
 * For P1 we keep the stub minimal: read the file, JSON.stringify the
 * content (handles backticks/${}/newlines), emit ui-bundle.ts. The CLI does
 * not yet consume this file — src/export/html.ts remains on its pre-replan
 * path until P5.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
const payload = JSON.stringify(html);

const body = `// GENERATED — do not edit by hand.
// Source: apps/export-ui/dist/index.html
// Regenerate via: pnpm sync:export-ui
//
// P1 stub. P5 will add a SHA-256 byte-diff gate (AG-12) and integrate with
// src/export/html.ts. The CLI does not consume this file yet in P1.

export const UI_BUNDLE: string = ${payload};
`;

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, body, "utf8");

// eslint-disable-next-line no-console
console.log(`[sync-export-ui] wrote ${TARGET} (${html.length} chars)`);

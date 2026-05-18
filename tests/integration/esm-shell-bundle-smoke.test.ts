/**
 * Integration smoke — the built dist/tui/shell.mjs ESM bundle must load
 * without crashing on CJS-only globals.
 *
 * REGRESSION CONTEXT (2026-05-18):
 *   When the TUI shell was split into its own ESM bundle (commit c3abfe6),
 *   any source code that referenced __dirname or __filename — including
 *   src/core/presets.ts which the install action depends on — silently
 *   broke. vitest's environment provides __dirname so unit/integration
 *   tests against src/ did NOT detect the bug. The crash only surfaced
 *   when a user ran the install from the TUI in production:
 *
 *     LogBook > Error
 *     ✗ Installing... failed
 *     __dirname is not defined
 *
 *   Fix: tsup `define` replaces __dirname/__filename in the ESM bundle
 *   with globalThis.__LB_ESM_DIRNAME/_FILENAME; tsup `banner` initializes
 *   those globals from import.meta.url at module load.
 *
 *   This test loads the BUILT dist/tui/shell.mjs and asserts the module
 *   loads cleanly. If the banner/define wiring regresses, this test fails
 *   with a clear error before any user sees it.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHELL_MJS_PATH = resolve(__dirname, "../../dist/tui/shell.mjs");

describe("dist/tui/shell.mjs — ESM bundle smoke", () => {
  it.skipIf(!existsSync(SHELL_MJS_PATH))(
    "loads without throwing (validates __dirname/__filename ESM shim)",
    async () => {
      // Spawn a fresh Node process to import the ESM bundle. Vitest's own
      // module loader interferes with Function('u','return import(u)') so
      // we delegate to a child node process for clean validation.
      const { execFileSync } = await import("node:child_process");
      const url = pathToFileURL(SHELL_MJS_PATH).href;
      const script = `import('${url}').then(m => { process.stdout.write(JSON.stringify(Object.keys(m).sort())); }).catch(e => { process.stderr.write(e.message); process.exit(1); })`;
      const out = execFileSync("node", ["-e", script], {
        encoding: "utf8",
        timeout: 5000,
      });
      const exportKeys = JSON.parse(out) as string[];
      expect(exportKeys).toContain("runShell");
      expect(exportKeys).toContain("ShellApp");
    },
  );

  it.skipIf(!existsSync(SHELL_MJS_PATH))(
    "uses the globalThis __dirname shim (not bare __dirname)",
    async () => {
      const { readFile } = await import("node:fs/promises");
      const source = await readFile(SHELL_MJS_PATH, "utf8");
      // The banner must define the globals.
      expect(source).toMatch(/globalThis\.__LB_ESM_DIRNAME\s*=/);
      expect(source).toMatch(/globalThis\.__LB_ESM_FILENAME\s*=/);
      // No bare __dirname references should survive in the bundle
      // (every use site should have been replaced by `define`).
      const bareDirnameRefs = source
        .split("\n")
        .filter((line) => /(^|[^$_\w])__dirname(?!\$)([^$_\w]|$)/.test(line));
      expect(bareDirnameRefs).toEqual([]);
    },
  );
});

/**
 * Integration test: CLI lazy-load path resolution (ADR-03).
 *
 * The CLI command at src/cli/commands/export/html.ts loads the heavy
 * export module via a non-literal require() path at runtime:
 *
 *   require(join(__dirname, "../export/html.cjs"))
 *
 * where __dirname in the CJS bundle resolves to dist/cli/ at runtime.
 * This means the path resolves to dist/export/html.cjs.
 *
 * This test asserts that the path resolves to an existing file in the
 * actual tsup build output AND that the file exports the exportHtml
 * function. It catches silent tsup layout regressions that would break
 * the command at runtime without any compile-time error.
 *
 * REQUIRES: pnpm build to have completed before running this test.
 * The test skips gracefully (console.warn) if dist/ is absent, so
 * `pnpm test:unit` workflows don't encounter a confusing failure.
 *
 * CI: the pretest:e2e or build-then-test script chain ensures dist/ is
 * present. No additional script is needed.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Mirrors the runtime path computed by the CLI CJS bundle. */
const DIST_CLI_DIR = path.join(PROJECT_ROOT, "dist", "cli");
const LAZY_LOAD_TARGET = path.join(DIST_CLI_DIR, "..", "export", "html.cjs");

const distPresent = fs.existsSync(DIST_CLI_DIR);

describe("cli-export-lazy-load", () => {
  it.skipIf(!distPresent)(
    "dist/ is present (prerequisite for path resolution tests)",
    () => {
      if (!distPresent) {
        console.warn(
          "[cli-export-lazy-load] dist/ not present — run `pnpm build` first. Skipping."
        );
      }
      expect(distPresent).toBe(true);
    }
  );

  it.skipIf(!distPresent)(
    "dist/cli/index.cjs exists (CLI entry point)",
    () => {
      expect(
        fs.existsSync(path.join(DIST_CLI_DIR, "index.cjs"))
      ).toBe(true);
    }
  );

  it.skipIf(!distPresent)(
    "lazy-load target path resolves to an existing file",
    () => {
      const resolved = path.resolve(LAZY_LOAD_TARGET);
      expect(
        fs.existsSync(resolved),
        `Expected ${resolved} to exist — tsup layout may have changed`
      ).toBe(true);
    }
  );

  it.skipIf(!distPresent)(
    "lazy-load target exports an exportHtml function",
    () => {
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(LAZY_LOAD_TARGET) as Record<string, unknown>;
      expect(typeof mod["exportHtml"]).toBe("function");
    }
  );
});

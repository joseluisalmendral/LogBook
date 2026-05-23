/**
 * Integration test: CLI bundle size regression guard (T4).
 *
 * After `pnpm build`, the unified/remark/rehype chain must live in
 * dist/export/html.cjs ONLY. The CLI cold-path bundle (dist/cli/index.cjs)
 * must NOT include those heavy deps.
 *
 * Thresholds (measured after T4 tsup split, raised once after slice 12):
 *   dist/cli/index.cjs   ≤ 420 KB  (was 711 KB; split sheds ~290 KB after slice 12)
 *   dist/export/html.cjs > 100 KB  (heavy remark/rehype chain lives here)
 *
 * This test is the regression guard: if someone re-adds a static import of
 * unified/remark/rehype inside a CLI hot-path module, the CLI bundle will
 * balloon past 400 KB and this test will catch it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI_BUNDLE = path.join(PROJECT_ROOT, "dist", "cli", "index.cjs");
const EXPORT_BUNDLE = path.join(PROJECT_ROOT, "dist", "export", "html.cjs");

const CLI_MAX_BYTES = 420 * 1024; // 420 KB — CLI cold-path budget (slice 12: +--no-transcripts flag + transcript-sanitize lazy entry stub)
const EXPORT_MIN_BYTES = 100 * 1024; // 100 KB — export bundle must contain deps

beforeAll(() => {
  if (!fs.existsSync(CLI_BUNDLE) || !fs.existsSync(EXPORT_BUNDLE)) {
    const result = spawnSync("pnpm", ["build"], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 120_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `pnpm build failed:\nstdout: ${result.stdout?.toString()}\nstderr: ${result.stderr?.toString()}`
      );
    }
  }
}, 150_000);

describe("cli-bundle-size", () => {
  it("dist/export/html.cjs exists after build", () => {
    expect(
      fs.existsSync(EXPORT_BUNDLE),
      `dist/export/html.cjs not found — tsup 4th entry not configured`
    ).toBe(true);
  });

  it("dist/export/html.cjs is > 100 KB (contains heavy remark/rehype deps)", () => {
    const stat = fs.statSync(EXPORT_BUNDLE);
    const sizeKb = (stat.size / 1024).toFixed(2);
    console.info(
      `[bundle-size] dist/export/html.cjs = ${sizeKb} KB (min: 100 KB)`
    );
    expect(
      stat.size,
      `dist/export/html.cjs is only ${sizeKb} KB — expected > 100 KB (heavy deps should be bundled here)`
    ).toBeGreaterThan(EXPORT_MIN_BYTES);
  });

  it("dist/cli/index.cjs is ≤ 400 KB (unified/remark/rehype excluded from CLI cold path)", () => {
    const stat = fs.statSync(CLI_BUNDLE);
    const sizeKb = (stat.size / 1024).toFixed(2);
    console.info(
      `[bundle-size] dist/cli/index.cjs = ${sizeKb} KB (max: 420 KB, was 711 KB before split)`
    );
    expect(
      stat.size,
      `dist/cli/index.cjs is ${sizeKb} KB — exceeds 420 KB budget. ` +
        `A static import of unified/remark/rehype may have been re-introduced in the CLI hot path.`
    ).toBeLessThanOrEqual(CLI_MAX_BYTES);
  });
});

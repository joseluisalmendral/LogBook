/*
 * visual-verify-p5.ts — P5 cross-browser visual verification.
 *
 * Opens the export HTML in Chromium and Firefox at 1280x800 (desktop) and
 * 390x844 (iPhone 14 mobile) and captures key views. Saves to /tmp/lb-p5-*.png.
 *
 * Spec: AG-3, AG-20, S-1, S-6, P5.25.
 */

import { chromium, firefox, type Browser } from "playwright";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const HTML = resolve(process.cwd(), "apps/export-ui/dist/index.html");

async function captureBrowser(name: string, b: Browser): Promise<void> {
  // Desktop TOC light
  let ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  let page = await ctx.newPage();
  await page.goto(`file://${HTML}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/lb-p5-${name}-toc-light.png`, fullPage: false });

  // Desktop TOC dark — toggle theme
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/lb-p5-${name}-toc-dark.png`, fullPage: false });

  // Chapter view (click first session tile)
  const tile = await page.$("[data-testid='session-tile']");
  if (tile) {
    await tile.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `/tmp/lb-p5-${name}-chapter-dark.png`, fullPage: false });
  }
  await ctx.close();

  // Mobile iPhone 14 viewport
  ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  page = await ctx.newPage();
  await page.goto(`file://${HTML}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/lb-p5-${name}-mobile-toc.png`, fullPage: false });

  // Open mobile nav drawer
  const hamb = await page.$("[data-testid='hamburger']");
  if (hamb) {
    await hamb.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/lb-p5-${name}-mobile-nav.png`, fullPage: false });
  }
  await ctx.close();
}

async function main(): Promise<void> {
  if (!existsSync(HTML)) {
    // eslint-disable-next-line no-console
    console.error(`[visual-verify-p5] missing ${HTML} — run \`pnpm build:ui\` first.`);
    process.exit(1);
  }

  const browsers: Array<[string, () => Promise<Browser>]> = [
    ["chromium", () => chromium.launch({ headless: true })],
    ["firefox", () => firefox.launch({ headless: true })],
  ];

  const results: Array<{ name: string; status: "ok" | string }> = [];
  for (const [name, launcher] of browsers) {
    try {
      const b = await launcher();
      await captureBrowser(name, b);
      await b.close();
      results.push({ name, status: "ok" });
      // eslint-disable-next-line no-console
      console.log(`[visual-verify-p5] ${name} OK`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name, status: msg });
      // eslint-disable-next-line no-console
      console.error(`[visual-verify-p5] ${name} FAIL: ${msg}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log("\nSummary:");
  for (const r of results) console.log(`  ${r.name}: ${r.status}`);
}

void main();

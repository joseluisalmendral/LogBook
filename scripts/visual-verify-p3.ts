/**
 * Visual verification for P3 (export-ui dev server).
 *
 * Per feedback_opus_for_visual_slices_logbook: visual slices verify by
 * opening the dev server + reading screenshots, not by grep. This script
 * captures the editorial palette, the sort cycle, the theme toggle, and
 * the mobile viewport so the orchestrator agent can inspect the PNGs.
 *
 * Usage:
 *   pnpm tsx scripts/visual-verify-p3.ts [url]
 *
 * Defaults to http://localhost:5180/ (vite dev with the dev-payload fixture).
 *
 * Outputs (all under /tmp/lb-p3-*):
 *   /tmp/lb-p3-toc-light.png       — default landing, light mode
 *   /tmp/lb-p3-toc-dark.png        — after theme toggle
 *   /tmp/lb-p3-toc-chrono-asc.png  — sort cycled to chrono-asc
 *   /tmp/lb-p3-toc-chrono-desc.png — sort cycled to chrono-desc
 *   /tmp/lb-p3-chapter.png         — navigated into the first chapter
 *   /tmp/lb-p3-mobile-toc.png      — iPhone 14 viewport (390x844)
 *   /tmp/lb-p3-mobile-drawer.png   — hamburger open with drawer visible
 */

import { chromium } from "playwright";
import { resolve } from "node:path";

const URL = process.argv[2] ?? "http://localhost:5180/";

interface Capture {
  name: string;
  path: string;
  computedBg: string;
  visibleTestIds: string[];
  consoleErrors: string[];
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const captures: Capture[] = [];

  // ---------- Desktop viewport ----------
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
    });

    // Reset localStorage so the test is reproducible.
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    await page.waitForSelector("[data-testid='course-toc']", { timeout: 10000 });

    // -- 1. Default TOC, light mode
    await page.screenshot({ path: "/tmp/lb-p3-toc-light.png", fullPage: false });
    captures.push({
      name: "toc-light",
      path: "/tmp/lb-p3-toc-light.png",
      computedBg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      visibleTestIds: await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
          .filter((e) => e.offsetParent !== null)
          .slice(0, 10)
          .map((e) => e.getAttribute("data-testid") ?? ""),
      ),
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // -- 2. Toggle theme → dark
    await page.locator("[data-testid='theme-toggle']").click();
    await page.waitForTimeout(400); // view transition settle
    await page.screenshot({ path: "/tmp/lb-p3-toc-dark.png", fullPage: false });
    captures.push({
      name: "toc-dark",
      path: "/tmp/lb-p3-toc-dark.png",
      computedBg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      visibleTestIds: [],
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // Back to light.
    await page.locator("[data-testid='theme-toggle']").click();
    await page.waitForTimeout(300);

    // -- 3. Sort cycle → chrono-asc
    await page.locator("[data-sort-segment='chrono-asc']").click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/lb-p3-toc-chrono-asc.png", fullPage: false });
    const sortAttrAsc = await page.locator("[data-testid='course-toc']").getAttribute("data-sort");
    captures.push({
      name: "toc-chrono-asc",
      path: "/tmp/lb-p3-toc-chrono-asc.png",
      computedBg: `data-sort=${sortAttrAsc}`,
      visibleTestIds: [],
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // -- 4. Sort cycle → chrono-desc
    await page.locator("[data-sort-segment='chrono-desc']").click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/lb-p3-toc-chrono-desc.png", fullPage: false });
    const sortAttrDesc = await page.locator("[data-testid='course-toc']").getAttribute("data-sort");
    captures.push({
      name: "toc-chrono-desc",
      path: "/tmp/lb-p3-toc-chrono-desc.png",
      computedBg: `data-sort=${sortAttrDesc}`,
      visibleTestIds: [],
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // -- 5. Reset to phase, navigate to first chapter
    await page.locator("[data-sort-segment='phase']").click();
    await page.waitForTimeout(200);
    await page.locator("[data-testid='session-tile']").first().click();
    await page.waitForSelector("[data-testid='chapter-placeholder']", { timeout: 5000 });
    await page.screenshot({ path: "/tmp/lb-p3-chapter.png", fullPage: false });
    captures.push({
      name: "chapter",
      path: "/tmp/lb-p3-chapter.png",
      computedBg: await page.evaluate(() => location.hash),
      visibleTestIds: await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
          .filter((e) => e.offsetParent !== null)
          .slice(0, 10)
          .map((e) => e.getAttribute("data-testid") ?? ""),
      ),
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    await context.close();
  }

  // ---------- Mobile viewport (iPhone 14) ----------
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    await page.waitForSelector("[data-testid='course-toc']", { timeout: 10000 });

    // -- 6. Mobile TOC with hamburger visible
    await page.screenshot({ path: "/tmp/lb-p3-mobile-toc.png", fullPage: false });
    captures.push({
      name: "mobile-toc",
      path: "/tmp/lb-p3-mobile-toc.png",
      computedBg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      visibleTestIds: await page.evaluate(() => {
        const ham = document.querySelector("[data-testid='hamburger']") as HTMLElement | null;
        return ham?.offsetParent !== null ? ["hamburger-visible"] : ["hamburger-MISSING"];
      }),
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // -- 7. Open the drawer
    await page.locator("[data-testid='hamburger']").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "/tmp/lb-p3-mobile-drawer.png", fullPage: false });
    captures.push({
      name: "mobile-drawer",
      path: "/tmp/lb-p3-mobile-drawer.png",
      computedBg: await page.evaluate(() => {
        const sb = document.querySelector("[data-testid='sidebar']") as HTMLElement | null;
        return sb?.classList.contains("open") ? "drawer-open" : "drawer-closed";
      }),
      visibleTestIds: [],
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    await context.close();
  }

  await browser.close();

  console.log("=== P3 visual verification ===");
  for (const c of captures) {
    const status = c.consoleErrors.length === 0 ? "OK" : `ERRORS=${c.consoleErrors.length}`;
    console.log(`[${status}] ${c.name.padEnd(20)} ${resolve(c.path)}`);
    console.log(`         signal: ${c.computedBg}`);
    if (c.visibleTestIds.length > 0) {
      console.log(`         visible: ${c.visibleTestIds.join(", ")}`);
    }
    for (const err of c.consoleErrors) {
      console.log(`         ${err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

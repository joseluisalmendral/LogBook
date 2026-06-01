/**
 * verify-annotations.ts — drive the REAL populated export deck in headless
 * Chromium and prove the display-annotations Feature B end-to-end.
 *
 * Usage: pnpm tsx scripts/verify-annotations.ts <path-to-index.html>
 *
 * Captures screenshots to /tmp/lb-anno-*.png and asserts behavior + localStorage.
 */
import { chromium, type Page } from "playwright";
import { resolve } from "node:path";

const HTML = process.argv[2];
if (!HTML) throw new Error("pass the index.html path");
const URL = `file://${resolve(HTML)}`;

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function getStore(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem("lb.annotations"));
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });

  await page.goto(URL);
  await page.waitForTimeout(700);

  // Enter the first chapter (deck opens on a TOC). Click the first chapter link.
  const tocLink = page.locator("a[href^='#/chapter'], a[href*='chapter']").first();
  if (await tocLink.count()) {
    await tocLink.click();
    await page.waitForTimeout(600);
  }
  // Ensure event anchors exist.
  const anchorCount = await page.locator(".event-anchor").count();
  check("event anchors render in chapter", anchorCount > 0, `${anchorCount} anchors`);
  await page.screenshot({ path: "/tmp/lb-anno-1-chapter.png", fullPage: false });

  // 1. Trigger appears on hover.
  const firstAnchor = page.locator(".event-anchor").first();
  await firstAnchor.scrollIntoViewIfNeeded();
  await firstAnchor.hover();
  await page.waitForTimeout(250);
  const trigger = firstAnchor.locator("[data-testid='annotation-trigger']");
  check("annotation trigger present in anchor", (await trigger.count()) > 0);
  const triggerOpacity = await trigger.evaluate((el) => getComputedStyle(el).opacity);
  check("trigger visible on hover (opacity≈1)", parseFloat(triggerOpacity) > 0.9, `opacity=${triggerOpacity}`);
  await page.screenshot({ path: "/tmp/lb-anno-2-hover-trigger.png" });

  // 2. Dialog opens with fields. Scope everything to the OPEN dialog (each of
  // the 177 events renders its own <dialog>; only one is open at a time).
  await trigger.click();
  await page.waitForTimeout(300);
  const openCount = await page.locator("[data-testid='annotation-dialog'][open]").count();
  check("dialog opens via showModal", openCount === 1, `${openCount} open dialogs`);
  const dlg = firstAnchor.locator("[data-testid='annotation-dialog']");
  check("label input present", (await dlg.locator("[data-testid='annotation-label']").count()) === 1);
  check("3 tag buttons present", (await dlg.locator("[data-testid^='annotation-tag-']").count()) === 3);
  check("5 color swatches present", (await dlg.locator("[data-testid^='annotation-color-']").count()) === 5);
  await page.screenshot({ path: "/tmp/lb-anno-3-dialog.png" });

  // 3. Save an annotation: label + tag=milestone + color=Inkwell.
  await dlg.locator("[data-testid='annotation-label']").fill("Key decision point");
  await dlg.locator("[data-testid='annotation-tag-milestone']").click();
  await dlg.locator("[data-testid='annotation-color-Inkwell']").click();
  await dlg.locator("[data-testid='annotation-save']").click();
  await page.waitForTimeout(300);

  const annotatedAttr = await firstAnchor.getAttribute("data-annotated");
  check("data-annotated=true after save", annotatedAttr === "true", `attr=${annotatedAttr}`);
  const ringBorder = await firstAnchor.evaluate((el) => getComputedStyle(el).borderLeftWidth);
  check("left-accent ring rendered", parseFloat(ringBorder) >= 3, `border-left=${ringBorder}`);

  const store1 = await getStore(page);
  check("localStorage lb.annotations is non-null after save", store1 !== null);
  const parsed1 = store1 ? JSON.parse(store1) : {};
  const savedOne = Object.values(parsed1)[0] as { label?: string } | undefined;
  check("saved annotation label persisted", savedOne?.label === "Key decision point", `label=${savedOne?.label}`);
  await page.screenshot({ path: "/tmp/lb-anno-4-ring.png" });

  // Save a SECOND annotation on a different event so Brief lists 2.
  const secondAnchor = page.locator(".event-anchor").nth(3);
  await secondAnchor.scrollIntoViewIfNeeded();
  await secondAnchor.hover();
  await secondAnchor.locator("[data-testid='annotation-trigger']").click();
  await page.waitForTimeout(250);
  const dlg2 = secondAnchor.locator("[data-testid='annotation-dialog']");
  await dlg2.locator("[data-testid='annotation-label']").fill("Tricky bug here");
  await dlg2.locator("[data-testid='annotation-tag-error']").click();
  await dlg2.locator("[data-testid='annotation-save']").click();
  await page.waitForTimeout(300);
  const totalAnnotated = await page.locator(".event-anchor[data-annotated='true']").count();
  check("two events annotated", totalAnnotated === 2, `${totalAnnotated} annotated`);

  // 4. Full/Brief toggle in scrubber.
  const briefBtn = page.locator("[data-testid='legend-view-brief']").first();
  check("Full/Brief toggle present in scrubber", (await briefBtn.count()) > 0);
  await briefBtn.scrollIntoViewIfNeeded();
  await briefBtn.click();
  await page.waitForTimeout(250);
  const briefEntries = page.locator("[data-testid='brief-entry']");
  const briefCount = await briefEntries.count();
  check("Brief lists ONLY annotated events (2)", briefCount === 2, `${briefCount} entries`);
  // Confirm Full legend has the 8 kind chips and is hidden in Brief.
  await page.screenshot({ path: "/tmp/lb-anno-5-brief.png" });

  // Brief entry click scrolls to the event.
  const targetId = await firstAnchor.getAttribute("id");
  await briefEntries.first().click();
  await page.waitForTimeout(500);
  const inView = await firstAnchor.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= -50 && r.top <= window.innerHeight;
  });
  check("clicking brief entry scrolls to event", inView, `target=${targetId}`);

  // Back to Full — confirm 8 chips.
  await page.locator("[data-testid='legend-view-full']").first().click();
  await page.waitForTimeout(200);
  // Expand the legend strip to count chips.
  const legendToggle = page.locator("[data-testid='legend-key'] .legend-toggle").first();
  if (await legendToggle.count()) {
    await legendToggle.click();
    await page.waitForTimeout(150);
  }
  const chipCount = await page.locator("[data-testid='legend-key'] .legend-chip").count();
  check("Full legend still has 8 event-kind chips", chipCount === 8, `${chipCount} chips`);

  // 5. Reload persists annotations.
  await page.reload();
  await page.waitForTimeout(700);
  const tocLink2 = page.locator("a[href*='chapter']").first();
  if (await tocLink2.count()) {
    await tocLink2.click();
    await page.waitForTimeout(500);
  }
  const persistedAnnotated = await page.locator(".event-anchor[data-annotated='true']").count();
  check("annotations persist after reload", persistedAnnotated === 2, `${persistedAnnotated} annotated`);
  const store2 = await getStore(page);
  check("localStorage still populated after reload", store2 !== null && Object.keys(JSON.parse(store2)).length === 2);

  // 6. Clear-all in Sidebar with confirm, asserting key removal.
  const clearBtn = page.locator("[data-testid='annotations-clear-all']").first();
  if (!(await clearBtn.count())) {
    // Sidebar may be in a drawer on this viewport; force open by toggling.
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  check("clear-all button present", (await clearBtn.count()) > 0);
  await clearBtn.scrollIntoViewIfNeeded();
  await clearBtn.click();
  await page.waitForTimeout(150);
  const confirmYes = page.locator("[data-testid='annotations-clear-yes']");
  check("confirm step appears", (await confirmYes.count()) > 0);
  await confirmYes.click();
  await page.waitForTimeout(300);

  const storeAfterClear = await getStore(page);
  check("localStorage key GONE after clear (=== null)", storeAfterClear === null, `value=${storeAfterClear}`);
  const ringsAfterClear = await page.locator(".event-anchor[data-annotated='true']").count();
  check("no rings after clear", ringsAfterClear === 0, `${ringsAfterClear} rings`);
  await page.screenshot({ path: "/tmp/lb-anno-6-cleared.png" });

  // 7. Clear persists null after reload.
  await page.reload();
  await page.waitForTimeout(500);
  const storeReload = await getStore(page);
  check("localStorage null persists after reload", storeReload === null, `value=${storeReload}`);

  check("no uncaught console/page errors", errors.length === 0, errors.join(" | "));

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== ${checks.length - failed.length}/${checks.length} checks passed ===`);
  if (failed.length) {
    console.log("FAILED:", failed.map((f) => f.name).join("; "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

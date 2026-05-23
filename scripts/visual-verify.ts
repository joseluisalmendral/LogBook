/**
 * Visual verification script — load the seeded HTML in headless Chromium,
 * navigate through every hash route, capture screenshots + computed styles
 * + feature presence, and write a report.
 *
 * Usage:
 *   pnpm tsx scripts/visual-verify.ts [path-to-html]
 *
 * Defaults to /tmp/logbook-demo-seeded.html.
 *
 * Outputs:
 *   /tmp/lb-visual-<page>.png — one screenshot per page
 *   /tmp/lb-visual-report.md — markdown report of findings
 *   stdout — quick summary
 */

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGES = [
  "dashboard",
  "sessions",
  "decisions",
  "errors",
  "commits",
  "resources",
  "milestones",
];

const HTML_PATH =
  process.argv[2] ?? "/tmp/logbook-demo-seeded.html";

interface PageReport {
  page: string;
  hash: string;
  screenshotPath: string;
  computedBodyBg: string;
  computedAccent: string;
  visibleMainId: string | null;
  visibleMainSnippet: string;
  errors: string[];
}

async function main(): Promise<void> {
  const url = `file://${resolve(HTML_PATH)}`;
  console.log(`Loading: ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error")
      consoleErrors.push(`console.error: ${msg.text()}`);
  });

  // Load with no hash first to verify default landing
  await page.goto(url);
  await page.waitForTimeout(500);

  const reports: PageReport[] = [];

  // First, capture default landing
  {
    const defaultHash = await page.evaluate(() => location.hash);
    const bodyBg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--lb-accent")
        .trim()
    );
    const visibleMain = await page.evaluate(() => {
      const mains = Array.from(
        document.querySelectorAll<HTMLElement>("main.lb-page")
      );
      const vis = mains.find((m) => !m.hidden);
      return vis
        ? { id: vis.id, snippet: vis.innerText.slice(0, 200) }
        : { id: null, snippet: "(none visible)" };
    });

    const shot = `/tmp/lb-visual-default-landing.png`;
    await page.screenshot({ path: shot, fullPage: false });

    reports.push({
      page: "default-landing",
      hash: defaultHash,
      screenshotPath: shot,
      computedBodyBg: bodyBg,
      computedAccent: accent,
      visibleMainId: visibleMain.id,
      visibleMainSnippet: visibleMain.snippet,
      errors: [...consoleErrors],
    });
    consoleErrors.length = 0;
  }

  // Now navigate each hash explicitly
  for (const p of PAGES) {
    const hash = `#${p}`;
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
    await page.waitForTimeout(300);

    const visibleMain = await page.evaluate(() => {
      const mains = Array.from(
        document.querySelectorAll<HTMLElement>("main.lb-page")
      );
      const vis = mains.find((m) => !m.hidden);
      return vis
        ? { id: vis.id, snippet: vis.innerText.slice(0, 250) }
        : { id: null, snippet: "(none visible)" };
    });
    const bodyBg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--lb-accent")
        .trim()
    );

    const shot = `/tmp/lb-visual-${p}.png`;
    await page.screenshot({ path: shot, fullPage: false });

    reports.push({
      page: p,
      hash,
      screenshotPath: shot,
      computedBodyBg: bodyBg,
      computedAccent: accent,
      visibleMainId: visibleMain.id,
      visibleMainSnippet: visibleMain.snippet,
      errors: [...consoleErrors],
    });
    consoleErrors.length = 0;
  }

  // Test Cmd+K palette
  await page.evaluate(() => {
    location.hash = "#sessions";
  });
  await page.waitForTimeout(200);
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  const paletteOpen = await page.evaluate(() => {
    // Cmd+K palette dialog id is "lb-palette" (see assets/export/inline.js
    // cmdkPalette()). The "lb-cmdk" id was a stale guess.
    const dialog = document.getElementById("lb-palette") as HTMLDialogElement | null;
    return dialog?.open ?? false;
  });
  await page.screenshot({ path: "/tmp/lb-visual-cmdk-open.png" });
  if (paletteOpen) {
    await page.keyboard.press("Escape");
  }

  // Test dark theme attribute
  const themeOnHtml = await page.evaluate(
    () => document.documentElement.getAttribute("data-theme")
  );

  // Test theme toggle — the button id is "lb-theme-toggle" (see
  // assets/export/inline.js themeToggle()), not the previously-guessed
  // [data-lb-theme-toggle] attribute selector.
  await page.evaluate(() => {
    const btn = document.getElementById("lb-theme-toggle");
    btn?.click();
  });
  await page.waitForTimeout(200);
  const themeAfterToggle = await page.evaluate(
    () => document.documentElement.getAttribute("data-theme")
  );
  await page.screenshot({ path: "/tmp/lb-visual-light-mode.png" });

  await browser.close();

  // Build report
  const lines: string[] = [];
  lines.push("# Visual Verification Report\n");
  lines.push(`**HTML file**: ${HTML_PATH}`);
  lines.push(`**Default theme attr**: \`${themeOnHtml ?? "(none — dark default in :root)"}\``);
  lines.push(`**Theme after toggle click**: \`${themeAfterToggle ?? "(unchanged)"}\``);
  lines.push(`**Cmd+K palette opens**: ${paletteOpen ? "YES ✓" : "NO ✗"}\n`);

  for (const r of reports) {
    lines.push(`## ${r.page} (${r.hash || "—"})`);
    lines.push(`- Visible main: \`${r.visibleMainId ?? "NONE"}\``);
    lines.push(`- Body background: \`${r.computedBodyBg}\``);
    lines.push(`- --lb-accent: \`${r.computedAccent || "(empty)"}\``);
    lines.push(`- Screenshot: ${r.screenshotPath}`);
    if (r.errors.length > 0) {
      lines.push("- Console errors:");
      for (const e of r.errors) lines.push(`  - ${e}`);
    } else {
      lines.push("- Console errors: none");
    }
    lines.push(`- Visible content snippet:\n  \`\`\`\n  ${r.visibleMainSnippet.replace(/\n/g, "\n  ")}\n  \`\`\``);
    lines.push("");
  }

  const reportPath = "/tmp/lb-visual-report.md";
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`\nReport written to ${reportPath}`);
  console.log(`Screenshots:`);
  for (const r of reports) console.log(`  ${r.screenshotPath}`);
  console.log(`  /tmp/lb-visual-cmdk-open.png`);
  console.log(`  /tmp/lb-visual-light-mode.png`);

  // Print quick summary to stdout
  console.log("\n=== Quick summary ===");
  console.log(`Default landing: hash=${reports[0]?.hash || "(empty)"}, main=${reports[0]?.visibleMainId || "(none)"}`);
  console.log(`Body bg (default): ${reports[0]?.computedBodyBg}`);
  console.log(`--lb-accent: ${reports[0]?.computedAccent}`);
  console.log(`Cmd+K opens palette: ${paletteOpen ? "✓" : "✗"}`);
  console.log(`Theme attr (initial): ${themeOnHtml ?? "(none — dark in :root)"}`);
  console.log(`Theme attr (after toggle): ${themeAfterToggle ?? "(unchanged)"}`);

  console.log("\nPer-page navigation:");
  for (const r of reports.slice(1)) {
    const ok = r.visibleMainId === `page-${r.page}`;
    console.log(`  ${r.hash.padEnd(15)} → main=${r.visibleMainId ?? "NONE"} ${ok ? "✓" : "✗"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

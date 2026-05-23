/**
 * Visual verification for P4 (export-ui dev server) — the narrative slice.
 *
 * Per feedback_opus_for_visual_slices_logbook: visual slices verify by
 * opening the dev server + reading screenshots, not by grep. This script
 * captures the 8 P4 wow moments so the orchestrator agent can inspect the
 * PNGs and confirm the 3D flip + branching question card actually landed.
 *
 * Usage:
 *   pnpm tsx scripts/visual-verify-p4.ts [url]
 *
 * Defaults to http://localhost:5180/.
 *
 * Outputs (all under /tmp/lb-p4-*):
 *   /tmp/lb-p4-chapter.png            — chapter view with TurnRows + SubAgentCard collapsed
 *   /tmp/lb-p4-subagent-flipped.png   — SubAgentCard after click (rotateY)
 *   /tmp/lb-p4-agent-question.png     — AgentQuestionCard with chosen + dimmed
 *   /tmp/lb-p4-inspector.png          — PromptInspector slid in from right
 *   /tmp/lb-p4-palette.png            — CommandPalette open
 *   /tmp/lb-p4-decision.png           — DecisionMilestone in viewport
 *   /tmp/lb-p4-chapter-dark.png       — chapter in dark mode
 *   /tmp/lb-p4-mobile-chapter.png     — chapter on iPhone 14 viewport
 */

import { chromium } from "playwright";
import { resolve } from "node:path";

const URL = process.argv[2] ?? "http://localhost:5180/";

interface Capture {
  name: string;
  path: string;
  signal: string;
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

    // Reset state.
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    await page.waitForSelector("[data-testid='course-toc']", { timeout: 10000 });

    // Navigate to the W2 chapter that has the SubAgentCard + AgentQuestionCard.
    // sess-004 is the agent_question normalization session — richest events.
    await page.goto(`${URL}#/chapter/sess-004`);
    await page.waitForSelector("[data-testid='chapter-player']", { timeout: 10000 });
    await page.waitForTimeout(400);

    // 1. Chapter view — TurnRows + SubAgentCard collapsed.
    await page.screenshot({ path: "/tmp/lb-p4-chapter.png", fullPage: false });
    captures.push({
      name: "chapter",
      path: "/tmp/lb-p4-chapter.png",
      signal: await page.evaluate(() => location.hash),
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // 2. SubAgentCard flipped — click the FIRST subagent card.
    await page.locator("[data-testid='sub-agent-card'] .card").first().click();
    await page.waitForTimeout(700); // settle flip animation
    await page.evaluate(() => {
      const card = document.querySelector("[data-testid='sub-agent-card']");
      card?.scrollIntoView({ behavior: "auto", block: "center" });
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/lb-p4-subagent-flipped.png", fullPage: false });
    const flippedAttr = await page.locator("[data-testid='sub-agent-card']").first().getAttribute("data-flipped");
    captures.push({
      name: "subagent-flipped",
      path: "/tmp/lb-p4-subagent-flipped.png",
      signal: `data-flipped=${flippedAttr}`,
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // 3. AgentQuestionCard — scroll to one + capture chosen + dimmed.
    await page.locator("[data-testid='sub-agent-card'] .card").first().click(); // unflip
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const card = document.querySelectorAll("[data-testid='agent-question-card']");
      const target = card[card.length - 1];
      target?.scrollIntoView({ behavior: "auto", block: "center" });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: "/tmp/lb-p4-agent-question.png", fullPage: false });
    captures.push({
      name: "agent-question",
      path: "/tmp/lb-p4-agent-question.png",
      signal: await page.locator("[data-testid='agent-question-card']").count() + " cards",
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // 4. PromptInspector — click a decision row.
    await page.evaluate(() => {
      const first = document.querySelector("[data-testid='decision-milestone']");
      first?.scrollIntoView({ behavior: "auto", block: "center" });
    });
    await page.waitForTimeout(200);
    await page.locator("[data-testid='decision-milestone']").first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/lb-p4-inspector.png", fullPage: false });
    const inspectorOpen = await page.locator("[data-testid='prompt-inspector']").getAttribute("aria-hidden");
    captures.push({
      name: "inspector",
      path: "/tmp/lb-p4-inspector.png",
      signal: `aria-hidden=${inspectorOpen}`,
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // Close the inspector before next capture.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // 5. CommandPalette — open via keyboard.
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(500);
    // Type a query to populate results.
    await page.locator("[data-testid='palette-input']").fill("decision");
    await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/lb-p4-palette.png", fullPage: false });
    captures.push({
      name: "palette",
      path: "/tmp/lb-p4-palette.png",
      signal: await page.evaluate(() => {
        const d = document.querySelector("[data-testid='command-palette']") as HTMLDialogElement | null;
        return d?.open ? "open" : "closed";
      }),
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 6. DecisionMilestone — scroll to a decision in viewport.
    await page.evaluate(() => {
      const decisions = document.querySelectorAll("[data-testid='decision-milestone']");
      decisions[0]?.scrollIntoView({ behavior: "auto", block: "center" });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: "/tmp/lb-p4-decision.png", fullPage: false });
    captures.push({
      name: "decision-pulse",
      path: "/tmp/lb-p4-decision.png",
      signal: `${await page.locator("[data-testid='decision-milestone']").count()} milestones`,
      consoleErrors: [...consoleErrors],
    });
    consoleErrors.length = 0;

    // 7. Dark mode chapter.
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("lb.theme", "dark");
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: "/tmp/lb-p4-chapter-dark.png", fullPage: false });
    captures.push({
      name: "chapter-dark",
      path: "/tmp/lb-p4-chapter-dark.png",
      signal: "data-theme=dark",
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

    await page.goto(`${URL}#/chapter/sess-004`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${URL}#/chapter/sess-004`);
    await page.waitForSelector("[data-testid='chapter-player']", { timeout: 10000 });
    await page.waitForTimeout(400);

    // 8. Mobile chapter — single column, hamburger bar visible.
    await page.screenshot({ path: "/tmp/lb-p4-mobile-chapter.png", fullPage: false });
    captures.push({
      name: "mobile-chapter",
      path: "/tmp/lb-p4-mobile-chapter.png",
      signal: "390x844 viewport",
      consoleErrors: [...consoleErrors],
    });

    await context.close();
  }

  await browser.close();

  console.log("=== P4 visual verification ===");
  for (const c of captures) {
    const status = c.consoleErrors.length === 0 ? "OK" : `ERRORS=${c.consoleErrors.length}`;
    console.log(`[${status}] ${c.name.padEnd(22)} ${resolve(c.path)}`);
    console.log(`         signal: ${c.signal}`);
    for (const err of c.consoleErrors) {
      console.log(`         ${err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

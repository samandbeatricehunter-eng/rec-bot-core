// Screenshots the site's chromeless weekly-matchup-board page for use as the "here's this week's
// slate" hold screen the weekly highlight recap shows right after its intro, before the clips
// start (GOTW cards, then H2H, then Human vs CPU, final scores filled in, over black). Same
// one-Chromium-per-render approach as matchup-render.ts/nfl-playoff-bracket-render.ts.
import { chromium } from "playwright";
import { env } from "../config/env.js";
import { signWeeklyMatchupBoardRenderToken } from "./render-token.js";

const RENDER_VIEWPORT = { width: 1920, height: 1080 };
const RENDER_TIMEOUT_MS = 15_000;

export async function renderWeeklyMatchupBoardPng(leagueId: string, weekNumber: number): Promise<Buffer> {
  const token = signWeeklyMatchupBoardRenderToken(leagueId, weekNumber);
  const url = `${env.SITE_PUBLIC_URL}/render/weekly-matchup-board/${leagueId}/${weekNumber}?token=${encodeURIComponent(token)}`;

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      timeout: 10_000,
    });
  } catch (error) {
    throw new Error(`Chromium failed to launch (Playwright/nixpacks setup issue, not a render-page issue): ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const page = await browser.newPage({ viewport: RENDER_VIEWPORT, deviceScaleFactor: 2 });
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => { consoleErrors.push(`pageerror: ${err.message}`); });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    const target = page.locator("[data-board-render-root]");
    try {
      await target.waitFor({ state: "visible", timeout: RENDER_TIMEOUT_MS });
    } catch (waitError) {
      const bodyText = await page.locator("body").innerText().catch(() => "(could not read page body)");
      throw new Error(`Weekly matchup board never rendered. Page text: "${bodyText.slice(0, 300)}". Console errors: ${consoleErrors.slice(0, 5).join(" | ") || "(none)"}. Original: ${waitError instanceof Error ? waitError.message : String(waitError)}`);
    }
    await page.waitForFunction(() => {
      const root = document.querySelector("[data-board-render-root]");
      if (!root) return false;
      return Array.from(root.querySelectorAll("img")).every((img) => img.complete);
    }, { timeout: RENDER_TIMEOUT_MS }).catch(() => undefined);
    return await target.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

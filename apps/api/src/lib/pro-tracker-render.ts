// Screenshots the site's ProTrackerCard component (rendered chromeless at
// /render/pro-tracker/:userId/:leagueId/:weekNumber) for the weekly Rise to Immortality "Pro
// Tracker" Discord post's image. Same one-Chromium-per-render approach as
// player-of-week-render.ts -- fires once per RTI user per advance, never at meaningful volume.
import { chromium } from "playwright";
import { env } from "../config/env.js";
import { signProTrackerRenderToken } from "./render-token.js";

const RENDER_VIEWPORT = { width: 1400, height: 900 };
const RENDER_TIMEOUT_MS = 15_000;

export async function renderProTrackerPng(userId: string, leagueId: string, weekNumber: number): Promise<Buffer> {
  const token = signProTrackerRenderToken(userId, leagueId, weekNumber);
  const url = `${env.SITE_PUBLIC_URL}/render/pro-tracker/${userId}/${leagueId}/${weekNumber}?token=${encodeURIComponent(token)}`;

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
    const target = page.locator("[data-pro-tracker-render]");
    try {
      await target.waitFor({ state: "visible", timeout: RENDER_TIMEOUT_MS });
    } catch (waitError) {
      const bodyText = await page.locator("body").innerText().catch(() => "(could not read page body)");
      throw new Error(`Pro Tracker card never rendered. Page text: "${bodyText.slice(0, 300)}". Console errors: ${consoleErrors.slice(0, 5).join(" | ") || "(none)"}. Original: ${waitError instanceof Error ? waitError.message : String(waitError)}`);
    }
    await page.waitForFunction(() => {
      const root = document.querySelector("[data-pro-tracker-render]");
      if (!root) return false;
      return Array.from(root.querySelectorAll("img")).every((img) => img.complete);
    }, { timeout: RENDER_TIMEOUT_MS }).catch(() => undefined);
    return await target.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

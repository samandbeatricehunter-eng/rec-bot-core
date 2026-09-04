// Screenshots the site's chromeless /render/rivalry-h2h/:gameId/:side route -- the existing
// MatchupCard/HeroMatchupBreakdown team comparison stacked with a new prospect-vs-prospect
// comparison for a Rise to Immortality rivalry matchup. Same one-Chromium-per-render approach as
// prospect-card-render.ts; this fires once per rivalry matchup, not at meaningful volume.
import { chromium } from "playwright";
import { env } from "../config/env.js";
import { signRivalryH2hRenderToken } from "./render-token.js";

const RENDER_VIEWPORT = { width: 1400, height: 1600 };
const RENDER_TIMEOUT_MS = 15_000;

export async function renderRivalryH2hPng(gameId: string, side: "offense" | "defense"): Promise<Buffer> {
  const token = signRivalryH2hRenderToken(gameId, side);
  const url = `${env.SITE_PUBLIC_URL}/render/rivalry-h2h/${gameId}/${side}?token=${encodeURIComponent(token)}`;

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
    const target = page.locator("[data-rivalry-h2h-render-root]");
    try {
      await target.waitFor({ state: "visible", timeout: RENDER_TIMEOUT_MS });
    } catch (waitError) {
      const bodyText = await page.locator("body").innerText().catch(() => "(could not read page body)");
      throw new Error(`Rivalry head-to-head card never rendered. Page text: "${bodyText.slice(0, 300)}". Console errors: ${consoleErrors.slice(0, 5).join(" | ") || "(none)"}. Original: ${waitError instanceof Error ? waitError.message : String(waitError)}`);
    }
    await page.waitForFunction(() => {
      const root = document.querySelector("[data-rivalry-h2h-render-root]");
      if (!root) return false;
      return Array.from(root.querySelectorAll("img")).every((img) => img.complete);
    }, { timeout: RENDER_TIMEOUT_MS }).catch(() => undefined);
    return await target.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

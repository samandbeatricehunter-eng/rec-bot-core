// Screenshots the site's own PlayerOfWeekCard component (rendered chromeless at
// /render/player-of-week/:storyId) for use as the Discord Player of the Week post's image, so
// the Discord and web presentations never visually drift apart. Same one-Chromium-per-render
// approach as matchup-render.ts (this fires once per league per completed week -- never
// concurrently at meaningful volume, so a persistent browser pool isn't worth the complexity).
import { chromium } from "playwright";
import { env } from "../config/env.js";
import { signPlayerOfWeekRenderToken } from "./render-token.js";

const RENDER_VIEWPORT = { width: 1600, height: 900 };
const RENDER_TIMEOUT_MS = 15_000;

export async function renderPlayerOfWeekPng(storyId: string): Promise<Buffer> {
  const token = signPlayerOfWeekRenderToken(storyId);
  const url = `${env.SITE_PUBLIC_URL}/render/player-of-week/${storyId}?token=${encodeURIComponent(token)}`;

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
    const target = page.locator("[data-potw-render]");
    try {
      await target.waitFor({ state: "visible", timeout: RENDER_TIMEOUT_MS });
    } catch (waitError) {
      const bodyText = await page.locator("body").innerText().catch(() => "(could not read page body)");
      throw new Error(`Player of the Week card never rendered. Page text: "${bodyText.slice(0, 300)}". Console errors: ${consoleErrors.slice(0, 5).join(" | ") || "(none)"}. Original: ${waitError instanceof Error ? waitError.message : String(waitError)}`);
    }
    await page.waitForFunction(() => {
      const root = document.querySelector("[data-potw-render]");
      if (!root) return false;
      return Array.from(root.querySelectorAll("img")).every((img) => img.complete);
    }, { timeout: RENDER_TIMEOUT_MS }).catch(() => undefined);
    return await target.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

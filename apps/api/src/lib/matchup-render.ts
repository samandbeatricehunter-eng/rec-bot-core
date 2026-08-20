// Screenshots the site's own MatchupCard component (rendered chromeless at
// /render/matchup/:gameId) for use as a Discord game-channel embed image, so the Discord and
// web presentations of a matchup never visually drift apart. One Chromium instance is launched
// per render and closed immediately after -- this runs rarely (game-channel creation, a
// confirmed reschedule) and never concurrently at meaningful volume, so a persistent browser
// pool isn't worth the complexity yet.
import { chromium } from "playwright";
import { env } from "../config/env.js";
import { signMatchupRenderToken } from "./render-token.js";

const RENDER_VIEWPORT = { width: 1200, height: 420 };
const RENDER_TIMEOUT_MS = 15_000;

export async function renderMatchupCardPng(gameId: string): Promise<Buffer> {
  const token = signMatchupRenderToken(gameId);
  const url = `${env.SITE_PUBLIC_URL}/render/matchup/${gameId}?token=${encodeURIComponent(token)}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: RENDER_VIEWPORT, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "networkidle", timeout: RENDER_TIMEOUT_MS });
    const target = page.locator("[data-matchup-render]");
    await target.waitFor({ state: "visible", timeout: RENDER_TIMEOUT_MS });
    return await target.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

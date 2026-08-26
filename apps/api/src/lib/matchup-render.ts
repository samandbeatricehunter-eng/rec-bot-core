// Screenshots the site's own MatchupCard component (rendered chromeless at
// /render/matchup/:gameId) for use as a Discord game-channel embed image, so the Discord and
// web presentations of a matchup never visually drift apart. One Chromium instance is launched
// per render and closed immediately after -- this runs rarely (game-channel creation, a
// confirmed reschedule) and never concurrently at meaningful volume, so a persistent browser
// pool isn't worth the complexity yet.
import { chromium } from "playwright";
import { env } from "../config/env.js";
import { signMatchupRenderToken } from "./render-token.js";

const RENDER_VIEWPORT = { width: 1600, height: 520 };
const RENDER_TIMEOUT_MS = 15_000;

export async function renderMatchupCardPng(gameId: string): Promise<Buffer> {
  const token = signMatchupRenderToken(gameId);
  const url = `${env.SITE_PUBLIC_URL}/render/matchup/${gameId}?token=${encodeURIComponent(token)}`;

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({
      headless: true,
      // --no-sandbox: Chromium's sandbox needs a kernel capability (SYS_ADMIN) containers don't
      // grant by default when running as root, which is the default user in most PaaS build
      // images -- without this it can hang indefinitely on launch instead of failing cleanly,
      // which is consistent with "no error ever logged" despite channels still getting created
      // (the request that triggered channel creation timed out client-side while this kept
      // running server-side). --disable-dev-shm-usage: Docker's default /dev/shm is only 64MB,
      // too small for Chromium's shared-memory rendering buffers, another common hang/crash cause.
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      timeout: 10_000,
    });
  } catch (error) {
    // Distinguishes "Chromium itself isn't available in this deploy" (nixpacks/Playwright infra
    // problem) from everything below (the browser launched fine, but the render page/API call
    // failed) -- these need very different fixes, so don't let them look like the same error.
    throw new Error(`Chromium failed to launch (Playwright/nixpacks setup issue, not a render-page issue): ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const page = await browser.newPage({ viewport: RENDER_VIEWPORT, deviceScaleFactor: 2 });
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => { consoleErrors.push(`pageerror: ${err.message}`); });

    // "networkidle" is the wrong wait condition for a Supabase-auth-backed SPA -- the site's
    // AuthProvider/session machinery can keep a connection open long enough that the network
    // never goes quiet for the required 500ms, so goto() just burns its whole timeout and every
    // render silently fails. "domcontentloaded" fires immediately; target.waitFor below is the
    // real readiness gate (data fetched + MatchupCard actually mounted).
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    const target = page.locator("[data-matchup-render-root]");
    try {
      await target.waitFor({ state: "visible", timeout: RENDER_TIMEOUT_MS });
    } catch (waitError) {
      // The render page loaded but never produced the card -- almost always a render-side error
      // (bad token, API unreachable from the page, gameId not found). Pull the visible page text
      // and any console/page errors so the caller's log line actually explains why, instead of
      // just "element not found".
      const bodyText = await page.locator("body").innerText().catch(() => "(could not read page body)");
      throw new Error(`Matchup card never rendered. Page text: "${bodyText.slice(0, 300)}". Console errors: ${consoleErrors.slice(0, 5).join(" | ") || "(none)"}. Original: ${waitError instanceof Error ? waitError.message : String(waitError)}`);
    }
    // Card visibility only means the React tree mounted -- team logos are <img> tags that
    // start fetching after that. Screenshotting immediately left some (or both) crests blank
    // in Discord. Wait until every logo has finished (load or error); `complete` is true for
    // both. Zero images is valid (relocated/custom/CFB) and must not hang.
    await page.waitForFunction(() => {
      const root = document.querySelector("[data-matchup-render-root]");
      if (!root) return false;
      return Array.from(root.querySelectorAll("img")).every((img) => img.complete);
    }, { timeout: RENDER_TIMEOUT_MS }).catch(() => undefined);
    return await target.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

export const AUTOPOST_DELAY_MS = 3 * 60_000;
export const GAME_TIMER_LIMIT_MS = 45 * 60_000;
export const DISCORD_SELECT_LABEL_MAX = 100;

export type StreamPlatform = "twitch" | "youtube" | "tiktok";

export const STREAM_PLATFORMS: StreamPlatform[] = ["twitch", "youtube", "tiktok"];

export function isStreamPlatform(value: string): value is StreamPlatform {
  return value === "twitch" || value === "youtube" || value === "tiktok";
}

export function formatMatchupOptionLabel(input: {
  awayTeamName: string;
  homeTeamName: string;
  serverName: string;
}): string {
  const raw = `${input.awayTeamName} at ${input.homeTeamName} - ${input.serverName}`;
  if (raw.length <= DISCORD_SELECT_LABEL_MAX) return raw;
  return `${raw.slice(0, DISCORD_SELECT_LABEL_MAX - 1)}…`;
}

export function publicStreamUrl(platform: StreamPlatform, login: string, platformUserId?: string | null): string {
  const handle = login.replace(/^@/, "").trim();
  if (platform === "twitch") return `https://www.twitch.tv/${handle}`;
  if (platform === "youtube") {
    if (handle.startsWith("UC") && handle.length >= 20) return `https://www.youtube.com/channel/${handle}/live`;
    if (platformUserId) return `https://www.youtube.com/channel/${platformUserId}/live`;
    return `https://www.youtube.com/@${handle}/live`;
  }
  return `https://www.tiktok.com/@${handle}/live`;
}

export function detectStreamPlatform(rawUrl: string): StreamPlatform | "kick" | "other" | null {
  const url = String(rawUrl ?? "").trim().toLowerCase();
  if (!url) return null;
  if (url.includes("twitch.tv")) return "twitch";
  if (url.includes("youtu.be") || url.includes("youtube.com")) return "youtube";
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.includes("kick.com")) return "kick";
  return "other";
}

/** When the user confirms after already being live, post immediately if the 3-minute delay has elapsed. */
export function autopostAtIso(startedAtMs: number, nowMs = Date.now()): string {
  return new Date(Math.max(startedAtMs + AUTOPOST_DELAY_MS, nowMs)).toISOString();
}

export function shouldAutopostNow(startedAtMs: number, nowMs = Date.now()): boolean {
  return nowMs >= startedAtMs + AUTOPOST_DELAY_MS;
}

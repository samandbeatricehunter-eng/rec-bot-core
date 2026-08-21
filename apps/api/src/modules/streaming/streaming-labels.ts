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

/** Strip @, path, and profile URLs down to the handle Share Stream / live-poll can use. */
export function normalizeStreamHandle(platform: StreamPlatform, raw: string): string {
  let value = String(raw ?? "").trim();
  if (platform === "youtube") {
    value = value.replace(/^https?:\/\/(www\.)?youtube\.com\//i, "");
    value = value.replace(/^(channel|c|user)\//i, "");
    value = value.replace(/^@/, "").replace(/\/(live|videos|featured|streams)?\/?$/i, "");
    return value.trim();
  }
  if (platform === "twitch") {
    value = value.replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "");
  } else {
    value = value.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "");
  }
  return value.replace(/^@/, "").replace(/\/.*$/, "").trim().toLowerCase();
}

export function isValidStreamHandle(platform: StreamPlatform, handle: string): boolean {
  if (platform === "twitch") return /^[a-z0-9_]{3,25}$/.test(handle);
  if (platform === "youtube") {
    if (/^UC[A-Za-z0-9_-]{20,}$/.test(handle)) return true;
    return /^[A-Za-z0-9._-]{3,30}$/.test(handle);
  }
  return /^[a-z0-9._]{2,24}$/.test(handle);
}

export function streamHandleError(platform: StreamPlatform): string {
  if (platform === "twitch") return "Enter a valid Twitch username (letters, numbers, or underscore).";
  if (platform === "youtube") return "Enter a valid YouTube handle (letters, numbers, period, hyphen, or underscore).";
  return "Enter a valid TikTok username (letters, numbers, period, or underscore).";
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

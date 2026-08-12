import { recApi } from "./rec-api.js";

// Used to pick CFB-appropriate labels/behavior (University Name / Team Name, CFB-style Discord
// nicknames, etc.) vs Madden's City/Mascot conventions.
// Prefer deriving from the conferences payload (already fetched by /openteams) so Discord-only
// users never depend on a separate open-teams auth path just to pick CFB vs Madden layout.
export function isCfbGame(game?: string | null): boolean {
  return game === "cfb_27";
}

export async function isCfbLeague(guildId: string): Promise<boolean> {
  const result = await recApi.getLeagueConferences(guildId).catch(() => null);
  if (result && "league" in result && isCfbGame((result as { league?: { game?: string | null } }).league?.game)) {
    return true;
  }
  // Fallback for older API responses without league.game — CFB catalogs are never just AFC/NFC.
  const conferences = (result as { conferences?: Array<{ conference?: string }> } | null)?.conferences ?? [];
  if (!conferences.length) return false;
  return conferences.some((conference) => {
    const name = String(conference.conference ?? "").toUpperCase();
    return name !== "AFC" && name !== "NFC" && name !== "OTHER" && name.length > 0;
  });
}

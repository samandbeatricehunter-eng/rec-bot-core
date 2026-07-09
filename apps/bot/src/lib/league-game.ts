import { recApi } from "./rec-api.js";

// Used to pick CFB-appropriate labels/behavior (University Name / Team Name, CFB-style Discord
// nicknames, etc.) vs Madden's City/Mascot conventions. getOpenTeams already returns the league
// row cheaply, so this is a lightweight lookup rather than a dedicated league-config fetch.
export async function isCfbLeague(guildId: string): Promise<boolean> {
  const result = await recApi.getOpenTeams(guildId).catch(() => null);
  return result?.league?.game === "cfb_27";
}

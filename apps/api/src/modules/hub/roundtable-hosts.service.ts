import { generateRecPlayerName, getRoundtablePersonality, isRealSportsAnalystName, REC_ROUNDTABLE_PERSONALITIES } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { ANALYST_META, type AnalystMetaOverrides, type AnalystVoice } from "./roundtable-take-bank.js";

const VOICE_KEYS: AnalystVoice[] = ["caleb", "maya", "theo", "nina"];

async function userIdFromDiscord(discordId: string) {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load your REC account.", account.error);
  return account.data?.user_id ?? null;
}

// Called from story-publishing.ts before rendering a roundtable — falls back silently to the
// defaults on any error so a broken override row never blocks article generation.
export async function loadHostOverridesForLeague(leagueId: string): Promise<AnalystMetaOverrides> {
  const rows = await supabase.from("rec_roundtable_host_overrides").select("voice_key,display_name,personality_key").eq("league_id", leagueId);
  if (rows.error || !rows.data?.length) return {};
  const overrides: AnalystMetaOverrides = {};
  for (const row of rows.data) {
    const voice = row.voice_key as AnalystVoice;
    const personality = getRoundtablePersonality(row.personality_key);
    overrides[voice] = { speaker: row.display_name, role: personality?.label ?? ANALYST_META[voice].role, personalityDescription: personality?.description };
  }
  return overrides;
}

export async function getRoundtableHostConfig(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const rows = await supabase.from("rec_roundtable_host_overrides").select("voice_key,display_name,personality_key").eq("league_id", context.leagueId);
  if (rows.error) throw new ApiError(500, "Failed to load roundtable hosts.", rows.error);
  const byVoice = new Map<string, { display_name: string; personality_key: string }>(
    (rows.data ?? []).map((r: any) => [r.voice_key, r]),
  );
  return {
    hosts: VOICE_KEYS.map((voice) => {
      const override = byVoice.get(voice);
      return {
        voice,
        displayName: override?.display_name ?? ANALYST_META[voice].speaker,
        role: ANALYST_META[voice].role,
        personalityKey: override?.personality_key ?? null,
        isCustom: Boolean(override),
      };
    }),
    personalities: REC_ROUNDTABLE_PERSONALITIES,
  };
}

export async function updateRoundtableHost(input: {
  guildId: string;
  discordId: string;
  voice: AnalystVoice;
  displayName: string;
  personalityKey: string;
}) {
  if (!VOICE_KEYS.includes(input.voice)) throw new ApiError(400, "Invalid roundtable voice.");
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 60) throw new ApiError(400, "Host name must be 1-60 characters.");
  if (isRealSportsAnalystName(displayName)) {
    throw new ApiError(400, "That name matches a real-world sports analyst — pick a different name for your roundtable host.");
  }
  if (!getRoundtablePersonality(input.personalityKey)) throw new ApiError(400, "Invalid personality.");

  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const { error } = await supabase.from("rec_roundtable_host_overrides").upsert({
    league_id: context.leagueId,
    voice_key: input.voice,
    display_name: displayName,
    personality_key: input.personalityKey,
    updated_by_user_id: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "league_id,voice_key" });
  if (error) throw new ApiError(500, "Failed to save roundtable host.", error);
  return { ok: true as const };
}

export async function resetRoundtableHost(input: { guildId: string; voice: AnalystVoice }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const { error } = await supabase.from("rec_roundtable_host_overrides").delete().eq("league_id", context.leagueId).eq("voice_key", input.voice);
  if (error) throw new ApiError(500, "Failed to reset roundtable host.", error);
  return { ok: true as const };
}

// Reuses the same deterministic seeded generator the custom-player wizard uses, retrying with
// a different seed suffix whenever the result collides with the real-analyst blocklist.
export function generateRoundtableHostName(seed: string): { fullName: string } {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = generateRecPlayerName(attempt === 0 ? seed : `${seed}:${attempt}`);
    if (!isRealSportsAnalystName(candidate.fullName)) return { fullName: candidate.fullName };
  }
  throw new ApiError(500, "Failed to generate a usable name — try again.");
}

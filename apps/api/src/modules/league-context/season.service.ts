import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "./league-context.service.js";

export function resolveSeasonNumber(
  context: Awaited<ReturnType<typeof getCurrentLeagueContext>>,
  seasonNumber?: number | null
) {
  return Number(seasonNumber ?? context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
}

export async function resolveSeasonId(leagueId: string, seasonNumber: number) {
  const existing = await supabase
    .from("rec_seasons")
    .select("id")
    .eq("league_id", leagueId)
    .eq("display_season_number", seasonNumber)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to resolve league season.", existing.error);
  if (existing.data?.id) return existing.data.id;

  const now = new Date().toISOString();
  const created = await supabase
    .from("rec_seasons")
    .insert({
      league_id: leagueId,
      display_season_number: seasonNumber,
      phase: "regular_season",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (created.error) throw new ApiError(500, "Failed to create league season.", created.error);
  return created.data.id;
}

export async function resolveSeasonContext(guildId: string, seasonNumber?: number | null) {
  const context = await getCurrentLeagueContext(guildId);
  const selectedSeason = resolveSeasonNumber(context, seasonNumber);
  const seasonId = await resolveSeasonId(context.leagueId, selectedSeason);
  return { context, selectedSeason, seasonId };
}

// Media Day gate (Post-Advance Experience). Blocks the site until the user has answered Media Day
// for the league's current week/stage "period" -- but ONLY once MEDIA_DAY_GATE_ENABLED is flipped
// on, once the full flow (Rewards Recap, question banks, answer-driven challenge targeting) is
// built end to end. Until then, getMediaDayGateStatus always reports `required: false` so this is
// completely inert in production -- the schema, period-opening, and status plumbing can land and
// be exercised safely well before the gate can actually strand anyone.
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { loadImmortalityLeague } from "../immortality/immortality.service.js";
import { stageLabel, type LeagueGame } from "@rec/shared";

export const MEDIA_DAY_GATE_ENABLED = false;

/** Opens (idempotently) the Media Day period for the week/stage a league just advanced INTO --
 * call right after setLeagueWeek with the new target, not the week that just completed. */
export async function ensureMediaDayPeriodOpen(input: {
  leagueId: string; seasonNumber: number; weekNumber: number; seasonStage: string;
}): Promise<void> {
  await supabase.from("rec_media_day_periods").upsert({
    league_id: input.leagueId, season_number: input.seasonNumber,
    week_number: input.weekNumber, season_stage: input.seasonStage,
  }, { onConflict: "league_id,season_number,week_number,season_stage", ignoreDuplicates: true });
}

/** The subject keys one user must complete for a period. RTI leagues already have their own,
 * separate, working Media Day system (three interview panels on the RTI Overview page) -- this
 * new gate deliberately does not cover them yet, the same way the Universal Record Book excludes
 * RTI leagues. Unifying RTI onto this gate is a later consolidation, not part of this build. */
async function requiredSubjectKeysForUser(leagueId: string, userId: string): Promise<string[]> {
  const immortality = await loadImmortalityLeague(leagueId);
  if (immortality) return [];
  void userId;
  return ["team"];
}

export type MediaDayGateStatus = {
  required: boolean;
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  seasonStage: string;
  weekLabel: string;
  missingSubjectKeys: string[];
};

export async function getMediaDayGateStatus(input: { guildId: string; discordId: string }): Promise<MediaDayGateStatus> {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = Number(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = Number(league.current_week ?? 1);
  const seasonStage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const weekLabel = stageLabel(seasonStage, weekNumber, league.game as LeagueGame);
  const none: MediaDayGateStatus = { required: false, leagueId: context.leagueId, seasonNumber, weekNumber, seasonStage, weekLabel, missingSubjectKeys: [] };
  if (!MEDIA_DAY_GATE_ENABLED) return none;

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const userId = account.data?.user_id ? String(account.data.user_id) : null;
  if (!userId) return none;

  const period = await supabase.from("rec_media_day_periods").select("id")
    .eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("season_stage", seasonStage)
    .maybeSingle();
  if (!period.data) return none;

  const required = await requiredSubjectKeysForUser(context.leagueId, userId);
  if (!required.length) return none;

  const completions = await supabase.from("rec_media_day_completions").select("subject_key")
    .eq("period_id", period.data.id).eq("user_id", userId);
  const completedKeys = new Set((completions.data ?? []).map((row) => String(row.subject_key)));
  const missingSubjectKeys = required.filter((key) => !completedKeys.has(key));

  return { ...none, required: missingSubjectKeys.length > 0, missingSubjectKeys };
}

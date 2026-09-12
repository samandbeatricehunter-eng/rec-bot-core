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

export type MediaDayGateStatus = {
  required: boolean;
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  seasonStage: string;
  weekLabel: string;
  isRti: boolean;
  missingSubjectKeys: string[];
};

/** RTI's own interview systems (immortality.service.ts's getWeeklyMatchupInterview /
 * getOwnerWeeklyInterview) already track their own frozen answers and a `complete` flag per
 * (subject, period) -- rather than duplicating that state into rec_media_day_completions, this
 * reads it straight from the source so there's exactly one place completion can ever be wrong.
 * Subject keys are "owner" and "prospect:offense" / "prospect:defense" (RTI addresses a user's
 * prospects by side, since a user has at most one prospect per side -- not by prospect id). A
 * subject whose interview window has already closed is dropped from the requirement entirely:
 * forcing an answer into a closed window makes no sense, and RTI's own systems already decide
 * that independently of this gate. */
async function rtiMissingSubjectKeys(input: { guildId: string; discordId: string; immortalityLeagueId: string; userId: string }): Promise<string[]> {
  const { getWeeklyMatchupInterview, getOwnerWeeklyInterview } = await import("../immortality/immortality.service.js");
  const missing: string[] = [];

  const ownerAssignment = await supabase.from("rec_immortality_user_team_assignments")
    .select("user_id").eq("immortality_league_id", input.immortalityLeagueId).eq("user_id", input.userId).limit(1);
  if (ownerAssignment.data?.length) {
    const owner = await getOwnerWeeklyInterview({ guildId: input.guildId, discordId: input.discordId }).catch(() => null);
    if (owner && !owner.complete) missing.push("owner");
  }

  const prospects = await supabase.from("rec_immortality_prospects")
    .select("side").eq("immortality_league_id", input.immortalityLeagueId).eq("user_id", input.userId);
  for (const side of new Set((prospects.data ?? []).map((row) => String(row.side))) as Set<"offense" | "defense">) {
    const interview = await getWeeklyMatchupInterview({ guildId: input.guildId, discordId: input.discordId, side }).catch(() => null);
    if (interview && !interview.complete && !interview.windowClosed) missing.push(`prospect:${side}`);
  }

  return missing;
}

export async function getMediaDayGateStatus(input: { guildId: string; discordId: string }): Promise<MediaDayGateStatus> {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = Number(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = Number(league.current_week ?? 1);
  const seasonStage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const weekLabel = stageLabel(seasonStage, weekNumber, league.game as LeagueGame);
  const immortality = await loadImmortalityLeague(context.leagueId);
  const none: MediaDayGateStatus = { required: false, leagueId: context.leagueId, seasonNumber, weekNumber, seasonStage, weekLabel, isRti: Boolean(immortality), missingSubjectKeys: [] };
  if (!MEDIA_DAY_GATE_ENABLED) return none;

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const userId = account.data?.user_id ? String(account.data.user_id) : null;
  if (!userId) return none;

  if (immortality) {
    const missingSubjectKeys = await rtiMissingSubjectKeys({ guildId: input.guildId, discordId: input.discordId, immortalityLeagueId: immortality.id, userId });
    return { ...none, required: missingSubjectKeys.length > 0, missingSubjectKeys };
  }

  const period = await supabase.from("rec_media_day_periods").select("id")
    .eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("season_stage", seasonStage)
    .maybeSingle();
  if (!period.data) return none;

  const completions = await supabase.from("rec_media_day_completions").select("subject_key")
    .eq("period_id", period.data.id).eq("user_id", userId);
  const completedKeys = new Set((completions.data ?? []).map((row) => String(row.subject_key)));
  const missingSubjectKeys = ["team"].filter((key) => !completedKeys.has(key));

  return { ...none, required: missingSubjectKeys.length > 0, missingSubjectKeys };
}

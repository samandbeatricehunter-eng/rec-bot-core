// Media Day gate (Post-Advance Experience). Blocks the site until the user has answered Media Day
// for the league's current week/stage "period".
//
// Turned back OFF (2026-09-15) after a live acceptance-test recording showed the RTI orchestration
// is broken in a way that can genuinely strand a user: RtiOwnerInterviewScreen/
// RtiProspectInterviewScreen in MediaDayGate.tsx each independently infer "done" (including
// treating windowClosed as done), so a transient/incorrect `missingSubjectKeys` computation can
// skip a required RTI subject permanently for that session, and the reveal screen wasn't reliably
// assembling the RTI prospect-challenge payload. Re-enable only once the server-authoritative
// session/completion model described in the fix plan lands -- getMediaDayGateStatus always
// reports `required: false` while this is false, so the gate stays completely inert.
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { loadImmortalityLeague } from "../immortality/immortality.service.js";
import { stageLabel, type LeagueGame } from "@rec/shared";

export const MEDIA_DAY_GATE_ENABLED = false;

// completeAdvanceWeek sets rec_leagues.advance_in_progress_since at the start of the advance and
// clears it in a `finally` once every step (including the many best-effort side effects after the
// core game-result writes) has finished -- while it's set, nobody, including the commissioner
// running the advance, should see the gate's blocking modal, since current_week/season_stage can
// change well before the rest of the advance (XP crediting, Media Day period open, tweets, etc.)
// has settled. Read fresh (never through getCurrentLeagueContext's 15s cache) so the flag is
// visible the instant it's set. A flag older than this is treated as stale -- e.g. the API process
// crashed mid-advance and never reached the `finally` -- so a league can never get stuck
// gate-suppressed forever.
const ADVANCE_IN_PROGRESS_STALE_MS = 15 * 60 * 1000;

/** Pure so it's directly unit-testable without a Supabase round-trip -- see media-day-gate.service.test.ts. */
export function isAdvanceInProgress(advanceInProgressSince: string | null | undefined, now: number = Date.now()): boolean {
  if (!advanceInProgressSince) return false;
  const since = new Date(advanceInProgressSince).getTime();
  if (Number.isNaN(since)) return false;
  return now - since < ADVANCE_IN_PROGRESS_STALE_MS;
}

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

  const advanceFlag = await supabase.from("rec_leagues").select("advance_in_progress_since").eq("id", context.leagueId).maybeSingle();
  if (isAdvanceInProgress(advanceFlag.data?.advance_in_progress_since as string | null | undefined)) return none;

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

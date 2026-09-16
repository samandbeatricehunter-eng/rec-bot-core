// Media Day gate (Post-Advance Experience). Blocks the site until the user has answered Media Day
// for the league's current week/stage "period".
//
// Turned back OFF on 2026-09-15 after a live acceptance-test recording showed the RTI
// orchestration could genuinely strand a user (each interview screen inferred "done"
// independently, so a subject could silently drop out of the flow). The server-authoritative
// session/completion model (media-day-session.service.ts) replaced that per-screen inference, and
// the real reason "the reveal screen wasn't reliably assembling the RTI prospect-challenge
// payload" -- rec_weekly_challenge_assignments.reason_codes being JSON-stringified against its
// native array column, so every assignment insert failed -- is fixed (see pg-serialize.ts's
// NATIVE_PG_ARRAY_COLUMNS). Re-enabled 2026-09-16 after confirming live against a real RTI
// league's fully-answered week: interviewComplete and challengeIssued both correctly resolve
// true post-fix, and mediaDayComplete/satisfied compute correctly off them.
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { loadImmortalityLeague } from "../immortality/immortality.service.js";
import { stageLabel, type LeagueGame } from "@rec/shared";

export const MEDIA_DAY_GATE_ENABLED = true;

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

  // Single source of truth for "is anything still required" -- see media-day-session.service.ts.
  // Dynamic import to avoid a static circular dependency (that module imports
  // MEDIA_DAY_GATE_ENABLED from this one).
  const { getMediaDaySessionStatus } = await import("./media-day-session.service.js");
  const session = await getMediaDaySessionStatus(input);
  const missingSubjectKeys = [
    session.team && !session.team.satisfied ? "team" : null,
    session.offense && !session.offense.satisfied ? "prospect:offense" : null,
    session.defense && !session.defense.satisfied ? "prospect:defense" : null,
    session.owner && !session.owner.satisfied ? "owner" : null,
  ].filter((key): key is string => key != null);

  return { ...none, required: !session.mediaDayComplete, missingSubjectKeys };
}

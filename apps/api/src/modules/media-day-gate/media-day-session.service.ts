// The Media Day "session" -- a single server-computed snapshot of exactly which required blocks
// (RTI: offense prospect, defense prospect, owner; non-RTI: team) are actually satisfied for this
// user/league/season/week, so the frontend never has to infer completion itself.
//
// Before this existed, MediaDayGate.tsx's RtiInterviewFlow walked a fixed subjectKeys array
// (built once by media-day-gate.service.ts's old rtiMissingSubjectKeys) and each interview screen
// independently decided it was "done" -- including treating windowClosed as done, and never
// checking whether that subject's weekly challenge had actually been issued at all. That let a
// subject silently drop out of the flow (a transient windowClosed reading, or a broken challenge
// assembly) with nothing downstream ever re-checking it. Every screen must now re-fetch this
// status after every answer instead of stepping a local index, and mediaDayComplete is the one
// flag allowed to end the gate.
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { loadImmortalityLeague } from "../immortality/immortality.service.js";
import { MEDIA_DAY_GATE_ENABLED } from "./media-day-gate.service.js";

export type MediaDaySubjectStatus = {
  /** false when this league/user has no such subject at all (e.g. no defense prospect) or the
   *  subject has no content available this stage/window -- never blocks mediaDayComplete. */
  required: boolean;
  interviewComplete: boolean;
  /** True only when the interview's answer window closed before every question was answered --
   *  kept distinct from interviewComplete so the UI can show an honest "window closed" state
   *  instead of presenting it as a normal completion. */
  windowClosed: boolean;
  challengeIssued: boolean;
  /** required=false, or (windowClosed, or both interviewComplete and challengeIssued). The only
   *  field callers should use to decide whether this subject still blocks the gate. */
  satisfied: boolean;
};

export type MediaDaySessionStatus = {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  seasonStage: string;
  isRti: boolean;
  offense: MediaDaySubjectStatus | null;
  defense: MediaDaySubjectStatus | null;
  owner: MediaDaySubjectStatus | null;
  team: MediaDaySubjectStatus | null;
  mediaDayComplete: boolean;
};

const NOT_REQUIRED: MediaDaySubjectStatus = { required: false, interviewComplete: false, windowClosed: false, challengeIssued: false, satisfied: true };

/** The one rule the whole redesign hinges on -- pure so it's directly unit-testable without a
 * Supabase round-trip (see media-day-session.service.test.ts). A subject that isn't required is
 * always satisfied. A subject whose answer window closed is satisfied regardless of the other two
 * fields -- there's nothing further the user can do about it. Otherwise BOTH the interview must be
 * fully answered AND that side's weekly challenge must actually be issued; interviewComplete alone
 * (the old bug) is not enough. */
export function subjectSatisfied(input: { required: boolean; interviewComplete: boolean; windowClosed: boolean; challengeIssued: boolean }): boolean {
  if (!input.required) return true;
  return input.windowClosed || (input.interviewComplete && input.challengeIssued);
}

async function resolveRtiProspectStatus(input: {
  guildId: string; discordId: string; leagueId: string; immortalityLeagueId: string; userId: string;
  seasonNumber: number; weekNumber: number; side: "offense" | "defense";
}): Promise<MediaDaySubjectStatus> {
  const prospect = await supabase.from("rec_immortality_prospects").select("id")
    .eq("immortality_league_id", input.immortalityLeagueId).eq("user_id", input.userId).eq("side", input.side).maybeSingle();
  if (!prospect.data) return NOT_REQUIRED;

  const { getWeeklyMatchupInterview } = await import("../immortality/immortality.service.js");
  // Same fallback as the old rtiMissingSubjectKeys: a thrown lookup (no matchup context resolvable
  // yet, no content for this stage) means there's nothing to require here, not a stuck requirement.
  const interview = await getWeeklyMatchupInterview({ guildId: input.guildId, discordId: input.discordId, side: input.side }).catch(() => null);
  if (!interview) return NOT_REQUIRED;

  const { weeklyChallengesForUser } = await import("../immortality/xp-awards.service.js");
  const views = await weeklyChallengesForUser({
    leagueId: input.leagueId, userId: input.userId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber,
  }).catch(() => []);
  const challengeIssued = Boolean(views.find((view) => view.side === input.side)?.challenges.length);

  const interviewComplete = interview.complete;
  const windowClosed = interview.windowClosed;
  return {
    required: true, interviewComplete, windowClosed, challengeIssued,
    satisfied: subjectSatisfied({ required: true, interviewComplete, windowClosed, challengeIssued }),
  };
}

async function resolveRtiOwnerStatus(input: {
  guildId: string; discordId: string; immortalityLeagueId: string; userId: string;
}): Promise<MediaDaySubjectStatus> {
  const ownerAssignment = await supabase.from("rec_immortality_user_team_assignments").select("user_id")
    .eq("immortality_league_id", input.immortalityLeagueId).eq("user_id", input.userId).limit(1);
  if (!ownerAssignment.data?.length) return NOT_REQUIRED;

  const { getOwnerWeeklyInterview } = await import("../immortality/immortality.service.js");
  // Same fallback as above: a season stage with no owner interview content throws rather than
  // returning an empty/complete result -- treat that as "nothing to require," not "stuck."
  const interview = await getOwnerWeeklyInterview({ guildId: input.guildId, discordId: input.discordId }).catch(() => null);
  if (!interview) return NOT_REQUIRED;

  const { getMyMediaDayChallengeReveal } = await import("../media-day/media-day-interview.service.js");
  const reveal = await getMyMediaDayChallengeReveal({ guildId: input.guildId, discordId: input.discordId }).catch(() => []);
  const challengeIssued = reveal.length > 0;
  const interviewComplete = interview.complete;
  return {
    required: true, interviewComplete, windowClosed: false, challengeIssued,
    satisfied: subjectSatisfied({ required: true, interviewComplete, windowClosed: false, challengeIssued }),
  };
}

async function resolveTeamStatus(input: { guildId: string; discordId: string }): Promise<MediaDaySubjectStatus> {
  const { getMyMediaDayInterview, getMyMediaDayChallengeReveal } = await import("../media-day/media-day-interview.service.js");
  const interview = await getMyMediaDayInterview(input).catch(() => null);
  if (!interview || !interview.periodId) return NOT_REQUIRED;
  const reveal = await getMyMediaDayChallengeReveal(input).catch(() => []);
  const challengeIssued = reveal.length > 0;
  const interviewComplete = interview.complete;
  return {
    required: true, interviewComplete, windowClosed: false, challengeIssued,
    satisfied: subjectSatisfied({ required: true, interviewComplete, windowClosed: false, challengeIssued }),
  };
}

export async function getMediaDaySessionStatus(input: { guildId: string; discordId: string }): Promise<MediaDaySessionStatus> {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = Number(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = Number(league.current_week ?? 1);
  const seasonStage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const isRti = Boolean(await loadImmortalityLeague(context.leagueId));

  const inert: MediaDaySessionStatus = {
    leagueId: context.leagueId, seasonNumber, weekNumber, seasonStage, isRti,
    offense: null, defense: null, owner: null, team: null, mediaDayComplete: true,
  };
  if (!MEDIA_DAY_GATE_ENABLED) return inert;

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const userId = account.data?.user_id ? String(account.data.user_id) : null;
  if (!userId) return inert;

  if (isRti) {
    const immortality = await loadImmortalityLeague(context.leagueId);
    if (!immortality) return inert;
    const [offense, defense, owner] = await Promise.all([
      resolveRtiProspectStatus({ guildId: input.guildId, discordId: input.discordId, leagueId: context.leagueId, immortalityLeagueId: String(immortality.id), userId, seasonNumber, weekNumber, side: "offense" }),
      resolveRtiProspectStatus({ guildId: input.guildId, discordId: input.discordId, leagueId: context.leagueId, immortalityLeagueId: String(immortality.id), userId, seasonNumber, weekNumber, side: "defense" }),
      resolveRtiOwnerStatus({ guildId: input.guildId, discordId: input.discordId, immortalityLeagueId: String(immortality.id), userId }),
    ]);
    return {
      leagueId: context.leagueId, seasonNumber, weekNumber, seasonStage, isRti: true,
      offense, defense, owner, team: null,
      mediaDayComplete: offense.satisfied && defense.satisfied && owner.satisfied,
    };
  }

  const team = await resolveTeamStatus({ guildId: input.guildId, discordId: input.discordId });
  return {
    leagueId: context.leagueId, seasonNumber, weekNumber, seasonStage, isRti: false,
    offense: null, defense: null, owner: null, team,
    mediaDayComplete: team.satisfied,
  };
}

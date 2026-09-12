// Media Day rebuild Phase D: the non-RTI weekly interview itself -- two questions (offense,
// defense), each tied to that side's already-issued weekly challenge (issued here if it hasn't
// been yet, so there's something to ask about before any box score exists), pulled from the
// uploaded package's real question/answer content (packages/shared/src/media-day/content.ts).
// RTI leagues keep their own separate, existing interview systems (immortality.service.ts's
// getWeeklyMatchupInterview/getOwnerWeeklyInterview) for the actual Q&A -- this file's non-RTI
// functions never run for them (see media-day-gate.service.ts's rtiMissingSubjectKeys). The one
// RTI-specific piece that DOES live here is getMyRtiProspectChallengeReveal at the bottom, since
// the owner's OWN team-level challenge reveal already comes for free from
// getMyMediaDayChallengeReveal below (resolveIssuedEntry doesn't distinguish RTI from non-RTI --
// an RTI owner's team is a real rec_teams row like any other).
import {
  mediaDayAnswerOptions, pickMediaDayQuestion, renderMediaDayTemplate, tweetFixedAccounts,
  weeklyChallengeTierRequirementLines, type TweetFixedAccountKey, type WeeklyChallengeSide, type WeeklyChallengeTier,
} from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveIssuedEntry } from "../weekly-challenges/weekly-challenge-issuance.service.js";

const SIDES: WeeklyChallengeSide[] = ["offense", "defense"];

function pickIndex(seed: string, length: number): number {
  let hash = 13;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return length ? hash % length : 0;
}

// The uploaded question bank's reporter_beats vocabulary (passing/rushing/pass_defense/etc, an
// EA-style stat-category taxonomy) shares no vocabulary at all with tweet_personalities.json's
// primary_beats (roster construction/rivalries/momentum/etc, a narrative-theme taxonomy) -- the
// two banks were authored independently and can't be string-matched. This is a hand-curated
// weighting onto the two personas whose actual persona description is built around X's-and-O's
// analysis (Elliot Mercer: "The Strategist"/efficiency/scheme; Gridiron Gospel: "The Film
// Columnist"/matchup tendencies/scheme fit) leaning heaviest for these strategy-flavored weekly
// challenge questions, with the others still reachable but less likely -- an editorial judgment
// call, not a literal beat match, same kind of call record-book.service.ts already makes for
// which personas react to a record break.
const CATEGORY_PERSONA_WEIGHTS: Partial<Record<TweetFixedAccountKey, number>> = {
  elliot: 4, gridiron_gospel: 4, marcus: 2, darius: 2, vaughn: 1, rec_insider: 1, nfl_front_office: 1, tmz: 1,
};

/** Deterministic weighted reporter assignment per (team, week, side) -- same weights every call
 * for a given seed (so re-fetching the interview before answering never swaps the byline), picked
 * via a hash-seeded cumulative-weight walk instead of Math.random() for that determinism. */
function pickReporter(seed: string): { key: string; displayName: string; headshotUrl: string } {
  const accounts = tweetFixedAccounts();
  const weighted = accounts.map((account) => ({ account, weight: CATEGORY_PERSONA_WEIGHTS[account.key] ?? 1 }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = pickIndex(seed, totalWeight);
  let cumulative = 0;
  for (const entry of weighted) {
    cumulative += entry.weight;
    if (roll < cumulative) return { key: entry.account.key, displayName: entry.account.display, headshotUrl: entry.account.headshotUrl };
  }
  const fallback = weighted[weighted.length - 1]!.account;
  return { key: fallback.key, displayName: fallback.display, headshotUrl: fallback.headshotUrl };
}

export type MediaDayInterviewQuestion = {
  side: WeeklyChallengeSide;
  questionId: string;
  questionText: string;
  answerFamily: string;
  reporterName: string;
  reporterHeadshotUrl: string;
  options: Array<{ key: string; text: string }>;
  answered: boolean;
  answerKey: string | null;
};

export type MediaDayInterviewResult = {
  periodId: string | null;
  teamName: string;
  questions: MediaDayInterviewQuestion[];
  complete: boolean;
};

async function resolveTeamAndOpponentNames(leagueId: string, teamId: string, seasonNumber: number, weekNumber: number): Promise<{ teamName: string; opponentName: string }> {
  const team = await supabase.from("rec_teams").select("name").eq("id", teamId).maybeSingle();
  const teamName = team.data?.name ?? "Your team";

  const game = await supabase.from("rec_games").select("home_team_id,away_team_id")
    .eq("league_id", leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`).maybeSingle();
  if (!game.data) return { teamName, opponentName: "your opponent" };
  const opponentTeamId = String(game.data.home_team_id) === teamId ? game.data.away_team_id : game.data.home_team_id;
  if (!opponentTeamId) return { teamName, opponentName: "your opponent" };
  const opponent = await supabase.from("rec_teams").select("name").eq("id", opponentTeamId).maybeSingle();
  return { teamName, opponentName: opponent.data?.name ?? "your opponent" };
}

/** Resolves the caller's team and current period, issuing (not grading) each side's weekly
 * challenge if it hasn't been yet, and returns the two Media Day questions plus any answers this
 * user has already submitted this period. */
export async function getMyMediaDayInterview(input: { guildId: string; discordId: string }): Promise<MediaDayInterviewResult> {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = Number(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = Number(league.current_week ?? 1);
  const seasonStage = String(league.season_stage ?? league.current_phase ?? "regular_season");

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const userId = account.data?.user_id ? String(account.data.user_id) : null;
  const assignment = userId
    ? await supabase.from("rec_team_assignments").select("team_id")
        .eq("league_id", context.leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle()
    : { data: null as { team_id: string } | null };
  const teamId = assignment.data?.team_id ? String(assignment.data.team_id) : null;
  if (!userId || !teamId) return { periodId: null, teamName: "Your team", questions: [], complete: true };

  const period = await supabase.from("rec_media_day_periods").select("id")
    .eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("season_stage", seasonStage)
    .maybeSingle();
  if (!period.data) return { periodId: null, teamName: "Your team", questions: [], complete: true };
  const periodId = String(period.data.id);

  const { teamName, opponentName } = await resolveTeamAndOpponentNames(context.leagueId, teamId, seasonNumber, weekNumber);
  const existingAnswers = await supabase.from("rec_media_day_challenge_answers")
    .select("side,answer_key").eq("period_id", periodId).eq("user_id", userId);
  const answeredBySide = new Map<string, string>((existingAnswers.data ?? []).map((row) => [String(row.side), String(row.answer_key)]));

  const questions: MediaDayInterviewQuestion[] = [];
  for (const side of SIDES) {
    const issued = await resolveIssuedEntry({ leagueId: context.leagueId, teamId, seasonNumber, weekNumber, side });
    if (!issued) continue;
    const seed = `${teamId}:${seasonNumber}:${weekNumber}:${side}`;
    const variant = pickMediaDayQuestion(issued.entry.id, seed);
    if (!variant) continue;
    const questionText = renderMediaDayTemplate(variant.question, { team_name: teamName, opponent_team: opponentName });
    const options = mediaDayAnswerOptions(variant.answer_family).map((option) => ({ key: option.key, text: option.text }));
    const reporter = pickReporter(`${seed}:reporter`);
    questions.push({
      side, questionId: variant.id, questionText, answerFamily: variant.answer_family,
      reporterName: reporter.displayName, reporterHeadshotUrl: reporter.headshotUrl, options,
      answered: answeredBySide.has(side), answerKey: answeredBySide.get(side) ?? null,
    });
  }

  const complete = questions.length > 0 && questions.every((q) => q.answered);
  return { periodId, teamName, questions, complete };
}

/** Records one side's answer (frozen wording + semantic intent), then marks the "team" subject
 * complete for this period once both sides are answered. */
export async function submitMyMediaDayAnswer(input: {
  guildId: string; discordId: string; side: WeeklyChallengeSide; questionId: string; answerKey: string;
}): Promise<{ complete: boolean }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = Number(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = Number(league.current_week ?? 1);
  const seasonStage = String(league.season_stage ?? league.current_phase ?? "regular_season");

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const userId = account.data?.user_id ? String(account.data.user_id) : null;
  const assignment = userId
    ? await supabase.from("rec_team_assignments").select("team_id")
        .eq("league_id", context.leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle()
    : { data: null as { team_id: string } | null };
  const teamId = assignment.data?.team_id ? String(assignment.data.team_id) : null;
  if (!userId || !teamId) throw new Error("No active team to answer Media Day for.");

  const period = await supabase.from("rec_media_day_periods").select("id")
    .eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("season_stage", seasonStage)
    .maybeSingle();
  if (!period.data) throw new Error("Media Day is not open right now.");
  const periodId = String(period.data.id);

  const issued = await resolveIssuedEntry({ leagueId: context.leagueId, teamId, seasonNumber, weekNumber, side: input.side });
  if (!issued) throw new Error("No weekly challenge issued for this side yet.");
  const seed = `${teamId}:${seasonNumber}:${weekNumber}:${input.side}`;
  const variant = pickMediaDayQuestion(issued.entry.id, seed);
  if (!variant || variant.id !== input.questionId) throw new Error("This question is no longer current.");
  const option = mediaDayAnswerOptions(variant.answer_family).find((candidate) => candidate.key === input.answerKey);
  if (!option) throw new Error("That answer option isn't valid for this question.");

  const { teamName, opponentName } = await resolveTeamAndOpponentNames(context.leagueId, teamId, seasonNumber, weekNumber);
  const questionText = renderMediaDayTemplate(variant.question, { team_name: teamName, opponent_team: opponentName });

  await supabase.from("rec_media_day_challenge_answers").upsert({
    period_id: periodId, user_id: userId, subject_key: "team", side: input.side, challenge_id: issued.entry.id,
    question_id: variant.id, question_text: questionText, answer_key: option.key, answer_text: option.text,
    answer_intent: option.intent,
  }, { onConflict: "period_id,user_id,subject_key,side" });

  // Logged as a real media_statement event -- gives the already-shipped claim-plan tweet engine
  // and story-arc system (Phase 1c) a verified fact to reference later ("the team said X going
  // into this game"), the concrete way this week's answers stay "tied into" the league's ongoing
  // narrative without inventing a separate, parallel tracking mechanism. Best-effort: a logging
  // failure must never block the answer itself from saving.
  const { logMediaEvent } = await import("../immortality/media-events.service.js");
  await logMediaEvent({
    leagueId: context.leagueId, seasonNumber, weekNumber, eventType: "media_statement",
    teamId, userId, importanceScore: 20,
    facts: { factLine: `${teamName} on ${input.side}: "${questionText}" -> "${option.text}"`, side: input.side, challengeId: issued.entry.id, questionId: variant.id, answerKey: option.key, intent: option.intent },
  }).catch((error) => console.error("[ERROR] logMediaEvent for Media Day answer failed (non-fatal):", error));

  const answers = await supabase.from("rec_media_day_challenge_answers").select("side").eq("period_id", periodId).eq("user_id", userId);
  const answeredSides = new Set((answers.data ?? []).map((row) => String(row.side)));
  const complete = SIDES.every((side) => answeredSides.has(side));
  if (complete) {
    await supabase.from("rec_media_day_completions").upsert({
      period_id: periodId, user_id: userId, subject_key: "team",
    }, { onConflict: "period_id,user_id,subject_key", ignoreDuplicates: true });
  }
  return { complete };
}

export type MediaDayChallengeReveal = {
  side: WeeklyChallengeSide;
  challengeName: string;
  tiers: Array<{ tier: WeeklyChallengeTier; lines: string[] }>;
};

/** Shown right after both sides are answered: the challenge names (secret until now) and their
 * cumulative stat-line requirements per tier -- never raw Bronze/Silver/Gold point values, just
 * what the team is actually being held to. */
export async function getMyMediaDayChallengeReveal(input: { guildId: string; discordId: string }): Promise<MediaDayChallengeReveal[]> {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = Number(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = Number(league.current_week ?? 1);

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const userId = account.data?.user_id ? String(account.data.user_id) : null;
  const assignment = userId
    ? await supabase.from("rec_team_assignments").select("team_id")
        .eq("league_id", context.leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle()
    : { data: null as { team_id: string } | null };
  const teamId = assignment.data?.team_id ? String(assignment.data.team_id) : null;
  if (!teamId) return [];

  const reveals: MediaDayChallengeReveal[] = [];
  for (const side of SIDES) {
    const issued = await resolveIssuedEntry({ leagueId: context.leagueId, teamId, seasonNumber, weekNumber, side });
    if (!issued) continue;
    reveals.push({
      side, challengeName: issued.entry.name,
      tiers: (["bronze", "silver", "gold"] as const).map((tier) => ({ tier, lines: weeklyChallengeTierRequirementLines(issued.entry, tier) })),
    });
  }
  return reveals;
}

export type RtiProspectChallengeReveal = {
  prospectId: string; side: string; name: string;
  tiers: Array<{ tier: string; label: string; complete: boolean }>;
};

/** RTI counterpart to getMyMediaDayChallengeReveal, for the prospect(s) this user owns --
 * reuses weeklyChallengesForUser (xp-awards.service.ts) unchanged, the exact same
 * frozen-issuance read gradeProspectForWeek grades against, so this always shows precisely what
 * the eventual grading pass will hold the prospect to. Labels are already human-readable text
 * from the RTI challenge catalog (packages/shared/src/immortality/challenges.ts) -- no separate
 * condition-to-text renderer needed the way the non-RTI team-challenge reveal required one. */
export async function getMyRtiProspectChallengeReveal(input: { guildId: string; discordId: string }): Promise<RtiProspectChallengeReveal[]> {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = Number(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = Number(league.current_week ?? 1);

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const userId = account.data?.user_id ? String(account.data.user_id) : null;
  if (!userId) return [];

  const { weeklyChallengesForUser } = await import("../immortality/xp-awards.service.js");
  const views = await weeklyChallengesForUser({ leagueId: context.leagueId, userId, seasonNumber, weekNumber });
  return views.map((view) => ({
    prospectId: view.prospectId, side: view.side, name: view.name,
    tiers: view.challenges.map((challenge) => ({ tier: challenge.tier, label: challenge.label, complete: challenge.complete })),
  }));
}

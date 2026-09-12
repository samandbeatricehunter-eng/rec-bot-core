// Media Day rebuild Phase D: the non-RTI weekly interview itself -- two questions (offense,
// defense), each tied to that side's already-issued weekly challenge (issued here if it hasn't
// been yet, so there's something to ask about before any box score exists), pulled from the
// uploaded package's real question/answer content (packages/shared/src/media-day/content.ts).
// RTI leagues keep their own separate, existing Media Day system -- this never runs for them (see
// media-day-gate.service.ts's requiredSubjectKeysForUser).
import {
  mediaDayAnswerOptions, pickMediaDayQuestion, renderMediaDayTemplate, tweetFixedAccounts,
  weeklyChallengeTierRequirementLines, type WeeklyChallengeSide, type WeeklyChallengeTier,
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

/** Deterministic reporter assignment per (team, week, side) -- the uploaded package's own
 * reporter-beat-eligibility metadata was dropped when the question bank was slimmed down (it also
 * wasn't wired into any working beat-eligibility engine), so this is a plain rotation across the
 * 8 fixed accounts rather than a beat-matched pick. Good enough to give every question a
 * consistent, identified voice; refining to real beat-affinity is a fast-follow. */
function pickReporter(seed: string): { key: string; displayName: string } {
  const accounts = tweetFixedAccounts();
  const account = accounts[pickIndex(seed, accounts.length)]!;
  return { key: account.key, displayName: account.display };
}

export type MediaDayInterviewQuestion = {
  side: WeeklyChallengeSide;
  questionId: string;
  questionText: string;
  answerFamily: string;
  reporterName: string;
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
      side, questionId: variant.id, questionText, answerFamily: variant.answer_family, reporterName: reporter.displayName, options,
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

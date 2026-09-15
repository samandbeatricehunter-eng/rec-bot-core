// Media Day commitment ledger (Dev Promotion / Media Overhaul plan, MEDIA-004/005). Every
// submitted Media Day answer is tied 1:1 to that side's already-issued, frozen weekly Gold
// challenge -- see media-day-interview.service.ts's submitMyMediaDayAnswer. The content bank's
// answer options (packages/shared/src/media-day/config/answer_families.json) carry no separate
// "how bold is this claim" signal today -- every family is tone/tactical-posture flavor, not a
// numeric prediction -- so the commitment IS the interview itself: going on record about that
// week's already-frozen Gold bar. recordMediaDayCommitment persists that as a durable, gradeable
// promise; resolveMediaDayCommitmentsAfterAdvance grades it once the week's result is known and
// writes the defended/missed reaction back into the social/storyline engine.
import type { WeeklyChallengeSide } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

export async function recordMediaDayCommitment(input: {
  leagueId: string;
  periodId: string;
  userId: string;
  teamId: string;
  side: WeeklyChallengeSide;
  challengeId: string;
  questionId: string;
  questionText: string;
  answerKey: string;
  answerText: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<void> {
  const inserted = await supabase.from("rec_media_day_commitments").upsert({
    league_id: input.leagueId,
    period_id: input.periodId,
    user_id: input.userId,
    team_id: input.teamId,
    subject_key: "team",
    side: input.side,
    commitment_type: "weekly_challenge_gold",
    challenge_id: input.challengeId,
    question_id: input.questionId,
    question_text: input.questionText,
    answer_key: input.answerKey,
    answer_text: input.answerText,
    target_season_number: input.seasonNumber,
    target_week_number: input.weekNumber,
    status: "pending",
  }, { onConflict: "period_id,user_id,subject_key,side" });
  if (inserted.error) console.error(`[ERROR] Could not record Media Day commitment for user ${input.userId} (non-fatal):`, inserted.error);
}

const RESULT_REACTION_WEIGHTS = { marcus: 2, elliot: 2, vaughn: 1, darius: 1 };

/** Resolves every commitment targeting the week that just advanced against that (team, side)'s
 * final credited tier for the week -- graded_tier is null only when the team never got a box
 * score that week at all (bye, cancelled game, missing data), which is the VOID case; anything
 * else is a real result to defend or miss. Best-effort throughout: a resolution failure for one
 * commitment must never block another's, or the advance itself. */
export async function resolveMediaDayCommitmentsAfterAdvance(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<void> {
  const pending = await supabase.from("rec_media_day_commitments")
    .select("id,user_id,team_id,side,challenge_id,question_text,answer_text")
    .eq("league_id", input.leagueId).eq("status", "pending")
    .eq("target_season_number", input.seasonNumber).eq("target_week_number", input.weekNumber);
  if (pending.error || !pending.data?.length) return;

  for (const commitment of pending.data) {
    try {
      const issued = await supabase.from("rec_weekly_team_challenges_issued")
        .select("graded_tier,name")
        .eq("league_id", input.leagueId).eq("team_id", commitment.team_id)
        .eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber)
        .eq("side", commitment.side).maybeSingle();

      if (!issued.data || issued.data.graded_tier == null) {
        await supabase.from("rec_media_day_commitments")
          .update({ status: "void", resolved_at: new Date().toISOString() })
          .eq("id", commitment.id);
        continue;
      }

      const gradedTier = String(issued.data.graded_tier);
      const defended = gradedTier === "gold";
      await supabase.from("rec_media_day_commitments").update({
        status: defended ? "defended" : "missed",
        result_evidence: { gradedTier },
        resolved_at: new Date().toISOString(),
      }).eq("id", commitment.id);

      await reactToCommitmentResult({
        leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber,
        userId: String(commitment.user_id), teamId: String(commitment.team_id),
        side: commitment.side as WeeklyChallengeSide, defended,
        answerText: String(commitment.answer_text), challengeName: String(issued.data.name ?? "this week's challenge"),
      });
    } catch (error) {
      console.error(`[ERROR] Could not resolve Media Day commitment ${commitment.id} (non-fatal):`, error);
    }
  }
}

/** Writes the verified media_receipt_fulfilled/missed event + storyline touch + reactive-persona
 * tweet(s) -- same claim-grounded pattern nfl-record-holders.service.ts and record-book.service.ts
 * already use for record breaks, reusing the existing "media_day_promise" storyline type and
 * media_receipt_fulfilled/missed playbooks (packages/shared/src/media-social/config), which were
 * already authored for exactly this "prior public statement the result did/didn't support" case. */
async function reactToCommitmentResult(input: {
  leagueId: string; seasonNumber: number; weekNumber: number; userId: string; teamId: string;
  side: WeeklyChallengeSide; defended: boolean; answerText: string; challengeName: string;
}): Promise<void> {
  const team = await supabase.from("rec_teams").select("name").eq("id", input.teamId).maybeSingle();
  const teamName = team.data?.name ?? "This team";
  const eventType = input.defended ? "media_receipt_fulfilled" : "media_receipt_missed";
  const factLine = input.defended
    ? `${teamName} backed up their Media Day word on ${input.side}, hitting the Gold bar on "${input.challengeName}" after saying: "${input.answerText}"`
    : `${teamName} came up short of their Media Day word on ${input.side}, missing the Gold bar on "${input.challengeName}" after saying: "${input.answerText}"`;

  const { logMediaEvent } = await import("../immortality/media-events.service.js");
  await logMediaEvent({
    leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber,
    eventType, teamId: input.teamId, userId: input.userId, importanceScore: 40,
    facts: { factLine, side: input.side, defended: input.defended, challengeName: input.challengeName, answerText: input.answerText },
  }).catch((error) => console.error("[ERROR] logMediaEvent for Media Day commitment result failed (non-fatal):", error));

  const { buildClaimGroundedPostBody, pickReactivePersona, reactivePersonaAuthor } = await import("../immortality/social-claim-engine.js");
  const persona = pickReactivePersona(RESULT_REACTION_WEIGHTS);
  const body = await buildClaimGroundedPostBody({
    leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber,
    eventType, persona, subjectKey: `team:${input.teamId}`, factLine,
    teamId: input.teamId, userId: input.userId,
    storylineTitle: `${teamName}'s Media Day track record`, importanceScore: 40,
  }).catch((error) => { console.error("[ERROR] buildClaimGroundedPostBody for Media Day commitment result failed (non-fatal):", error); return null; });
  if (!body) return;

  const author = reactivePersonaAuthor(persona);
  const queued = await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: input.leagueId, season_number: input.seasonNumber, week_number: input.weekNumber,
    author_kind: author.authorKind, author_handle: author.handle, author_display_name: author.displayName,
    body, status: "pending", source: "media_day_commitment",
  });
  if (queued.error) console.error("[ERROR] Could not queue Media Day commitment reaction tweet (non-fatal):", queued.error);
}

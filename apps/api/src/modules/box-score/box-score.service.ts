import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { parseBoxScoreImages, type ParsedBoxScore } from "./box-score.parser.js";

const BOX_SCORE_PAYOUT_AMOUNT = 50;

// ─── Comeback computation ─────────────────────────────────────────────────────

type ComebackStats = {
  comebackDeficit: number | null;
  comebackDeficitQuarter: number | null;
  comebackRate: number | null;
  comebackWinnerTeamId: string | null;
  fourthQuarterComeback: boolean;
};

function computeComebackStats(
  team1Quarters: number[],
  team2Quarters: number[],
  team1Id: string | null,
  team2Id: string | null,
): ComebackStats {
  const none: ComebackStats = { comebackDeficit: null, comebackDeficitQuarter: null, comebackRate: null, comebackWinnerTeamId: null, fourthQuarterComeback: false };

  const quarters = Math.max(team1Quarters.length, team2Quarters.length);
  if (quarters === 0) return none;

  // Build cumulative scores after each quarter
  const cum1: number[] = [];
  const cum2: number[] = [];
  let s1 = 0, s2 = 0;
  for (let i = 0; i < quarters; i++) {
    s1 += team1Quarters[i] ?? 0;
    s2 += team2Quarters[i] ?? 0;
    cum1.push(s1);
    cum2.push(s2);
  }

  const final1 = cum1[cum1.length - 1] ?? 0;
  const final2 = cum2[cum2.length - 1] ?? 0;
  const team1Won = final1 > final2;
  const team2Won = final2 > final1;
  if (!team1Won && !team2Won) return none; // tie

  // Walk quarter breaks to find max deficit for the winner and 4Q comeback flag
  let maxDeficit = 0;
  let maxDeficitQuarter = 0;
  let fourthQuarterComeback = false;

  for (let i = 0; i < quarters; i++) {
    const q = i + 1;
    const deficit = team1Won ? cum2[i] - cum1[i] : cum1[i] - cum2[i];
    if (deficit > maxDeficit) {
      maxDeficit = deficit;
      maxDeficitQuarter = q;
    }
    // 4th quarter comeback: winner was trailing at end of Q3 (index 2)
    if (i === 2) {
      const trailingAfterQ3 = team1Won ? cum1[i] < cum2[i] : cum2[i] < cum1[i];
      if (trailingAfterQ3) fourthQuarterComeback = true;
    }
  }

  if (maxDeficit === 0) return { ...none, fourthQuarterComeback }; // winner was never behind

  // comeback_rate = deficit / quarters remaining when max deficit occurred
  // floors at 1 so OT/Q4 deficits don't divide by zero
  const quartersRemaining = Math.max(1, 4 - maxDeficitQuarter);
  const comebackRate = Math.round((maxDeficit / quartersRemaining) * 100) / 100;

  return {
    comebackDeficit: maxDeficit,
    comebackDeficitQuarter: maxDeficitQuarter,
    comebackRate,
    comebackWinnerTeamId: team1Won ? team1Id : team2Id,
    fourthQuarterComeback,
  };
}

// ─── Team + game matching ─────────────────────────────────────────────────────

async function resolveTeams(leagueId: string, abbr1: string, abbr2: string) {
  const { data: teams, error } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_abbr")
    .eq("league_id", leagueId);
  if (error) throw new ApiError(500, "Failed to load league teams.", error);

  const match = (abbr: string) =>
    (teams ?? []).find(
      (t) =>
        t.abbreviation?.toUpperCase() === abbr.toUpperCase() ||
        t.display_abbr?.toUpperCase() === abbr.toUpperCase()
    );

  return { team1: match(abbr1) ?? null, team2: match(abbr2) ?? null };
}

async function resolveGame(leagueId: string, team1Id: string, team2Id: string, seasonNumber: number, weekNumber: number) {
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,home_team_id,away_team_id,home_user_id,away_user_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .or(
      `and(home_team_id.eq.${team1Id},away_team_id.eq.${team2Id}),` +
      `and(home_team_id.eq.${team2Id},away_team_id.eq.${team1Id})`
    )
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to match game record.", error);
  return data ?? null;
}

// ─── User lookup ──────────────────────────────────────────────────────────────

async function getDiscordAccount(discordId: string) {
  const { data, error } = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load Discord account.", error);
  if (!data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return data;
}

// ─── Parse + draft ───────────────────────────────────────────────────────────

export type ParseAndDraftInput = {
  guildId: string;
  discordId: string;
  discordChannelId?: string | null;
  discordMessageId?: string | null;
  imageUrl1: string;
  imageUrl2: string;
};

export type ParseAndDraftResult = {
  submissionId: string;
  parsed: ParsedBoxScore;
  team1Name: string | null;
  team2Name: string | null;
  gameMatched: boolean;
};

export async function parseAndDraftSubmission(input: ParseAndDraftInput): Promise<ParseAndDraftResult> {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId);
  const leagueId = context.leagueId;
  const seasonNumber = Number(context.rec_leagues.season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const phase = context.rec_leagues.season_stage ?? null;

  // Run OCR parsing
  const parsed = await parseBoxScoreImages(input.imageUrl1, input.imageUrl2);

  // Try to resolve teams and game
  let homeTeamId: string | null = null;
  let awayTeamId: string | null = null;
  let homeUserId: string | null = null;
  let awayUserId: string | null = null;
  let gameId: string | null = null;
  let team1Name: string | null = null;
  let team2Name: string | null = null;
  let team1Id: string | null = null;
  let team2Id: string | null = null;
  let homeScore: number | null = null;
  let awayScore: number | null = null;

  if (parsed.score) {
    const { team1, team2 } = await resolveTeams(leagueId, parsed.score.team1Abbr, parsed.score.team2Abbr);
    team1Name = team1?.name ?? null;
    team2Name = team2?.name ?? null;
    team1Id = team1?.id ?? null;
    team2Id = team2?.id ?? null;

    if (team1 && team2) {
      const game = await resolveGame(leagueId, team1.id, team2.id, seasonNumber, weekNumber);
      if (game) {
        gameId = game.id;
        if (game.home_team_id === team1.id) {
          homeTeamId = team1.id;
          awayTeamId = team2.id;
          homeUserId = game.home_user_id ?? null;
          awayUserId = game.away_user_id ?? null;
          homeScore = parsed.score.team1Score;
          awayScore = parsed.score.team2Score;
        } else {
          homeTeamId = team2.id;
          awayTeamId = team1.id;
          homeUserId = game.home_user_id ?? null;
          awayUserId = game.away_user_id ?? null;
          homeScore = parsed.score.team2Score;
          awayScore = parsed.score.team1Score;
        }
      }
    }
  }

  // Compute comeback stats from quarter scores (uses team1/team2 orientation from OCR)
  const comeback = parsed.score
    ? computeComebackStats(
        parsed.score.team1Quarters,
        parsed.score.team2Quarters,
        team1Id,
        team2Id,
      )
    : { comebackDeficit: null, comebackDeficitQuarter: null, comebackRate: null, comebackWinnerTeamId: null, fourthQuarterComeback: false };

  const { data: submission, error } = await supabase
    .from("rec_box_score_submissions")
    .insert({
      league_id: leagueId,
      season_number: seasonNumber,
      week_number: weekNumber,
      phase,
      submitted_by_discord_id: input.discordId,
      submitted_by_user_id: account.user_id,
      discord_guild_id: input.guildId,
      discord_channel_id: input.discordChannelId ?? null,
      discord_message_id: input.discordMessageId ?? null,
      image_urls: [input.imageUrl1, input.imageUrl2],
      team1_abbr: parsed.score?.team1Abbr ?? null,
      team2_abbr: parsed.score?.team2Abbr ?? null,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      home_user_id: homeUserId,
      away_user_id: awayUserId,
      home_score: homeScore,
      away_score: awayScore,
      quarter_scores: parsed.score
        ? { team1: parsed.score.team1Quarters, team2: parsed.score.team2Quarters }
        : null,
      team_stats: parsed.stats,
      game_id: gameId,
      parse_warnings: parsed.warnings,
      comeback_deficit: comeback.comebackDeficit,
      comeback_deficit_quarter: comeback.comebackDeficitQuarter,
      comeback_rate: comeback.comebackRate,
      comeback_winner_team_id: comeback.comebackWinnerTeamId,
      fourth_quarter_comeback: comeback.fourthQuarterComeback,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !submission) throw new ApiError(500, "Failed to save draft submission.", error);

  return {
    submissionId: submission.id,
    parsed,
    team1Name,
    team2Name,
    gameMatched: !!gameId,
  };
}

// ─── Submit for review ────────────────────────────────────────────────────────

export async function submitBoxScoreForReview(input: { submissionId: string; discordId: string }) {
  const { data: sub, error: fetchErr } = await supabase
    .from("rec_box_score_submissions")
    .select("*")
    .eq("id", input.submissionId)
    .eq("submitted_by_discord_id", input.discordId)
    .eq("status", "draft")
    .maybeSingle();

  if (fetchErr) throw new ApiError(500, "Failed to load submission.", fetchErr);
  if (!sub) throw new ApiError(404, "Draft submission not found or already submitted.");

  // Move to pending
  const { error: updateErr } = await supabase
    .from("rec_box_score_submissions")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("id", input.submissionId);
  if (updateErr) throw new ApiError(500, "Failed to submit for review.", updateErr);

  // Create commissioners inbox entry
  const header = sub.home_team_id
    ? `Box Score: ${sub.team1_abbr ?? "?"} vs ${sub.team2_abbr ?? "?"} — Wk ${sub.week_number}`
    : `Box Score: ${sub.team1_abbr ?? "?"} vs ${sub.team2_abbr ?? "?"} — Wk ${sub.week_number} (unmatched)`;

  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: sub.discord_guild_id,
    server_id: null,
    league_id: sub.league_id,
    season_number: sub.season_number,
    week_number: sub.week_number,
    queue_type: "box_score",
    status: "pending",
    priority: 0,
    header,
    summary: `${sub.home_score ?? "?"} – ${sub.away_score ?? "?"} final score. Submitted by <@${sub.submitted_by_discord_id}>.`,
    requester_discord_id: sub.submitted_by_discord_id,
    requester_user_id: sub.submitted_by_user_id,
    source_table: "rec_box_score_submissions",
    source_id: sub.id,
    payload: {
      submissionId: sub.id,
      team1Abbr: sub.team1_abbr,
      team2Abbr: sub.team2_abbr,
      homeScore: sub.home_score,
      awayScore: sub.away_score,
    },
  });

  return { ok: true };
}

// ─── Commissioner review ──────────────────────────────────────────────────────

export type ReviewBoxScoreInput = {
  submissionId: string;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
};

export async function reviewBoxScore(input: ReviewBoxScoreInput) {
  const { data: sub, error: fetchErr } = await supabase
    .from("rec_box_score_submissions")
    .select("*")
    .eq("id", input.submissionId)
    .eq("status", "pending")
    .maybeSingle();

  if (fetchErr) throw new ApiError(500, "Failed to load submission.", fetchErr);
  if (!sub) throw new ApiError(404, "Pending submission not found.");

  if (input.action === "deny") {
    await supabase
      .from("rec_box_score_submissions")
      .update({
        status: "denied",
        reviewed_by_discord_id: input.reviewedByDiscordId,
        reviewed_at: new Date().toISOString(),
        denied_reason: input.deniedReason ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.submissionId);

    await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: new Date().toISOString(), review_reason: input.deniedReason ?? null })
      .eq("source_table", "rec_box_score_submissions")
      .eq("source_id", input.submissionId);

    return { ok: true, action: "denied" as const };
  }

  // Approve: record game result + issue payouts
  const now = new Date().toISOString();

  // Write game result if we have matched teams and scores
  if (sub.home_team_id && sub.away_team_id && sub.home_score != null && sub.away_score != null) {
    const winningUserId = sub.home_score > sub.away_score
      ? sub.home_user_id
      : sub.home_score < sub.away_score
        ? sub.away_user_id
        : null;

    await supabase.from("rec_game_results").upsert(
      {
        league_id: sub.league_id,
        game_id: sub.game_id,
        season_number: sub.season_number,
        week_number: sub.week_number,
        phase: sub.phase,
        home_team_id: sub.home_team_id,
        away_team_id: sub.away_team_id,
        home_user_id: sub.home_user_id,
        away_user_id: sub.away_user_id,
        home_score: sub.home_score,
        away_score: sub.away_score,
        winning_user_id: winningUserId,
        result_source: "box_score_screenshot",
        created_at: now,
        updated_at: now,
      },
      { onConflict: "game_id", ignoreDuplicates: false }
    );
  }

  // Issue payouts to both players
  const payoutUserIds: string[] = [];
  if (sub.submitted_by_user_id) payoutUserIds.push(sub.submitted_by_user_id);
  // Add opponent if matched and different
  const opponentUserId = sub.home_user_id === sub.submitted_by_user_id ? sub.away_user_id : sub.home_user_id;
  if (opponentUserId && opponentUserId !== sub.submitted_by_user_id) payoutUserIds.push(opponentUserId);

  for (const userId of payoutUserIds) {
    await supabase.rpc("add_to_wallet", {
      p_user_id: userId,
      p_amount: BOX_SCORE_PAYOUT_AMOUNT,
      p_league_id: sub.league_id,
      p_description: `Box score upload payout — Wk ${sub.week_number}`,
      p_transaction_type: "box_score_payout",
      p_source: "box_score",
      p_source_reference: { submissionId: sub.id },
    }).throwOnError();
  }

  await supabase
    .from("rec_box_score_submissions")
    .update({
      status: "approved",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      reviewed_at: now,
      payout_issued: true,
      updated_at: now,
    })
    .eq("id", input.submissionId);

  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "approved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now })
    .eq("source_table", "rec_box_score_submissions")
    .eq("source_id", input.submissionId);

  return { ok: true, action: "approved" as const, payoutAmount: BOX_SCORE_PAYOUT_AMOUNT, playersPayd: payoutUserIds.length };
}

// ─── List pending submissions ─────────────────────────────────────────────────

export async function listPendingBoxScores(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .select("id,team1_abbr,team2_abbr,home_score,away_score,week_number,submitted_by_discord_id,created_at,parse_warnings,team_stats,quarter_scores,home_team_id,away_team_id")
    .eq("league_id", context.leagueId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new ApiError(500, "Failed to load pending submissions.", error);
  return { submissions: data ?? [] };
}

export async function getBoxScoreSubmission(submissionId: string) {
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load submission.", error);
  if (!data) throw new ApiError(404, "Submission not found.");
  return data;
}

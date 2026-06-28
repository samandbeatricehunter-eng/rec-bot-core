import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";

const GOTW_CORRECT_GUESS_PAYOUT = 25;

export async function createGotwPoll(input: {
  guildId: string;
  gameId: string;
  awayTeamId: string;
  homeTeamId: string;
  awayUserId?: string | null;
  homeUserId?: string | null;
  awayTeamName: string;
  homeTeamName: string;
  discordChannelId: string;
  discordMessageId: string;
  weekNumber: number;
  expiresAt: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);

  const { data, error } = await supabase
    .from("rec_game_of_week_polls")
    .insert({
      league_id: context.leagueId,
      season_number: seasonNumber,
      week_number: input.weekNumber,
      stage: context.rec_leagues.season_stage ?? "regular_season",
      game_id: input.gameId,
      away_team_id: input.awayTeamId,
      home_team_id: input.homeTeamId,
      away_user_id: input.awayUserId ?? null,
      home_user_id: input.homeUserId ?? null,
      away_team_name: input.awayTeamName,
      home_team_name: input.homeTeamName,
      discord_channel_id: input.discordChannelId,
      discord_message_id: input.discordMessageId,
      poll_expires_at: input.expiresAt,
      status: "open",
    })
    .select("id")
    .single();
  if (error) throw new ApiError(500, "Failed to create GOTW poll record.", error);
  return { pollId: data.id };
}

export async function getActiveGotwPoll(guildId: string, weekNumber: number) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const { data, error } = await supabase
    .from("rec_game_of_week_polls")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load active GOTW poll.", error);
  return data;
}

/**
 * Settle the GOTW poll. winningTeamId is the ACTUAL game winner from the advance
 * results — not the poll vote counts. Voters who picked the winning team get a
 * correct-guess win and a payout; everyone else gets a loss.
 */
export async function settleGotwPoll(input: {
  guildId: string;
  pollId: string;
  /** Actual winning team from game result. null = tie, no payouts. */
  winningTeamId: string | null;
  voters: { discordId: string; userId?: string | null; selectedTeamId: string }[];
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const now = new Date().toISOString();

  const { data: poll, error: pollErr } = await supabase
    .from("rec_game_of_week_polls")
    .select("*")
    .eq("id", input.pollId)
    .eq("league_id", context.leagueId)
    .single();
  if (pollErr || !poll) throw new ApiError(404, "GOTW poll not found.", pollErr);

  await supabase
    .from("rec_game_of_week_polls")
    .update({ status: "settled", winning_team_id: input.winningTeamId ?? null, settled_at: now, closed_at: now, updated_at: now })
    .eq("id", input.pollId);

  if (!input.voters.length) return { settled: true, payouts: 0, losses: 0 };

  // Resolve Discord IDs → internal user IDs.
  const unknownDiscordIds = input.voters.filter((v) => !v.userId).map((v) => v.discordId);
  const resolvedUsers = new Map<string, string>();
  if (unknownDiscordIds.length) {
    const { data: accounts } = await supabase
      .from("rec_discord_accounts")
      .select("discord_id,user_id")
      .in("discord_id", unknownDiscordIds);
    for (const a of accounts ?? []) resolvedUsers.set(a.discord_id, a.user_id);
  }

  let payouts = 0;
  let losses = 0;
  const voteRows: any[] = [];

  for (const voter of input.voters) {
    const userId = voter.userId ?? resolvedUsers.get(voter.discordId) ?? null;
    // is_correct: true = picked the actual winning team, false = picked the loser, null = tie (no result)
    const isCorrect = input.winningTeamId != null ? voter.selectedTeamId === input.winningTeamId : null;
    const payout = isCorrect && userId ? GOTW_CORRECT_GUESS_PAYOUT : 0;

    voteRows.push({
      poll_id: input.pollId,
      league_id: context.leagueId,
      season_number: poll.season_number,
      week_number: poll.week_number,
      user_id: userId,
      discord_id: voter.discordId,
      selected_team_id: voter.selectedTeamId,
      selected_team_name: voter.selectedTeamId === poll.away_team_id ? poll.away_team_name : poll.home_team_name,
      is_correct: isCorrect,
      payout_amount: payout,
      voted_at: now,
      settled_at: now,
    });

    if (payout > 0 && userId) {
      const { error } = await supabase.rpc("add_to_wallet", {
        p_user_id: userId,
        p_amount: payout,
        p_league_id: context.leagueId,
        p_description: `GOTW correct pick: ${poll.away_team_name} vs ${poll.home_team_name} — Wk ${poll.week_number}`,
        p_transaction_type: "gotw_payout",
        p_source: "gotw",
        p_source_reference: { poll_id: input.pollId, week: poll.week_number },
      });
      if (error) console.error("[ERROR] GOTW payout failed (non-fatal):", error);
      else payouts += 1;
    }

    if (isCorrect === false) losses += 1;
  }

  if (voteRows.length) {
    const { error } = await supabase
      .from("rec_game_of_week_votes")
      .upsert(voteRows, { onConflict: "poll_id,discord_id" });
    if (error) console.error("[ERROR] Failed to insert GOTW vote rows (non-fatal):", error);
  }

  // Update global guessing records: increment correct_guesses or wrong_guesses per voter.
  for (const row of voteRows) {
    if (!row.user_id || row.is_correct === null) continue;
    const { data: existing } = await supabase
      .from("rec_global_gotw_guessing_records")
      .select("correct_guesses,wrong_guesses")
      .eq("user_id", row.user_id)
      .maybeSingle();

    const correctGuesses = (existing?.correct_guesses ?? 0) + (row.is_correct ? 1 : 0);
    const wrongGuesses = (existing?.wrong_guesses ?? 0) + (row.is_correct ? 0 : 1);

    await supabase
      .from("rec_global_gotw_guessing_records")
      .upsert(
        { user_id: row.user_id, correct_guesses: correctGuesses, wrong_guesses: wrongGuesses },
        { onConflict: "user_id" }
      )
      .then(({ error }) => {
        if (error) console.error("[ERROR] Failed to update GOTW guessing record (non-fatal):", error);
      });
  }

  return { settled: true, payouts, losses };
}

/**
 * Looks up the actual game result for a GOTW matchup by team IDs + week.
 * Returns the winning_team_id (null on tie or not yet played).
 */
export async function getGotwGameResult(input: {
  guildId: string;
  awayTeamId: string;
  homeTeamId: string;
  weekNumber: number;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);

  const { data } = await supabase
    .from("rec_game_results")
    .select("winning_team_id, is_tie")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", input.weekNumber)
    .eq("away_team_id", input.awayTeamId)
    .eq("home_team_id", input.homeTeamId)
    .maybeSingle();

  return data ?? null;
}

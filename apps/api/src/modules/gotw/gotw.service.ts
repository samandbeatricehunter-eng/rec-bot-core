import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { OFFICIAL_RESULT_SOURCES } from "../official-records/official-records.service.js";

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
  discordChannelId?: string | null;
  discordMessageId?: string | null;
  weekNumber: number;
  expiresAt?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("rec_game_of_week_polls")
    .upsert({
      league_id: context.leagueId,
      season_number: seasonNumber,
      week_number: input.weekNumber,
      stage: context.rec_leagues.season_stage ?? "regular_season",
      game_id: input.gameId,
      question: `Who will win this week's GOTW? ${input.awayTeamName} at ${input.homeTeamName}`.slice(0, 300),
      away_team_id: input.awayTeamId,
      home_team_id: input.homeTeamId,
      away_user_id: input.awayUserId ?? null,
      home_user_id: input.homeUserId ?? null,
      away_team_name: input.awayTeamName,
      home_team_name: input.homeTeamName,
      discord_channel_id: input.discordChannelId ?? null,
      discord_message_id: input.discordMessageId ?? null,
      poll_expires_at: input.expiresAt ?? null,
      status: "open",
      winning_team_id: null,
      closed_at: null,
      settled_at: null,
      updated_at: now,
    }, { onConflict: "league_id,season_number,week_number,game_id", ignoreDuplicates: false })
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

export async function getActiveGotwPolls(guildId: string, weekNumber: number) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const { data, error } = await supabase
    .from("rec_game_of_week_polls")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .in("status", ["open", "closed"])
    .order("created_at", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load active GOTW polls.", error);
  return data ?? [];
}

export async function clearGotwPollsForWeek(guildId: string, weekNumber: number) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const { data, error } = await supabase
    .from("rec_game_of_week_polls")
    .select("id,discord_channel_id,discord_message_id,status")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
  if (error) throw new ApiError(500, "Failed to load GOTW polls for cleanup.", error);

  const ids = (data ?? []).map((poll) => poll.id).filter(Boolean);
  if (ids.length) {
    const deleted = await supabase.from("rec_game_of_week_polls").delete().in("id", ids);
    if (deleted.error) throw new ApiError(500, "Failed to clear GOTW poll records.", deleted.error);
  }
  return { cleared: ids.length, polls: data ?? [] };
}

export async function settleGotwPoll(input: {
  guildId: string;
  pollId: string;
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

  const { data: storedVotes, error: votesErr } = await supabase
    .from("rec_game_of_week_votes")
    .select("discord_id,user_id,selected_team_id")
    .eq("poll_id", input.pollId);
  if (votesErr) throw new ApiError(500, "Failed to load GOTW votes for settlement.", votesErr);

  await supabase
    .from("rec_game_of_week_polls")
    .update({ status: "settled", winning_team_id: input.winningTeamId ?? null, settled_at: now, closed_at: now, updated_at: now })
    .eq("id", input.pollId);

  const votersByDiscordId = new Map<string, { discordId: string; userId?: string | null; selectedTeamId: string }>();
  for (const vote of storedVotes ?? []) {
    if (vote.discord_id && vote.selected_team_id) {
      votersByDiscordId.set(vote.discord_id, { discordId: vote.discord_id, userId: vote.user_id ?? null, selectedTeamId: vote.selected_team_id });
    }
  }
  for (const voter of input.voters) votersByDiscordId.set(voter.discordId, voter);
  const voters = [...votersByDiscordId.values()];
  if (!voters.length) return { settled: true, payouts: 0, losses: 0 };

  const unknownDiscordIds = voters.filter((v) => !v.userId).map((v) => v.discordId);
  const resolvedUsers = new Map<string, string>();
  if (unknownDiscordIds.length) {
    const { data: accounts } = await supabase
      .from("rec_discord_accounts")
      .select("discord_id,user_id")
      .in("discord_id", unknownDiscordIds);
    for (const account of accounts ?? []) resolvedUsers.set(account.discord_id, account.user_id);
  }

  let payouts = 0;
  let losses = 0;
  const voteRows: any[] = [];

  for (const voter of voters) {
    const userId = voter.userId ?? resolvedUsers.get(voter.discordId) ?? null;
    const isCorrect = input.winningTeamId != null ? voter.selectedTeamId === input.winningTeamId : null;
    const payout = isCorrect && userId ? GOTW_CORRECT_GUESS_PAYOUT : 0;
    const voteRow = {
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
      paid_ledger_id: null,
      voted_at: now,
      settled_at: now,
    };

    if (payout > 0 && userId) {
      const { data: ledgerId, error } = await supabase.rpc("add_to_wallet", {
        p_user_id: userId,
        p_amount: payout,
        p_league_id: context.leagueId,
        p_description: `GOTW correct pick: ${poll.away_team_name} vs ${poll.home_team_name} - Wk ${poll.week_number}`,
        p_transaction_type: "gotw_payout",
        p_source: "gotw",
        p_source_reference: { poll_id: input.pollId, week: poll.week_number },
      });
      if (error) console.error("[ERROR] GOTW payout failed (non-fatal):", error);
      else {
        voteRow.paid_ledger_id = ledgerId ?? null;
        payouts += 1;
      }
    }

    voteRows.push(voteRow);
    if (isCorrect === false) losses += 1;
  }

  const { error: upsertErr } = await supabase
    .from("rec_game_of_week_votes")
    .upsert(voteRows, { onConflict: "poll_id,discord_id" });
  if (upsertErr) console.error("[ERROR] Failed to update GOTW vote rows (non-fatal):", upsertErr);

  for (const row of voteRows) {
    if (!row.user_id || row.is_correct === null) continue;
    const { data: existing } = await supabase
      .from("rec_global_gotw_guessing_records")
      .select("correct_guesses,wrong_guesses")
      .eq("user_id", row.user_id)
      .maybeSingle();
    await supabase
      .from("rec_global_gotw_guessing_records")
      .upsert({
        user_id: row.user_id,
        correct_guesses: (existing?.correct_guesses ?? 0) + (row.is_correct ? 1 : 0),
        wrong_guesses: (existing?.wrong_guesses ?? 0) + (row.is_correct ? 0 : 1),
        last_result_at: now,
        updated_at: now,
      }, { onConflict: "user_id" })
      .then(({ error }) => {
        if (error) console.error("[ERROR] Failed to update GOTW guessing record (non-fatal):", error);
      });
  }

  return { settled: true, payouts, losses };
}

export async function settleGotwPollsForGame(input: { guildId: string; gameId: string; winningTeamId: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const { data: polls, error } = await supabase
    .from("rec_game_of_week_polls")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("game_id", input.gameId)
    .in("status", ["open", "closed"]);
  if (error) throw new ApiError(500, "Failed to load GOTW polls for settlement.", error);

  const settled: Array<{ settled: boolean; payouts: number; losses: number }> = [];
  for (const poll of polls ?? []) {
    settled.push(await settleGotwPoll({ guildId: input.guildId, pollId: poll.id, winningTeamId: input.winningTeamId, voters: [] }));
  }
  return { settledCount: settled.length, settled };
}

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
    .select("winning_team_id, is_tie, source")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", input.weekNumber)
    .eq("away_team_id", input.awayTeamId)
    .eq("home_team_id", input.homeTeamId)
    .in("source", [...OFFICIAL_RESULT_SOURCES])
    .limit(1);

  return data?.[0] ?? null;
}

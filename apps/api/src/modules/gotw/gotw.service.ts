import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { leagueWeekGamesQuery } from "../league-context/league-games.query.js";
import { OFFICIAL_RESULT_SOURCES } from "../official-records/official-records.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { getLeagueConfigAsDraft } from "../setup/setup.service.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";
import { getGlobalEconomyConfig } from "../economy/global-economy-config.service.js";

function gotwStreamingAnnouncement(draft: any, awayMention: string, homeMention: string) {
  const requirement = draft?.gotwStreamingRequirement ?? "recommended";
  const side = draft?.gotwStreamingSide ?? "either";
  if (requirement === "disabled") return { text: "GOTW streaming is disabled for this league.", mentionIds: [] as string[] };
  const verb = requirement === "required" ? "must" : "should";
  const label = requirement === "required" ? "Required" : "Recommended";
  if (side === "home") return { text: `${label}: ${homeMention} ${verb} stream this Game of the Week.`, mentionIds: [homeMention] };
  if (side === "away") return { text: `${label}: ${awayMention} ${verb} stream this Game of the Week.`, mentionIds: [awayMention] };
  if (side === "both") return { text: `${label}: ${awayMention} and ${homeMention} ${verb} both stream this Game of the Week.`, mentionIds: [awayMention, homeMention] };
  return { text: `${label}: at least one of ${awayMention} or ${homeMention} ${verb} stream this Game of the Week.`, mentionIds: [awayMention, homeMention] };
}

async function announceGotwInExistingGameChannel(input: {
  guildId: string;
  leagueId: string;
  gameId: string;
  awayUserId?: string | null;
  homeUserId?: string | null;
  awayTeamName: string;
  homeTeamName: string;
  weekNumber: number;
  discordChannelId?: string | null;
}) {
  let channelId = input.discordChannelId ?? null;
  if (!channelId) {
    const channel = await supabase.from("rec_game_channels").select("discord_channel_id")
      .eq("league_id", input.leagueId).eq("game_id", input.gameId).eq("status", "active").limit(1).maybeSingle();
    if (channel.error) throw new ApiError(500, "We couldn't find the GOTW game channel. Please try again.", channel.error);
    channelId = channel.data?.discord_channel_id ?? null;
  }
  if (!channelId) return;

  const userIds = [input.awayUserId, input.homeUserId].filter(Boolean) as string[];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds)
    : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "We couldn't load GOTW streamer mentions. Please try again.", accounts.error);
  const ids = new Map((accounts.data ?? []).map((row: any) => [String(row.user_id), String(row.discord_id)]));
  const awayId = input.awayUserId ? ids.get(input.awayUserId) : null;
  const homeId = input.homeUserId ? ids.get(input.homeUserId) : null;
  const awayMention = awayId ? `<@${awayId}>` : "the away coach";
  const homeMention = homeId ? `<@${homeId}>` : "the home coach";
  const draft = await bestEffort("gotw.league_config_draft", () => getLeagueConfigAsDraft(input.guildId).then((result) => (result as any)?.draft ?? null), { guildId: input.guildId }) ?? null;
  const rule = gotwStreamingAnnouncement(draft, awayMention, homeMention);
  const allowedIds = rule.mentionIds.map((mention) => mention.match(/^<@(\d+)>$/)?.[1]).filter(Boolean) as string[];
  await postDiscordChannelMessage(channelId, {
    embeds: [{
      title: "GAME OF THE WEEK",
      color: 0xd9a521,
      description: [`**Week ${input.weekNumber}: ${input.awayTeamName} at ${input.homeTeamName}**`, "", rule.text].join("\n"),
    }],
    allowed_mentions: { users: allowedIds },
  });
}

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
  const existing = await supabase.from("rec_game_of_week_polls").select("id")
    .eq("league_id", context.leagueId).eq("season_number", seasonNumber)
    .eq("week_number", input.weekNumber).eq("game_id", input.gameId).maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't check the existing GOTW poll. Please try again.", existing.error);

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
  if (error) throw new ApiError(500, "We couldn't create that GOTW poll. Please try again.", error);
  if (!existing.data) {
    await announceGotwInExistingGameChannel({
      guildId: input.guildId,
      leagueId: context.leagueId,
      gameId: input.gameId,
      awayUserId: input.awayUserId,
      homeUserId: input.homeUserId,
      awayTeamName: input.awayTeamName,
      homeTeamName: input.homeTeamName,
      weekNumber: input.weekNumber,
      discordChannelId: input.discordChannelId,
    });
  }
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
  if (error) throw new ApiError(500, "We couldn't load the active GOTW poll. Please try again.", error);
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
  if (error) throw new ApiError(500, "We couldn't load active GOTW polls right now. Please try again.", error);
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
  if (error) throw new ApiError(500, "We couldn't load GOTW polls for cleanup. Please try again.", error);

  const ids = (data ?? []).map((poll) => poll.id).filter(Boolean);
  if (ids.length) {
    const deleted = await supabase.from("rec_game_of_week_polls").delete().in("id", ids);
    if (deleted.error) throw new ApiError(500, "We couldn't clear GOTW poll records. Please try again.", deleted.error);
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
  // Settlement can be triggered from more than one place (box-score approval, manual score
  // entry, advance completion) for the same game — settle exactly once so correct-pick
  // payouts never get issued twice.
  if (poll.status === "settled") return { settled: true, payouts: 0, losses: 0 };

  const { data: storedVotes, error: votesErr } = await supabase
    .from("rec_game_of_week_votes")
    .select("discord_id,user_id,selected_team_id")
    .eq("poll_id", input.pollId);
  if (votesErr) throw new ApiError(500, "We couldn't load GOTW votes for settlement. Please try again.", votesErr);

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
  const correctVotePayout = (await getGlobalEconomyConfig()).submissions.gotwCorrectVote;

  const isTieGame = input.winningTeamId == null;
  for (const voter of voters) {
    const userId = voter.userId ?? resolvedUsers.get(voter.discordId) ?? null;
    const isCorrect = isTieGame ? null : voter.selectedTeamId === input.winningTeamId;
    const payout = isCorrect && userId ? correctVotePayout : 0;
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
      is_tie: isTieGame,
      payout_amount: payout,
      paid_ledger_id: null as string | null,
      voted_at: now,
      settled_at: now,
    };

    if (payout > 0 && userId) {
      try {
        const credit = await creditOrBacklog({
          leagueId: context.leagueId,
          seasonNumber: poll.season_number,
          userId,
          amount: payout,
          description: `GOTW correct pick: ${poll.away_team_name} vs ${poll.home_team_name} - Wk ${poll.week_number}`,
          transactionType: "gotw_payout",
          source: "gotw",
          sourceReference: { poll_id: input.pollId, week: poll.week_number },
        });
        voteRow.paid_ledger_id = credit.ledgerId;
        payouts += 1;
      } catch (error) {
        console.error("[ERROR] GOTW payout failed (non-fatal):", error);
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
    if (!row.user_id) continue;
    if (row.is_tie) {
      const { data: existingLeague } = await supabase
        .from("rec_league_gotw_guessing_records")
        .select("wins,losses,ties,current_streak,best_streak")
        .eq("league_id", context.leagueId).eq("season_number", row.season_number).eq("user_id", row.user_id)
        .maybeSingle();
      await supabase
        .from("rec_league_gotw_guessing_records")
        .upsert({
          league_id: context.leagueId,
          season_number: row.season_number,
          user_id: row.user_id,
          wins: existingLeague?.wins ?? 0,
          losses: existingLeague?.losses ?? 0,
          ties: (existingLeague?.ties ?? 0) + 1,
          current_streak: existingLeague?.current_streak ?? 0,
          best_streak: existingLeague?.best_streak ?? 0,
          last_result_at: now,
          updated_at: now,
        }, { onConflict: "league_id,season_number,user_id" })
        .then(({ error }) => {
          if (error) console.error("[ERROR] Failed to update GOTW league guessing record (non-fatal):", error);
        });
      continue;
    }
    if (row.is_correct === null) continue;
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

    const { data: existingLeague } = await supabase
      .from("rec_league_gotw_guessing_records")
      .select("wins,losses,ties,current_streak,best_streak")
      .eq("league_id", context.leagueId).eq("season_number", row.season_number).eq("user_id", row.user_id)
      .maybeSingle();
    const nextStreak = row.is_correct ? (existingLeague?.current_streak ?? 0) + 1 : 0;
    await supabase
      .from("rec_league_gotw_guessing_records")
      .upsert({
        league_id: context.leagueId,
        season_number: row.season_number,
        user_id: row.user_id,
        wins: (existingLeague?.wins ?? 0) + (row.is_correct ? 1 : 0),
        losses: (existingLeague?.losses ?? 0) + (row.is_correct ? 0 : 1),
        ties: existingLeague?.ties ?? 0,
        current_streak: nextStreak,
        best_streak: Math.max(existingLeague?.best_streak ?? 0, nextStreak),
        last_result_at: now,
        updated_at: now,
      }, { onConflict: "league_id,season_number,user_id" })
      .then(({ error }) => {
        if (error) console.error("[ERROR] Failed to update GOTW league guessing record (non-fatal):", error);
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
  if (error) throw new ApiError(500, "We couldn't load GOTW polls for settlement. Please try again.", error);

  const settled: Array<{ settled: boolean; payouts: number; losses: number }> = [];
  for (const poll of polls ?? []) {
    settled.push(await settleGotwPoll({ guildId: input.guildId, pollId: poll.id, winningTeamId: input.winningTeamId, voters: [] }));
  }
  return { settledCount: settled.length, settled };
}

export async function getGotwGuessingRecordsForHub(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const records = await getLeagueGotwGuessingRecords(context.leagueId, seasonNumber);
  const userIds = records.map((r) => r.user_id).filter(Boolean);
  const { data: users } = userIds.length
    ? await supabase.from("rec_users").select("id,username,display_name").in("id", userIds)
    : { data: [] as any[] };
  const nameById = new Map((users ?? []).map((u: any) => [u.id, u.display_name || u.username]));
  return records
    .map((r) => ({ ...r, displayName: nameById.get(r.user_id) ?? "Unknown" }))
    .sort((a, b) => (b.wins - a.wins) || (b.current_streak - a.current_streak));
}

export async function getMyGotwGuessingRecord(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (!account.data?.user_id) return { wins: 0, losses: 0, ties: 0, current_streak: 0, best_streak: 0, last_result_at: null };
  return getUserGotwGuessingRecord(context.leagueId, seasonNumber, account.data.user_id);
}

export async function getLeagueGotwGuessingRecords(leagueId: string, seasonNumber: number) {
  const { data, error } = await supabase
    .from("rec_league_gotw_guessing_records")
    .select("user_id,wins,losses,ties,current_streak,best_streak,last_result_at")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);
  if (error) throw new ApiError(500, "We couldn't load GOTW guessing records. Please try again.", error);
  return data ?? [];
}

export async function getUserGotwGuessingRecord(leagueId: string, seasonNumber: number, userId: string) {
  const { data, error } = await supabase
    .from("rec_league_gotw_guessing_records")
    .select("wins,losses,ties,current_streak,best_streak,last_result_at")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError(500, "We couldn't load your GOTW guessing record. Please try again.", error);
  return data ?? { wins: 0, losses: 0, ties: 0, current_streak: 0, best_streak: 0, last_result_at: null };
}

// Ranks by wins desc, then win% desc (ties/losses as denominator) — matches how a "best guessing
// record" reads intuitively: someone who went 10-2 outranks someone who went 3-0.
export async function payGotwGuessingBonuses(leagueId: string, seasonNumber: number) {
  const records = await getLeagueGotwGuessingRecords(leagueId, seasonNumber);
  const ranked = records
    .filter((r) => r.wins + r.losses + r.ties > 0)
    .map((r) => ({ ...r, winPct: r.wins / Math.max(1, r.wins + r.losses + r.ties) }))
    .sort((a, b) => (b.wins - a.wins) || (b.winPct - a.winPct));
  const winner = ranked.slice(0, 1);
  if (!winner.length) return { paid: 0 };

  const bonus = (await getGlobalEconomyConfig()).submissions.gotwSeasonTopGuesserBonus;
  const now = new Date().toISOString();
  let paid = 0;
  for (let i = 0; i < winner.length; i += 1) {
    const rank = i + 1;
    const { data: inserted, error } = await supabase
      .from("rec_gotw_guessing_bonus_payouts")
      .insert({ league_id: leagueId, season_number: seasonNumber, user_id: winner[i].user_id, rank, amount: bonus, paid_at: now })
      .select("id")
      .single();
    if (error) {
      if ((error as any).code !== "23505") console.error("[ERROR] Failed to record GOTW guessing bonus payout (non-fatal):", error);
      continue;
    }
    if (!inserted) continue;
    try {
      await creditOrBacklog({
        leagueId,
        seasonNumber,
        userId: winner[i].user_id,
        amount: bonus,
        description: `GOTW top-${rank} guesser bonus — Season ${seasonNumber}`,
        transactionType: "gotw_guessing_bonus",
        source: "gotw",
        sourceReference: { rank, season_number: seasonNumber },
      });
      paid += 1;
    } catch (creditError) {
      console.error("[ERROR] GOTW guessing bonus credit failed (non-fatal):", creditError);
    }
  }
  return { paid };
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

// Every bowl game, the national championship, and — since the CFP bracket was introduced —
// every postseason game from Conference Championship week forward are automatic GOTW games in
// CFB leagues. Called both right after a commissioner flags a game in the schedule builder,
// and for the new week's games as part of completing an advance (so pre-flagged games still
// get a poll even if nobody visited the schedule builder again after the flip).
export async function autoAssignGotwForWeek(input: { guildId: string; weekNumber: number; allH2h?: boolean }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  // Every season restarts at week 1 — without a season_id filter this also matches a prior
  // season's game at the same week number (same bug class already fixed for the hub hero card
  // and the GOTW nomination dropdown).
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);

  const games = await leagueWeekGamesQuery(supabase, { leagueId: context.leagueId, seasonId, weekNumber: input.weekNumber },
    "id,home_team_id,away_team_id,home_user_id,away_user_id,is_bowl_game,is_national_championship,postseason_round,home_team:rec_teams!rec_games_home_team_id_fkey(name,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(name,display_city,display_nick,is_relocated)");
  if (games.error) throw new ApiError(500, "We couldn't load flagged postseason games. Please try again.", games.error);

  // Live assignments — schedule seed often writes null home_user_id/away_user_id before
  // coaches claim teams, so GOTW eligibility must not rely on those stale columns alone.
  const teamIds = [...new Set((games.data ?? []).flatMap((g: any) => [g.home_team_id, g.away_team_id]).filter(Boolean))];
  const assignments = teamIds.length
    ? await supabase.from("rec_team_assignments").select("team_id,user_id")
      .eq("league_id", context.leagueId).in("team_id", teamIds)
      .eq("assignment_status", "active").is("ended_at", null)
    : { data: [] as any[], error: null };
  if (assignments.error) throw new ApiError(500, "We couldn't load team assignments for GOTW. Please try again.", assignments.error);
  const userByTeam = new Map((assignments.data ?? []).map((row: any) => [row.team_id, row.user_id as string]));

  const flagged = (games.data ?? []).filter((g: any) => {
    const homeUserId = userByTeam.get(g.home_team_id) ?? g.home_user_id;
    const awayUserId = userByTeam.get(g.away_team_id) ?? g.away_user_id;
    return g.home_team_id && g.away_team_id && homeUserId && awayUserId
      && (input.allH2h || g.is_bowl_game || g.is_national_championship || Boolean(g.postseason_round));
  }).map((g: any) => ({
    ...g,
    home_user_id: userByTeam.get(g.home_team_id) ?? g.home_user_id ?? null,
    away_user_id: userByTeam.get(g.away_team_id) ?? g.away_user_id ?? null,
  }));
  if (!flagged.length) return { created: 0 };

  const existing = await supabase
    .from("rec_game_of_week_polls")
    .select("game_id")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", input.weekNumber);
  if (existing.error) throw new ApiError(500, "We couldn't check existing GOTW polls. Please try again.", existing.error);
  const existingGameIds = new Set((existing.data ?? []).map((row: any) => row.game_id));

  let created = 0;
  for (const game of flagged as any[]) {
    if (existingGameIds.has(game.id)) continue;
    await createGotwPoll({
      guildId: input.guildId,
      gameId: game.id,
      awayTeamId: game.away_team_id,
      homeTeamId: game.home_team_id,
      awayUserId: game.away_user_id ?? null,
      homeUserId: game.home_user_id ?? null,
      awayTeamName: formatTeamDisplayName(game.away_team) ?? "Away",
      homeTeamName: formatTeamDisplayName(game.home_team) ?? "Home",
      weekNumber: input.weekNumber,
    });
    created += 1;
  }
  return { created };
}

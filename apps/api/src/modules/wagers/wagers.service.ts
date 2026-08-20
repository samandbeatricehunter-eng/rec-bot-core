// House wager placement. Validates eligibility (economy on, game this week, not the
// bettor's own game, market allowed for the game's data tier, weekly CPU-game cap,
// funds), escrows the stake out of the wallet into holding, and stores a pending
// wager whose payout the commissioner approves once the result is confirmed.

import { canonicalConferenceName, WAGER_MARKET_BY_KEY, parlayOdds, potentialPayout, formatCoins } from "@rec/shared";
import { bestEffort, bestEffortVoid } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { leagueWeekGamesQuery } from "../league-context/league-games.query.js";
import { getGameWagerOptions } from "./odds.service.js";
import { assertSiteAccountForEconomy } from "../subscriptions/discord-only.service.js";
import { listLeagueCommissionerUserIds, notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { sendPushToUsers } from "../push/push.service.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";
import { assertNotLeagueRestricted } from "../moderation/moderation.service.js";
import { postDiscordChannelMessage, sendDiscordDirectMessage } from "../../lib/discord-guild.js";
import { getGlobalEconomyConfig } from "../economy/global-economy-config.service.js";

function teamAbbr(team?: { display_abbr?: string | null; abbreviation?: string | null; name?: string | null } | null): string {
  if (!team) return "TBD";
  return (team.display_abbr ?? "").trim() || (team.abbreviation ?? "").trim() || (team.name ?? "").trim() || "TBD";
}

async function userIdFromDiscord(discordId: string): Promise<string> {
  const { data, error } = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (error) throw new ApiError(500, "We couldn't load your Discord account. Please try again.", error);
  if (!data?.user_id) throw new ApiError(404, "You aren't linked to a REC account yet.");
  return data.user_id;
}

async function activeTeamId(leagueId: string, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  return data?.team_id ?? null;
}

async function walletBalance(userId: string): Promise<number> {
  const { data } = await supabase.from("rec_wallets").select("wallet_balance").eq("user_id", userId).maybeSingle();
  return Number(data?.wallet_balance ?? 0);
}

async function assertHouseWeeklyCap(leagueId: string, seasonNumber: number, weekNumber: number, userId: string, stake: number) {
  const { houseWeeklyMaximum: maximum } = (await getGlobalEconomyConfig()).wagers;
  const { data, error } = await supabase
    .from("rec_wagers")
    .select("stake")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .eq("placed_by_user_id", userId)
    .eq("wager_kind", "house")
    .in("status", ["pending", "confirmed"]);
  if (error) throw new ApiError(500, "We couldn't check your weekly house wager limit. Please try again.", error);
  const activeTotal = (data ?? []).reduce((sum: number, row: any) => sum + Number(row.stake ?? 0), 0);
  if (activeTotal + stake > maximum) {
    throw new ApiError(400, `House wagers are capped at ${formatCoins(maximum)} total per week. You already have ${formatCoins(activeTotal)} active.`);
  }
}

async function assertPeerWeeklyCap(leagueId: string, seasonNumber: number, weekNumber: number, userId: string, stake: number) {
  const { peerWeeklyMaximum: maximum } = (await getGlobalEconomyConfig()).wagers;
  const { data, error } = await supabase.from("rec_wagers").select("stake,placed_by_user_id,accepted_by_user_id,status")
    .eq("league_id", leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber)
    .eq("wager_kind", "peer").in("status", ["awaiting_accept", "pending", "confirmed"])
    .or(`placed_by_user_id.eq.${userId},accepted_by_user_id.eq.${userId}`);
  if (error) throw new ApiError(500, "We couldn't check your weekly peer wager limit. Please try again.", error);
  const activeTotal = (data ?? []).reduce((sum: number, row: any) => sum + Number(row.stake ?? 0), 0);
  if (activeTotal + stake > maximum) {
    throw new ApiError(400, `User-to-user wagers are capped at ${formatCoins(maximum)} total per week. You already have ${formatCoins(activeTotal)} active.`);
  }
}

// Games for the current week the bettor may wager on (their own game excluded).
export async function listWagerableGames(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const userId = await userIdFromDiscord(discordId);
  const myTeamId = await activeTeamId(leagueId, userId);
  // Every season restarts at week 1 — without a season_id filter this can also surface a prior
  // season's game at the same week number as wagerable (same bug class as the hub hero card and
  // the GOTW dropdown/auto-assign).
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  const { data: games, error } = await leagueWeekGamesQuery(supabase, { leagueId, seasonId, weekNumber },
    "id,week_number,status,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation,display_abbr)")
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "We couldn't load the wagerable games right now. Please try again.", error);

  // Only true head-to-head (both sides human-controlled) games are wagerable — human-vs-CPU
  // and CPU-vs-CPU games are excluded entirely.
  const out = (games ?? [])
    .filter((g: any) => g.status === "scheduled" && g.home_team_id !== myTeamId && g.away_team_id !== myTeamId)
    .filter((g: any) => Boolean(g.home_user_id) && Boolean(g.away_user_id))
    .map((g: any) => ({
      gameId: g.id,
      weekNumber: g.week_number,
      awayLabel: teamAbbr(g.away_team),
      homeLabel: teamAbbr(g.home_team),
      humanInvolved: true,
    }));

  return { seasonNumber, weekNumber, games: out };
}

export type PlaceHouseWagerInput = {
  guildId: string;
  discordId: string;
  gameId: string;
  market: string;
  pick: string;
  stake: number;
};

export async function placeHouseWager(input: PlaceHouseWagerInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const userId = await userIdFromDiscord(input.discordId);
  await assertSiteAccountForEconomy(userId);
  await assertNotLeagueRestricted(leagueId, userId, "wagers");

  // Economy gate (settings on + linked-user floor).
  const { assertEconomyPayoutsActive } = await import("../economy/economy-gate.js");
  await assertEconomyPayoutsActive(leagueId);

  const stake = Math.floor(Number(input.stake));
  if (!Number.isFinite(stake) || stake <= 0) throw new ApiError(400, "Enter a positive whole-dollar stake.");
  await assertHouseWeeklyCap(leagueId, seasonNumber, weekNumber, userId, stake);

  const marketDef = WAGER_MARKET_BY_KEY.get(input.market);
  if (!marketDef) throw new ApiError(400, "Unknown wager market.");

  // Game must be this week and not the bettor's own game.
  const { data: game, error: gameErr } = await supabase
    .from("rec_games")
    .select("id,week_number,status,home_team_id,away_team_id,home_user_id,away_user_id")
    .eq("league_id", leagueId)
    .eq("id", input.gameId)
    .maybeSingle();
  if (gameErr) throw new ApiError(500, "We couldn't load the game. Please try again.", gameErr);
  if (!game) throw new ApiError(404, "That game isn't on the schedule.");
  if (game.status !== "scheduled") throw new ApiError(409, "Wagering is closed for this game.");
  if (Number(game.week_number) !== weekNumber) throw new ApiError(400, "You can only wager on this week's games.");

  const myTeamId = await activeTeamId(leagueId, userId);
  if (myTeamId && (game.home_team_id === myTeamId || game.away_team_id === myTeamId)) {
    throw new ApiError(400, "You can't bet on your own game.");
  }

  // Derive live options and pull the odds/line for the chosen market + pick.
  const options = await getGameWagerOptions(input.guildId, input.gameId);
  if (marketDef.requiresBoxScore && !options.humanInvolved) {
    throw new ApiError(400, "That market is only available on games with a human coach (box score).");
  }
  const marketOption = options.markets.find((m) => m.market === input.market);
  if (!marketOption) throw new ApiError(400, "That market isn't available for this game.");
  const side = marketOption.sides.find((s) => s.pick === input.pick);
  if (!side) throw new ApiError(400, "Invalid pick for this market.");

  // Spread line is signed per side; totals/moneyline use the market line/none.
  let line: number | null = marketOption.line;
  if (marketDef.kind === "spread") {
    const isHome = input.pick === options.homeTeamId;
    line = isHome ? -(marketOption.line ?? 0) : (marketOption.line ?? 0);
  } else if (marketDef.kind === "moneyline") {
    line = null;
  }
  // Weekly cap: at most one non-human (CPU) game wagered per week.
  if (!options.humanInvolved) {
    const { data: cpuWagers } = await supabase
      .from("rec_wagers")
      .select("game_id")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .eq("week_number", weekNumber)
      .eq("placed_by_user_id", userId)
      .eq("wager_kind", "house")
      .in("status", ["pending", "confirmed"]);
    const distinctCpuGames = new Set((cpuWagers ?? []).map((w) => w.game_id).filter(Boolean));
    if (!distinctCpuGames.has(input.gameId) && distinctCpuGames.size >= 1) {
      throw new ApiError(400, "You can only bet on one non-human (CPU) game per week.");
    }
  }

  const balance = await walletBalance(userId);
  if (balance < stake) throw new ApiError(400, `Insufficient funds. This stakes ${formatCoins(stake)} and you have ${formatCoins(balance)}.`);

  const odds = Number(side.odds);
  const payout = potentialPayout(stake, odds);

  // Insert the pending wager first (the partial-unique index blocks a duplicate
  // game+market); only then escrow, so a duplicate never debits the wallet.
  const insert = await supabase
    .from("rec_wagers")
    .insert({
      league_id: leagueId,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_id: input.gameId,
      placed_by_user_id: userId,
      placed_by_discord_id: input.discordId,
      wager_kind: "house",
      market: input.market,
      pick: input.pick,
      line,
      odds,
      stake,
      potential_payout: payout,
      status: "pending",
    })
    .select("*")
    .single();
  if (insert.error) {
    if (insert.error.code === "23505") throw new ApiError(409, "You already have this exact wager (same game and market) this week.");
    throw new ApiError(500, "We couldn't place that wager. Please try again.", insert.error);
  }

  const hold = await supabase.rpc("add_to_wallet", {
    p_user_id: userId,
    p_amount: -stake,
    p_league_id: leagueId,
    p_description: `Wager hold — ${marketDef.label}`,
    p_transaction_type: "wager_hold",
    p_source: "wager",
    p_source_reference: { wagerId: insert.data.id },
  });
  if (hold.error) {
    await supabase.from("rec_wagers").delete().eq("id", insert.data.id);
    throw new ApiError(500, "We couldn't hold funds for that wager. Please try again.", hold.error);
  }
  await supabase.from("rec_wagers").update({ hold_ledger_id: hold.data, updated_at: new Date().toISOString() }).eq("id", insert.data.id);

  return {
    wager: { ...insert.data, hold_ledger_id: hold.data },
    sideLabel: side.label,
    marketLabel: marketDef.label,
    gameLabel: `${options.awayLabel} at ${options.homeLabel}`,
    odds,
    line,
    payout,
    walletBalance: balance - stake,
  };
}

// Shared placement validation + line/odds resolution for house and peer wagers.
async function prepareSingleWager(guildId: string, userId: string, leagueId: string, weekNumber: number, gameId: string, market: string, pick: string, stake: number) {
  if (!Number.isFinite(stake) || stake <= 0) throw new ApiError(400, "Enter a positive whole-dollar stake.");
  const marketDef = WAGER_MARKET_BY_KEY.get(market);
  if (!marketDef) throw new ApiError(400, "Unknown wager market.");

  const { data: game, error: gameErr } = await supabase
    .from("rec_games")
    .select("id,week_number,home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("id", gameId)
    .maybeSingle();
  if (gameErr) throw new ApiError(500, "We couldn't load the game. Please try again.", gameErr);
  if (!game) throw new ApiError(404, "That game isn't on the schedule.");
  if (Number(game.week_number) !== weekNumber) throw new ApiError(400, "You can only wager on this week's games.");

  const myTeamId = await activeTeamId(leagueId, userId);
  if (myTeamId && (game.home_team_id === myTeamId || game.away_team_id === myTeamId)) {
    throw new ApiError(400, "You can't bet on your own game.");
  }

  const options = await getGameWagerOptions(guildId, gameId);
  if (marketDef.requiresBoxScore && !options.humanInvolved) {
    throw new ApiError(400, "That market is only available on games with a human coach (box score).");
  }
  const marketOption = options.markets.find((m) => m.market === market);
  if (!marketOption) throw new ApiError(400, "That market isn't available for this game.");
  const side = marketOption.sides.find((s) => s.pick === pick);
  if (!side) throw new ApiError(400, "Invalid pick for this market.");

  let line: number | null = marketOption.line;
  if (marketDef.kind === "spread") {
    const isHome = pick === options.homeTeamId;
    line = isHome ? -(marketOption.line ?? 0) : (marketOption.line ?? 0);
  } else if (marketDef.kind === "moneyline") {
    line = null;
  }
  const balance = await walletBalance(userId);
  if (balance < stake) throw new ApiError(400, `Insufficient funds. This stakes ${formatCoins(stake)} and you have ${formatCoins(balance)}.`);
  return { game, options, marketDef, marketOption, side, line, balance };
}

export type PlacePeerWagerInput = {
  guildId: string;
  discordId: string;
  gameId: string;
  market: string;
  pick: string;
  stake: number;
  challengeType: "open" | "direct";
  targetUserId?: string | null;
  /** "user" = placed from the site; "bot" = placed from a Discord slash-command flow, which
   * already posts its own richer (live discord.js) announcement client-side after this call
   * returns — only "user"-origin wagers get the announcement posted here, to avoid a duplicate. */
  origin?: "user" | "bot";
};

// Propose a peer wager: escrow the proposer's stake and leave it awaiting an opponent
// who takes the opposite side. Even-money pot — winner takes 2× the stake.
export async function placePeerWager(input: PlacePeerWagerInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const userId = await userIdFromDiscord(input.discordId);
  await assertSiteAccountForEconomy(userId);
  await assertNotLeagueRestricted(leagueId, userId, "wagers");

  const { assertEconomyPayoutsActive } = await import("../economy/economy-gate.js");
  await assertEconomyPayoutsActive(leagueId);

  const stake = Math.floor(Number(input.stake));
  await assertPeerWeeklyCap(leagueId, seasonNumber, weekNumber, userId, stake);
  const prep = await prepareSingleWager(input.guildId, userId, leagueId, weekNumber, input.gameId, input.market, input.pick, stake);

  if (input.challengeType === "direct") {
    if (!input.targetUserId) throw new ApiError(400, "Pick a coach to challenge.");
    if (input.targetUserId === userId) throw new ApiError(400, "You can't challenge yourself.");
  }

  const payout = stake * 2;
  const insert = await supabase
    .from("rec_wagers")
    .insert({
      league_id: leagueId,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_id: input.gameId,
      placed_by_user_id: userId,
      placed_by_discord_id: input.discordId,
      wager_kind: "peer",
      challenge_type: input.challengeType,
      counterparty_user_id: input.challengeType === "direct" ? input.targetUserId : null,
      market: input.market,
      pick: input.pick,
      line: prep.line,
      odds: 2,
      stake,
      potential_payout: payout,
      status: "awaiting_accept",
    })
    .select("*")
    .single();
  if (insert.error) {
    if (insert.error.code === "23505") throw new ApiError(409, "You already have this exact wager (same game and market) this week.");
    throw new ApiError(500, "We couldn't propose that wager. Please try again.", insert.error);
  }

  const hold = await supabase.rpc("add_to_wallet", {
    p_user_id: userId,
    p_amount: -stake,
    p_league_id: leagueId,
    p_description: `Peer wager hold — ${prep.marketDef.label}`,
    p_transaction_type: "wager_hold",
    p_source: "wager",
    p_source_reference: { wagerId: insert.data.id },
  });
  if (hold.error) {
    await supabase.from("rec_wagers").delete().eq("id", insert.data.id);
    throw new ApiError(500, "We couldn't hold funds for that wager. Please try again.", hold.error);
  }
  await supabase.from("rec_wagers").update({ hold_ledger_id: hold.data }).eq("id", insert.data.id);

  const gameLabel = `${prep.options.awayLabel} at ${prep.options.homeLabel}`;
  const marketLabel = prep.marketDef.label;
  const proposerPickLabel = prep.side.label;
  const announcementsChannelId = (context.routes as any)?.announcements_channel_id ?? null;

  // A direct challenge is invisible to the challenged coach unless they happen to open the
  // wagers board — notify them everywhere we can reach them: site bell, push, and a Discord DM
  // if their account has Discord linked.
  if (input.challengeType === "direct" && input.targetUserId) {
    const targetAccount = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", input.targetUserId).maybeSingle();
    const targetDiscordId = targetAccount.data?.discord_id ?? null;
    const href = `/l/${leagueId}/matchups`;
    const title = "You've been challenged to a wager";
    const body = `${gameLabel} — ${marketLabel}: they took ${proposerPickLabel}. ${formatCoins(stake)} stake, winner takes ${formatCoins(payout)}.`;
    bestEffortVoid("notification.wager_challenge", createSiteNotification({ userId: input.targetUserId, leagueId, kind: "wager_challenge", title, body, href }), { leagueId, userId: input.targetUserId });
    bestEffortVoid("push.wager_challenge", sendPushToUsers([input.targetUserId], { title, body, url: href }), { leagueId, userId: input.targetUserId });
    if (targetDiscordId) {
      void sendDiscordDirectMessage(targetDiscordId, `**${title}**\n${body}\nAccept it from the wagers board on the site or in Discord.`).catch((error) => {
        console.error("[ERROR] Failed to DM direct wager challenge (non-fatal):", error);
      });
    }
  }

  // Site-placed peer wagers didn't get the Discord announcement Discord-placed ones already
  // get client-side from the bot — post it here instead, with the same Accept button (no
  // Counter — Discord doesn't offer that flow, only the site does; customId matches
  // apps/bot/src/flows/wagers.ts's WAGER_CUSTOM_IDS.acceptPrefix so the bot's existing button
  // handler works on this message exactly as if it had posted it).
  if (input.origin === "user" && announcementsChannelId) {
    void (async () => {
      const isDirect = input.challengeType === "direct";
      let targetDiscordId: string | null = null;
      if (isDirect && input.targetUserId) {
        const targetAccount = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", input.targetUserId).maybeSingle();
        targetDiscordId = targetAccount.data?.discord_id ?? null;
      }
      const fields = [
        { name: "FROM", value: `<@${input.discordId}>`, inline: true },
        ...(isDirect && targetDiscordId ? [{ name: "TO", value: `<@${targetDiscordId}>`, inline: true }] : []),
        { name: "GAME", value: gameLabel, inline: false },
        { name: "PROPOSER TAKES", value: `${marketLabel}: **${proposerPickLabel}**`, inline: false },
        { name: "YOU'D TAKE", value: `The other side of ${marketLabel}.`, inline: false },
        { name: "STAKE / POT", value: `${formatCoins(stake)} each — winner takes ${formatCoins(payout)}`, inline: false },
      ];
      const sent = await postDiscordChannelMessage(announcementsChannelId, {
        content: isDirect && targetDiscordId ? `<@${targetDiscordId}>` : "@everyone",
        embeds: [{
          title: isDirect ? "Head-to-Head Challenge" : "Open Wager Challenge",
          color: 0x8855dd,
          fields,
          footer: { text: isDirect ? "Accept to lock it in." : "Click Take Wager to take the other side." },
        }],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: "Accept", custom_id: `rec:wager:accept:${insert.data.id}` },
          ],
        }],
        allowed_mentions: isDirect && targetDiscordId ? { users: [targetDiscordId] } : { parse: ["everyone"] },
      }).catch((error) => {
        console.error("[ERROR] Failed to post peer wager announcement (non-fatal):", error);
        return null;
      });
      if (sent?.id) {
        await supabase.from("rec_wagers").update({ announcement_channel_id: announcementsChannelId, announcement_message_id: sent.id }).eq("id", insert.data.id);
      }
    })();
  }

  return {
    wager: { ...insert.data, hold_ledger_id: hold.data },
    proposerPickLabel,
    marketLabel,
    gameLabel,
    stake,
    payout,
    walletBalance: prep.balance - stake,
    announcementsChannelId,
  };
}

// A user takes the opposite side of an open/direct peer wager.
export async function acceptPeerWager(input: { guildId: string; discordId: string; wagerId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const accepterId = await userIdFromDiscord(input.discordId);
  await assertSiteAccountForEconomy(accepterId);
  await assertNotLeagueRestricted(leagueId, accepterId, "wagers");

  const { data: wager, error } = await supabase.from("rec_wagers").select("*").eq("id", input.wagerId).eq("league_id", leagueId).maybeSingle();
  if (error) throw new ApiError(500, "We couldn't load that wager. Please try again.", error);
  if (!wager || wager.status !== "awaiting_accept") throw new ApiError(409, "This wager is no longer open to accept.");
  if (wager.placed_by_user_id === accepterId) throw new ApiError(400, "You can't take your own wager.");
  if (wager.challenge_type === "direct" && wager.counterparty_user_id && wager.counterparty_user_id !== accepterId) {
    throw new ApiError(400, "This direct challenge was sent to a specific coach.");
  }

  // Accepter can't be playing in the wagered game either.
  const myTeamId = await activeTeamId(leagueId, accepterId);
  if (myTeamId && wager.game_id) {
    const { data: g } = await supabase.from("rec_games").select("home_team_id,away_team_id").eq("id", wager.game_id).maybeSingle();
    if (g && (g.home_team_id === myTeamId || g.away_team_id === myTeamId)) {
      throw new ApiError(400, "You can't take a wager on your own game.");
    }
  }

  const stake = Number(wager.stake ?? 0);
  await assertPeerWeeklyCap(leagueId, Number(wager.season_number), Number(wager.week_number), accepterId, stake);
  const balance = await walletBalance(accepterId);
  if (balance < stake) throw new ApiError(400, `Insufficient funds. This wager stakes ${formatCoins(stake)} and you have ${formatCoins(balance)}.`);

  const hold = await supabase.rpc("add_to_wallet", {
    p_user_id: accepterId,
    p_amount: -stake,
    p_league_id: leagueId,
    p_description: `Peer wager hold — ${wager.market}`,
    p_transaction_type: "wager_hold",
    p_source: "wager",
    p_source_reference: { wagerId: wager.id, accepter: true },
  });
  if (hold.error) throw new ApiError(500, "We couldn't hold funds for that wager. Please try again.", hold.error);

  const updated = await supabase
    .from("rec_wagers")
    .update({ accepted_by_user_id: accepterId, accepted_by_discord_id: input.discordId, status: "pending", updated_at: new Date().toISOString() })
    .eq("id", wager.id)
    .eq("status", "awaiting_accept")
    .select("*")
    .single();
  if (updated.error) {
    // Lost the race — refund the hold.
    await supabase.rpc("add_to_wallet", { p_user_id: accepterId, p_amount: stake, p_league_id: leagueId, p_description: "Peer wager hold reversed", p_transaction_type: "wager_refund", p_source: "wager", p_source_reference: { wagerId: wager.id } });
    throw new ApiError(409, "Someone else just took this wager.");
  }

  if (wager.placed_by_user_id) {
    const href = `/l/${leagueId}/matchups`;
    const title = "Your wager was accepted";
    const body = `${wager.market ? `${wager.market} — ` : ""}${formatCoins(stake)} is on the line. View it on the wagers board.`;
    bestEffortVoid("notification.wager_accepted", createSiteNotification({ userId: wager.placed_by_user_id, leagueId, kind: "wager_accepted", title, body, href }), { leagueId, userId: wager.placed_by_user_id });
    bestEffortVoid("push.wager_accepted", sendPushToUsers([wager.placed_by_user_id], { title, body, url: href }), { leagueId, userId: wager.placed_by_user_id });
  }

  return {
    wager: updated.data,
  };
}

export async function declinePeerWager(input: { wagerId: string }) {
  const { data: wager } = await supabase.from("rec_wagers").select("*").eq("id", input.wagerId).maybeSingle();
  if (!wager || wager.status !== "awaiting_accept") return { ok: false };
  await refundWagerStake(wager, "Peer wager declined — refund");
  await supabase.from("rec_wagers").delete().eq("id", wager.id);
  return { ok: true, announcementChannelId: wager.announcement_channel_id, announcementMessageId: wager.announcement_message_id };
}

// Active linked coaches (for the direct-challenge opponent picker), split by conference.
export async function listChallengeableCoaches(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const me = await bestEffort("wagers.resolve_challenger_user", () => userIdFromDiscord(discordId), { guildId }) ?? null;
  const { data } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,team:rec_teams(name,abbreviation,display_abbr,conference,division)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  const userIds = [...new Set((data ?? []).map((a: any) => a.user_id).filter(Boolean))];
  const { data: discordAccounts } = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds)
    : { data: [] };
  const discordByUser = new Map((discordAccounts ?? []).map((account: any) => [account.user_id, account.discord_id]));
  const coaches = (data ?? [])
    .filter((a: any) => a.user_id && a.user_id !== me)
    .map((a: any) => {
      const team = a.team;
      return {
        userId: a.user_id,
        discordId: discordByUser.get(a.user_id) ?? null,
        teamAbbr: teamAbbr(team),
        conference: canonicalConferenceName(team?.conference, team?.division),
      };
    });
  return { coaches };
}

export async function listPeerWagerBoard(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const viewerUserId = await userIdFromDiscord(discordId);

  const { data, error } = await supabase
    .from("rec_wagers")
    .select("id,game_id,wager_kind,challenge_type,counterparty_user_id,placed_by_user_id,placed_by_discord_id,accepted_by_user_id,accepted_by_discord_id,market,pick,line,odds,stake,potential_payout,status,created_at")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .eq("wager_kind", "peer")
    .in("status", ["awaiting_accept", "pending"])
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "We couldn't load the wager board. Please try again.", error);

  const rows = (data ?? []).filter((w: any) => {
    if (w.status === "pending") return true; // active accepted wagers are public
    if (w.placed_by_user_id === viewerUserId) return true;
    if (w.challenge_type === "direct") return w.counterparty_user_id === viewerUserId;
    if (w.challenge_type === "counter") return w.counterparty_user_id === viewerUserId;
    return true;
  });
  const gameIds = [...new Set(rows.map((w: any) => w.game_id).filter(Boolean))];
  const games = gameIds.length
    ? await supabase.from("rec_games").select("id,home_team_id,away_team_id,status,home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation,display_abbr)").in("id", gameIds)
    : { data: [] };
  const gameById = new Map<string, any>((games.data ?? []).map((game: any) => [game.id, game]));
  const gameLabelById = new Map(
    (games.data ?? []).map((game: any) => [game.id, `${teamAbbr(game.away_team)} at ${teamAbbr(game.home_team)}`]),
  );

  const userIds = [
    ...new Set(
      rows.flatMap((w: any) => [w.placed_by_user_id, w.accepted_by_user_id]).filter(Boolean),
    ),
  ];
  const users = userIds.length
    ? await supabase.from("rec_users").select("id,username,display_name").in("id", userIds)
    : { data: [] };
  const nameByUserId = new Map(
    (users.data ?? []).map((u: any) => [u.id, u.display_name ?? u.username ?? "REC Member"]),
  );

  return {
    wagers: rows.map((w: any) => {
      const game = w.game_id ? gameById.get(w.game_id) : null;
      const gameScheduled = !game || game.status === "scheduled";
      const isPlacer = w.placed_by_user_id === viewerUserId;
      return {
        id: w.id,
        gameId: w.game_id,
        gameLabel: gameLabelById.get(w.game_id) ?? "Scheduled game",
        challengeType: w.challenge_type,
        market: w.market,
        marketLabel: WAGER_MARKET_BY_KEY.get(w.market)?.label ?? w.market,
        pick: w.pick,
        pickLabel: pickLabelFor(w, gameById),
        line: w.line,
        odds: w.odds,
        stake: Number(w.stake ?? 0),
        potentialPayout: Number(w.potential_payout ?? 0),
        status: w.status,
        boardState: w.status === "awaiting_accept" ? "open" : "active",
        placedByDiscordId: w.placed_by_discord_id,
        placedByName: nameByUserId.get(w.placed_by_user_id) ?? "REC Member",
        acceptedByName: w.accepted_by_user_id ? nameByUserId.get(w.accepted_by_user_id) ?? "REC Member" : null,
        isMine: isPlacer,
        canAccept:
          w.status === "awaiting_accept" &&
          !isPlacer &&
          (w.challenge_type !== "direct" || w.counterparty_user_id === viewerUserId),
        canEdit: isPlacer && (
          w.status === "awaiting_accept" ||
          (w.status === "pending" && gameScheduled)
        ),
        createdAt: w.created_at,
      };
    }),
  };
}

// Sportsbook hub: every wager (house or peer) the viewer has any stake in this season —
// placed, accepted, or a direct-challenge target — regardless of week, so "My Wagers"
// covers open, active, and settled/refunded history in one list.
export async function listMyWagers(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const viewerUserId = await userIdFromDiscord(discordId);
  if (!viewerUserId) return { wagers: [] };

  const { data, error } = await supabase
    .from("rec_wagers")
    .select("id,game_id,wager_kind,challenge_type,counterparty_user_id,placed_by_user_id,placed_by_discord_id,accepted_by_user_id,accepted_by_discord_id,market,pick,line,odds,stake,potential_payout,status,week_number,settled_at,created_at")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .or(`placed_by_user_id.eq.${viewerUserId},accepted_by_user_id.eq.${viewerUserId},counterparty_user_id.eq.${viewerUserId}`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new ApiError(500, "We couldn't load your wagers. Please try again.", error);
  const rows = data ?? [];

  const gameIds = [...new Set(rows.map((w: any) => w.game_id).filter(Boolean))];
  const games = gameIds.length
    ? await supabase.from("rec_games").select("id,home_team_id,away_team_id,status,home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation,display_abbr)").in("id", gameIds)
    : { data: [] };
  const gameById = new Map<string, any>((games.data ?? []).map((game: any) => [game.id, game]));
  const gameLabelById = new Map((games.data ?? []).map((game: any) => [game.id, `${teamAbbr(game.away_team)} at ${teamAbbr(game.home_team)}`]));

  const userIds = [...new Set(rows.flatMap((w: any) => [w.placed_by_user_id, w.accepted_by_user_id]).filter(Boolean))];
  const users = userIds.length ? await supabase.from("rec_users").select("id,username,display_name").in("id", userIds) : { data: [] };
  const nameByUserId = new Map((users.data ?? []).map((u: any) => [u.id, u.display_name ?? u.username ?? "REC Member"]));

  return {
    wagers: rows.map((w: any) => {
      const game = w.game_id ? gameById.get(w.game_id) : null;
      const gameScheduled = !game || game.status === "scheduled";
      const isPlacer = w.placed_by_user_id === viewerUserId;
      return {
        id: w.id,
        gameId: w.game_id,
        gameLabel: w.game_id ? gameLabelById.get(w.game_id) ?? "Scheduled game" : "House line",
        weekNumber: Number(w.week_number ?? 0),
        wagerKind: w.wager_kind,
        challengeType: w.challenge_type,
        market: w.market,
        marketLabel: WAGER_MARKET_BY_KEY.get(w.market)?.label ?? w.market,
        pickLabel: pickLabelFor(w, gameById),
        stake: Number(w.stake ?? 0),
        potentialPayout: Number(w.potential_payout ?? 0),
        status: w.status,
        boardState: w.status === "awaiting_accept" ? "open" : ["pending", "confirmed"].includes(w.status) ? "active" : "settled",
        placedByName: nameByUserId.get(w.placed_by_user_id) ?? "REC Member",
        acceptedByName: w.accepted_by_user_id ? nameByUserId.get(w.accepted_by_user_id) ?? "REC Member" : null,
        isMine: isPlacer,
        canEdit: isPlacer && (
          w.status === "awaiting_accept" ||
          (["pending", "confirmed"].includes(w.status) && gameScheduled)
        ),
        settledAt: w.settled_at,
        createdAt: w.created_at,
      };
    }),
  };
}

// Shared by listPeerWagerBoard and listMyWagers — a moneyline/spread wager's `pick` column
// stores the winning team's UUID; resolve it to a team abbreviation for display instead of
// showing the raw id. Total markets already store a human-readable "over"/"under".
function pickLabelFor(w: any, gameById: Map<string, any>): string {
  const kind = WAGER_MARKET_BY_KEY.get(w.market)?.kind;
  if (kind === "total" || kind === "team_total") {
    const side = String(w.pick ?? "").toLowerCase() === "under" ? "Under" : "Over";
    return w.line != null ? `${side} ${w.line}` : side;
  }
  const game = gameById.get(w.game_id);
  if (!game) return String(w.pick ?? "");
  const teamLabel =
    w.pick === game.home_team_id
      ? teamAbbr(game.home_team)
      : w.pick === game.away_team_id
        ? teamAbbr(game.away_team)
        : String(w.pick ?? "");
  if (kind === "spread" && w.line != null) {
    // w.line is stored already signed relative to the picked team (see prepareSingleWager /
    // placeHouseWager: `isHome ? -rawSpread : rawSpread`) — re-flipping it here by home/away
    // double-inverted the sign for the home side, so a wager placed on "TEAM -5.5" displayed
    // back as "TEAM +5.5" everywhere this label is shown (My Wagers, Peer Wager Board).
    const line = Number(w.line);
    return `${teamLabel} ${line > 0 ? "+" : ""}${line}`;
  }
  return teamLabel;
}

export async function attachWagerAnnouncementMessage(input: { wagerId: string; channelId: string; messageId: string }) {
  const { error } = await supabase
    .from("rec_wagers")
    .update({ announcement_channel_id: input.channelId, announcement_message_id: input.messageId, updated_at: new Date().toISOString() })
    .eq("id", input.wagerId);
  if (error) throw new ApiError(500, "We couldn't save the wager announcement. Please try again.", error);
  return { ok: true };
}

export type PlaceParlayInput = {
  guildId: string;
  discordId: string;
  legs: Array<{ gameId: string; market: string; pick: string }>;
  stake: number;
};

// A 2- or 3-leg parlay vs the house: single escrowed stake, combined (boosted) odds.
// All legs must win; pushes drop out. Settles only once every leg's game is confirmed.
export async function placeParlay(input: PlaceParlayInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const userId = await userIdFromDiscord(input.discordId);
  await assertSiteAccountForEconomy(userId);
  await assertNotLeagueRestricted(leagueId, userId, "wagers");

  const { assertEconomyPayoutsActive } = await import("../economy/economy-gate.js");
  await assertEconomyPayoutsActive(leagueId);

  if (!Array.isArray(input.legs) || input.legs.length !== 3) throw new ApiError(400, "A parlay needs exactly 3 stat-line picks.");
  const gameIds = new Set(input.legs.map((leg) => leg.gameId));
  if (gameIds.size !== 1) throw new ApiError(400, "All 3 parlay picks must come from the same game.");
  const gameMarketSeen = new Set<string>();
  for (const leg of input.legs) {
    const definition = WAGER_MARKET_BY_KEY.get(leg.market);
    if (definition?.kind !== "total" || !definition.statKey || definition.statKey === "points") {
      throw new ApiError(400, "3-pick parlays only allow player/team stat-line over-under markets.");
    }
    const key = `${leg.gameId}:${leg.market}`;
    if (gameMarketSeen.has(key)) throw new ApiError(400, "Each parlay leg must be a different game+market.");
    gameMarketSeen.add(key);
  }

  const stake = Math.floor(Number(input.stake));
  if (!Number.isFinite(stake) || stake <= 0) throw new ApiError(400, "Enter a positive whole-dollar stake.");
  await assertHouseWeeklyCap(leagueId, seasonNumber, weekNumber, userId, stake);
  const balance = await walletBalance(userId);
  if (balance < stake) throw new ApiError(400, `Insufficient funds. This stakes ${formatCoins(stake)} and you have ${formatCoins(balance)}.`);

  const prepared: Array<{ gameId: string; market: string; pick: string; line: number | null; odds: number; label: string }> = [];
  for (const leg of input.legs) {
    const prep = await prepareSingleWager(input.guildId, userId, leagueId, weekNumber, leg.gameId, leg.market, leg.pick, stake);
    prepared.push({ gameId: leg.gameId, market: leg.market, pick: leg.pick, line: prep.line, odds: Number(prep.side.odds), label: `${prep.options.awayLabel} at ${prep.options.homeLabel} — ${prep.marketDef.label}: ${prep.side.label}${prep.line != null && prep.marketDef.kind === "spread" ? ` (line ${prep.line > 0 ? "+" : ""}${prep.line})` : ""}` });
  }

  const combinedOdds = parlayOdds(prepared.map((l) => l.odds));
  const payout = potentialPayout(stake, combinedOdds);

  const insert = await supabase
    .from("rec_wagers")
    .insert({
      league_id: leagueId, season_number: seasonNumber, week_number: weekNumber,
      game_id: null, placed_by_user_id: userId, placed_by_discord_id: input.discordId,
      wager_kind: "house", market: "parlay", pick: "parlay", line: null,
      odds: combinedOdds, stake, potential_payout: payout, status: "pending", is_parlay: true,
    })
    .select("*")
    .single();
  if (insert.error) throw new ApiError(500, "We couldn't place that parlay. Please try again.", insert.error);

  const legRows = prepared.map((l) => ({ wager_id: insert.data.id, game_id: l.gameId, market: l.market, pick: l.pick, line: l.line, odds: l.odds }));
  const legInsert = await supabase.from("rec_wager_legs").insert(legRows);
  if (legInsert.error) {
    await supabase.from("rec_wagers").delete().eq("id", insert.data.id);
    throw new ApiError(500, "We couldn't save the parlay legs. Please try again.", legInsert.error);
  }

  const hold = await supabase.rpc("add_to_wallet", {
    p_user_id: userId, p_amount: -stake, p_league_id: leagueId,
    p_description: `Parlay hold (${input.legs.length}-pick)`, p_transaction_type: "wager_hold", p_source: "wager",
    p_source_reference: { wagerId: insert.data.id },
  });
  if (hold.error) {
    await supabase.from("rec_wagers").delete().eq("id", insert.data.id);
    throw new ApiError(500, "We couldn't hold funds for that parlay. Please try again.", hold.error);
  }
  await supabase.from("rec_wagers").update({ hold_ledger_id: hold.data }).eq("id", insert.data.id);

  return {
    wager: { ...insert.data, hold_ledger_id: hold.data },
    legs: prepared.map((l) => l.label),
    combinedOdds, stake, payout,
    walletBalance: balance - stake,
  };
}

// Resolve a parlay: returns null until every leg's game is confirmed, then 'lost'
// (any leg lost), 'push' (all legs push), or 'won' with the recomputed payout
// (surviving non-push legs).
async function resolveParlay(leagueId: string, wagerId: string, stake: number): Promise<{ outcome: "won" | "lost" | "push"; payout: number } | null> {
  const { data: legs } = await supabase.from("rec_wager_legs").select("*").eq("wager_id", wagerId);
  if (!legs?.length) return null;
  const results: Array<"won" | "lost" | "push"> = [];
  for (const leg of legs) {
    const outcome = await resolveOutcome(leagueId, { game_id: leg.game_id, market: leg.market, pick: leg.pick, line: leg.line, wager_kind: "house" });
    if (outcome == null) return null; // a leg's game isn't confirmed yet
    results.push(outcome);
  }
  // One update per distinct outcome value instead of one per leg.
  const idsByOutcome = new Map<"won" | "lost" | "push", string[]>();
  legs.forEach((leg, i) => {
    const ids = idsByOutcome.get(results[i]) ?? [];
    ids.push(leg.id);
    idsByOutcome.set(results[i], ids);
  });
  for (const [outcome, ids] of idsByOutcome) {
    await supabase.from("rec_wager_legs").update({ leg_result: outcome }).in("id", ids);
  }
  if (results.some((r) => r === "lost")) return { outcome: "lost", payout: 0 };
  const wonOdds = legs.filter((_, i) => results[i] === "won").map((l) => Number(l.odds));
  if (!wonOdds.length) return { outcome: "push", payout: stake }; // all legs pushed
  return { outcome: "won", payout: potentialPayout(stake, parlayOdds(wonOdds)) };
}

// Persist the Discord message ids of the pending-payout embed so it can be refreshed
// when the game result lands and removed on cancel.
export async function attachWagerPendingMessage(input: { wagerId: string; channelId: string; messageId: string }) {
  const { error } = await supabase
    .from("rec_wagers")
    .update({ pending_channel_id: input.channelId, pending_message_id: input.messageId, updated_at: new Date().toISOString() })
    .eq("id", input.wagerId);
  if (error) throw new ApiError(500, "We couldn't save the pending wager message. Please try again.", error);
  return { ok: true };
}

// ─── Result resolution ──────────────────────────────────────────────────────────

type GameResult = { home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null; winning_team_id: string | null; is_tie: boolean | null };

async function loadGameResult(leagueId: string, gameId: string): Promise<GameResult | null> {
  // .maybeSingle() errors out (and silently returns data: undefined here, since only `data`
  // is destructured) when more than one row matches — and a duplicate rec_game_results row
  // for the same game_id/league_id is a real, observed data-integrity bug (two writers can
  // both insert a result for the same game). Use a plain select + take the newest row instead
  // of failing closed and making a scored game look unscored, which stranded wagers at
  // "pending" forever with no path to settlement.
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,winning_team_id,is_tie")
    .eq("league_id", leagueId)
    .eq("game_id", gameId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[ERROR] Failed to load game result for wager resolution:", error);
    return null;
  }
  const row = data?.[0];
  if (row && row.home_score != null && row.away_score != null) return row as GameResult;
  return null;
}

async function loadTeamGameStat(leagueId: string, gameId: string, statKey: string): Promise<{ home: number; away: number; combined: number; average: number } | null> {
  const { data } = await supabase
    .from("rec_team_game_stats")
    .select("team_id,is_home,off_rush_yards,off_pass_yards,total_yards_gained,off_yards_gained,turnovers_committed,red_zone_off_percentage,red_zone_def_percentage")
    .eq("league_id", leagueId)
    .eq("game_id", gameId);
  if (!data || data.length < 2) return null;
  const field: Record<string, string> = {
    total_yards: "total_yards_gained",
    rush_yards: "off_rush_yards",
    pass_yards: "off_pass_yards",
    turnovers: "turnovers_committed",
    redzone_off: "red_zone_off_percentage",
    redzone_def: "red_zone_def_percentage",
  };
  const col = field[statKey];
  if (!col) return null;
  const val = (r: any) => Number(r[col] ?? (col === "total_yards_gained" ? r.off_yards_gained : 0)) || 0;
  const homeRow = data.find((r: any) => r.is_home) ?? data[0];
  const awayRow = data.find((r: any) => !r.is_home) ?? data[1];
  const home = val(homeRow);
  const away = val(awayRow);
  return { home, away, combined: home + away, average: (home + away) / 2 };
}

// Decide win/lose/push for a single (market, pick, line) against a confirmed result.
// Returns null when the result needed isn't available yet.
async function resolveOutcome(leagueId: string, wager: { game_id: string | null; market: string; pick: string; line: number | null; wager_kind?: string | null }): Promise<"won" | "lost" | "push" | null> {
  if (!wager.game_id) return null;
  const def = WAGER_MARKET_BY_KEY.get(wager.market);
  if (!def) return null;
  const result = await loadGameResult(leagueId, wager.game_id);
  if (!result) return null;
  const homeScore = Number(result.home_score);
  const awayScore = Number(result.away_score);
  const isTie = result.is_tie || homeScore === awayScore;

  if (def.kind === "moneyline") {
    // House rule: a tie loses the moneyline regardless of pick. Peer wagers push a
    // tie (neither side's team won) so both coaches get refunded.
    if (isTie) return wager.wager_kind === "peer" ? "push" : "lost";
    return result.winning_team_id === wager.pick ? "won" : "lost";
  }

  if (def.kind === "spread") {
    const pickIsHome = wager.pick === result.home_team_id;
    const margin = pickIsHome ? homeScore - awayScore : awayScore - homeScore;
    const adjusted = margin + Number(wager.line ?? 0);
    if (adjusted === 0) return "push";
    return adjusted > 0 ? "won" : "lost";
  }

  // Totals.
  const line = Number(wager.line ?? 0);
  let actual: number | null = null;
  if (def.statKey === "points") {
    // team_total_points_home/away settle against just that team's score, not the combined
    // total — this was using homeScore + awayScore for every points market regardless of
    // def.team, so a "Home Team Total Points" bet was silently graded against the whole
    // game's combined score instead of the home team's own score.
    actual = def.team === "home" ? homeScore : def.team === "away" ? awayScore : homeScore + awayScore;
  } else {
    const stat = await loadTeamGameStat(leagueId, wager.game_id, def.statKey ?? "");
    if (!stat) return null; // box-score stat not logged yet
    actual = def.statKey === "redzone_off" || def.statKey === "redzone_def" ? stat.average : stat.combined;
  }
  if (actual == null) return null;
  if (actual === line) return "push";
  const isOver = actual > line;
  return (wager.pick === "over" && isOver) || (wager.pick === "under" && !isOver) ? "won" : "lost";
}

// Everything a commissioner needs to sanity-check a wager against the actual game outcome
// before clicking Settle: what was bet, on which side, and what the game actually did —
// the commissioner-inbox card only showed the stake and who placed it, with no way to verify
// the computed outcome is right before approving.
export async function getWagerResolvability(leagueId: string, wagerId: string) {
  const { data: wager } = await supabase.from("rec_wagers").select("*").eq("id", wagerId).maybeSingle();
  if (!wager) return { resolvable: false, outcome: null as null };
  const outcome = await resolveOutcome(leagueId, wager);

  const game = wager.game_id
    ? (await supabase.from("rec_games")
        .select("id,home_team_id,away_team_id,status,home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation,display_abbr)")
        .eq("id", wager.game_id).maybeSingle()).data
    : null;
  const gameById = game ? new Map([[game.id, game]]) : new Map();
  const result = wager.game_id ? await loadGameResult(leagueId, wager.game_id) : null;

  const [placedBy, acceptedBy] = await Promise.all([
    wager.placed_by_user_id ? supabase.from("rec_users").select("username,display_name").eq("id", wager.placed_by_user_id).maybeSingle() : null,
    wager.accepted_by_user_id ? supabase.from("rec_users").select("username,display_name").eq("id", wager.accepted_by_user_id).maybeSingle() : null,
  ]);

  return {
    resolvable: outcome != null,
    outcome,
    wager,
    gameLabel: game ? `${teamAbbr(game.away_team)} at ${teamAbbr(game.home_team)}` : "House line",
    marketLabel: WAGER_MARKET_BY_KEY.get(wager.market)?.label ?? wager.market,
    pickLabel: pickLabelFor(wager, gameById),
    placedByName: placedBy?.data?.display_name ?? placedBy?.data?.username ?? null,
    acceptedByName: acceptedBy?.data?.display_name ?? acceptedBy?.data?.username ?? null,
    finalScore: result && game
      ? { home: teamAbbr(game.home_team), homeScore: Number(result.home_score), away: teamAbbr(game.away_team), awayScore: Number(result.away_score), isTie: Boolean(result.is_tie) }
      : null,
  };
}

// Credit the bettor (and peer counterparty) for a resolved outcome and close the row.
// won → potential payout to the winner; push → stakes refunded; lost → house keeps.
async function creditAndCloseWager(wager: any, outcome: "won" | "lost" | "push"): Promise<number> {
  const now = new Date().toISOString();
  let payoutLedgerId: string | null = null;
  let credited = 0;
  const isPeer = wager.wager_kind === "peer" && wager.accepted_by_user_id;

  if (outcome === "push") {
    // Refund both sides' stakes.
    await refundWagerStake(wager, `Wager push refund — ${wager.market}`);
    credited = Number(wager.stake ?? 0);
  } else if (outcome === "won") {
    // House bet: bettor wins their potential payout. Peer: winner takes the pot.
    const winnerUserId = wager.placed_by_user_id;
    const amount = isPeer ? Number(wager.stake ?? 0) * 2 : Number(wager.potential_payout ?? 0);
    const credit = await creditOrBacklog({
      leagueId: wager.league_id,
      seasonNumber: wager.season_number,
      userId: winnerUserId,
      amount,
      description: `Wager payout — ${wager.market}`,
      transactionType: "wager_payout",
      source: "wager",
      sourceReference: { wagerId: wager.id, outcome },
    });
    payoutLedgerId = credit.ledgerId;
    credited = amount;
  } else if (isPeer) {
    // Peer loss for the proposer means the accepter won the pot.
    const amount = Number(wager.stake ?? 0) * 2;
    const credit = await creditOrBacklog({
      leagueId: wager.league_id,
      seasonNumber: wager.season_number,
      userId: wager.accepted_by_user_id,
      amount,
      description: `Wager payout — ${wager.market}`,
      transactionType: "wager_payout",
      source: "wager",
      sourceReference: { wagerId: wager.id, outcome: "won-by-accepter" },
    });
    payoutLedgerId = credit.ledgerId;
    credited = amount;
  }

  await supabase
    .from("rec_wagers")
    .update({ status: outcome, settled_at: now, payout_ledger_id: payoutLedgerId, updated_at: now })
    .eq("id", wager.id);
  return credited;
}

// Record a commissioner-inbox row the moment a wager's result becomes known (i.e. it
// is confirmed-resolvable) and is now awaiting the commissioner's settle action. The
// wagers table has no distinct "confirmed" status of its own (wagers stay "pending"
// until settleWager closes them) — the normal caller is listConfirmableWagers, so the
// row exists as "pending" in the inbox before settlement happens. settleWager also
// calls this as a fallback for a wager that reaches settle without ever having been
// surfaced there. Guarded by the inbox table's unique (guild_id, queue_type,
// source_table, source_id) index so neither caller ever double-inserts.
async function recordWagerInbox(wager: any): Promise<void> {
  const link = await supabase
    .from("rec_server_league_links")
    .select("server_id")
    .eq("league_id", wager.league_id)
    .eq("is_primary", true)
    .maybeSingle();
  const serverId: string | null = link.data?.server_id ?? null;
  const server = serverId
    ? await supabase.from("rec_discord_servers").select("guild_id").eq("id", serverId).maybeSingle()
    : { data: null };
  const guildId: string | null = server.data?.guild_id ?? null;
  // guild_id is required on the inbox table; if we can't resolve the wager's server
  // (shouldn't happen in practice), skip the inbox row rather than failing settlement.
  if (!guildId) return;

  const { error } = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: guildId,
    server_id: serverId,
    league_id: wager.league_id,
    season_number: wager.season_number ?? null,
    week_number: wager.week_number ?? null,
    queue_type: "wager",
    status: "pending",
    priority: 0,
    header: `Wager settle: ${wager.market} — ${formatCoins(wager.stake)}`,
    summary: `Wager placed by <@${wager.placed_by_discord_id}> is ready to settle.`,
    requester_discord_id: wager.placed_by_discord_id,
    requester_user_id: wager.placed_by_user_id ?? null,
    amount: wager.stake,
    source_table: "rec_wagers",
    source_id: wager.id,
    payload: { wagerId: wager.id, market: wager.market, pick: wager.pick, wagerKind: wager.wager_kind, isParlay: Boolean(wager.is_parlay) },
  });
  // 23505 = unique violation — a row for this wager already exists, which is fine.
  if (error && error.code !== "23505") throw new ApiError(500, "We couldn't add that wager to the commissioner inbox. Please try again.", error);
  if (!error) void notifyLeagueCommissionersOfPendingItem(wager.league_id);
}

// Approve a wager payout — only succeeds once the game result is confirmed.
export async function settleWager(input: { wagerId: string; leagueId?: string | null; reviewedByDiscordId: string }) {
  let wagerQuery = supabase.from("rec_wagers").select("*").eq("id", input.wagerId);
  if (input.leagueId) wagerQuery = wagerQuery.eq("league_id", input.leagueId);
  const { data: wager, error } = await wagerQuery.maybeSingle();
  if (error) throw new ApiError(500, "We couldn't load that wager. Please try again.", error);
  if (!wager) throw new ApiError(404, "Wager not found.");
  if (!["pending", "confirmed"].includes(wager.status)) {
    // The wager left pending/confirmed some other way (e.g. the advance grace-period sweep
    // auto-refunded it before a result ever got logged) but its commissioner-inbox card was
    // never cleared — clicking Settle here did nothing and the same stale card just kept
    // reappearing. Close it out now that we know it's moot.
    const now = new Date().toISOString();
    await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "resolved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now })
      .eq("source_table", "rec_wagers")
      .eq("source_id", wager.id)
      .eq("status", "pending");
    return { ok: false, alreadyResolved: true, status: wager.status, wager };
  }

  if (wager.is_parlay) {
    const r = await resolveParlay(wager.league_id, wager.id, Number(wager.stake ?? 0));
    if (!r) return { ok: false, notConfirmed: true, wager };
    await recordWagerInbox(wager);
    let credited = 0;
    if (r.payout > 0) {
      if (r.outcome === "won") {
        await creditOrBacklog({
          leagueId: wager.league_id,
          seasonNumber: wager.season_number,
          userId: wager.placed_by_user_id,
          amount: r.payout,
          description: "Parlay payout (3-pick)",
          transactionType: "wager_payout",
          source: "wager",
          sourceReference: { wagerId: wager.id, outcome: r.outcome, parlay: true },
        });
      } else {
        // Push — refunding the original stake, not a new payout, so it's never backlogged.
        const credit = await supabase.rpc("add_to_wallet", {
          p_user_id: wager.placed_by_user_id,
          p_amount: r.payout,
          p_league_id: wager.league_id,
          p_description: "Parlay push refund",
          p_transaction_type: "wager_refund",
          p_source: "wager",
          p_source_reference: { wagerId: wager.id, outcome: r.outcome, parlay: true },
        });
        if (credit.error) throw new ApiError(500, "We couldn't refund that parlay push. Please try again.", credit.error);
      }
      credited = r.payout;
    }
    await supabase.from("rec_wagers").update({ status: r.outcome, settled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", wager.id);
    const now = new Date().toISOString();
    await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "resolved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now })
      .eq("source_table", "rec_wagers")
      .eq("source_id", wager.id);
    return { ok: true, outcome: r.outcome, credited, wager: { ...wager, status: r.outcome } };
  }

  const outcome = await resolveOutcome(wager.league_id, wager);
  if (!outcome) {
    return { ok: false, notConfirmed: true, wager };
  }
  await recordWagerInbox(wager);

  const credited = await creditAndCloseWager(wager, outcome);
  const now = new Date().toISOString();
  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "resolved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now })
    .eq("source_table", "rec_wagers")
    .eq("source_id", wager.id);
  return { ok: true, outcome, credited, wager: { ...wager, status: outcome } };
}

// Pending wagers whose game result is now available — used to refresh their
// pending-payout embeds to the "confirmed" state after a result is logged. This is also
// the earliest point a wager can be identified as "awaiting commissioner settle action"
// (rec_wagers has no persisted "confirmed" status of its own — see recordWagerInbox), so
// it doubles as the trigger for the commissioner-inbox row: the bot calls this function
// via refreshConfirmableWagerEmbeds right after a result is logged (box score / weekly
// scores / advance), which is exactly when a wager first becomes settle-ready.
export async function listConfirmableWagers(leagueId: string) {
  const { data } = await supabase
    .from("rec_wagers")
    .select("id,league_id,season_number,week_number,placed_by_discord_id,placed_by_user_id,pending_channel_id,pending_message_id,game_id,market,pick,line,wager_kind,is_parlay,stake")
    .eq("league_id", leagueId)
    .eq("status", "pending");
  const wagers: Array<{ id: string; channelId: string | null; messageId: string | null }> = [];
  for (const w of data ?? []) {
    const resolvable = w.is_parlay
      ? (await resolveParlay(leagueId, w.id, Number(w.stake ?? 0))) != null
      : (await resolveOutcome(leagueId, w)) != null;
    if (resolvable) {
      await recordWagerInbox(w);
      wagers.push({ id: w.id, channelId: w.pending_channel_id ?? null, messageId: w.pending_message_id ?? null });
    }
  }
  return { wagers };
}

export async function listOpenWagersForWeek(leagueId: string, seasonNumber: number, weekNumber: number) {
  const { data } = await supabase
    .from("rec_wagers")
    .select("id,placed_by_discord_id,market,stake,status,game_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .in("status", ["awaiting_accept", "pending", "confirmed"]);
  return { wagers: data ?? [] };
}

// On advance: an unaccepted open challenge always dies immediately (nobody to refund but
// the placer, and there's nothing to wait on). A wager tied to a game with no logged result
// yet gets a 1-week grace period — the box score Late Submissions window lets a game get a
// score well after its own week, so a wager only gets refunded once its week is 2+ weeks
// behind the league's new current week ("previous week" is still honored, further back is
// not). A wager that already has a usable result (box score OR a manually-entered advance
// score) is left "pending" for a commissioner to settle from Pending Payouts — this also
// seeds its commissioner-inbox row, since nothing else does that anymore now that the old
// Discord bot's periodic confirmable-wager sweep is gone. Returns Discord message coords for
// cleanup of the immediately-expired (awaiting_accept) wagers only.
export async function resolveWagersOnAdvance(input: {
  leagueId: string;
  seasonNumber: number;
  nextWeekNumber: number;
}) {
  const { data } = await supabase
    .from("rec_wagers")
    .select("*")
    .eq("league_id", input.leagueId)
    .eq("season_number", input.seasonNumber)
    .lt("week_number", input.nextWeekNumber)
    .in("status", ["awaiting_accept", "pending", "confirmed"]);

  const now = new Date().toISOString();
  const refundedMessages: Array<{ pendingChannelId: string | null; pendingMessageId: string | null; announcementChannelId: string | null; announcementMessageId: string | null }> = [];
  const reminders: any[] = [];
  const expired: any[] = [];

  for (const w of data ?? []) {
    if (w.status === "awaiting_accept") {
      await refundWagerStake(w, "Wager expired — no opponent took it before advance");
      await supabase.from("rec_wagers").update({ status: "refunded", settled_at: now, updated_at: now }).eq("id", w.id);
      refundedMessages.push({ pendingChannelId: w.pending_channel_id, pendingMessageId: w.pending_message_id, announcementChannelId: w.announcement_channel_id, announcementMessageId: w.announcement_message_id });
      continue;
    }

    const resolvable = w.is_parlay
      ? (await resolveParlay(input.leagueId, w.id, Number(w.stake ?? 0))) != null
      : (await resolveOutcome(input.leagueId, w)) != null;
    if (resolvable) {
      await recordWagerInbox(w);
      continue;
    }

    const weeksBehind = input.nextWeekNumber - Number(w.week_number ?? input.nextWeekNumber);
    if (weeksBehind <= 1) {
      reminders.push(w);
      continue;
    }

    await refundWagerStake(w, "Wager refunded — no box score submitted before the grace period ended");
    await supabase.from("rec_wagers").update({ status: "refunded", settled_at: now, updated_at: now }).eq("id", w.id);
    refundedMessages.push({ pendingChannelId: w.pending_channel_id, pendingMessageId: w.pending_message_id, announcementChannelId: w.announcement_channel_id, announcementMessageId: w.announcement_message_id });
    expired.push(w);
  }

  await notifyCommissionersOfStaleWagers({
    leagueId: input.leagueId,
    nextWeekNumber: input.nextWeekNumber,
    reminders,
    expired,
  }).catch((err) => console.error("[WARN] Failed to notify commissioners of stale wagers (non-fatal):", err));

  return { refundedCount: refundedMessages.length, refundedMessages };
}

async function notifyCommissionersOfStaleWagers(input: {
  leagueId: string;
  nextWeekNumber: number;
  reminders: any[];
  expired: any[];
}): Promise<void> {
  if (!input.reminders.length && !input.expired.length) return;
  const userIds = await listLeagueCommissionerUserIds(input.leagueId);
  if (!userIds.length) return;
  const league = await supabase.from("rec_leagues").select("name").eq("id", input.leagueId).maybeSingle();
  const leagueName = league.data?.name ?? "your league";
  const href = `/l/${input.leagueId}/mgmt/commissioner-chat?officeTab=payouts`;

  if (input.reminders.length) {
    const count = input.reminders.length;
    const deadlineWeek = input.nextWeekNumber + 1;
    const title = `${count} wager${count === 1 ? "" : "s"} waiting on a box score in ${leagueName}`;
    const body = `Submit the missing box score${count === 1 ? "" : "s"} before advancing to week ${deadlineWeek}, or the stake will be refunded with no conclusion.`;
    for (const userId of userIds) {
      bestEffortVoid("notification.wager_grace_reminder", createSiteNotification({ userId, leagueId: input.leagueId, kind: "wager_grace_reminder", title, body, href }), { leagueId: input.leagueId, userId });
    }
    await bestEffort("push.wager_grace_reminder", () => sendPushToUsers(userIds, { title, body, url: href }), { leagueId: input.leagueId });
  }

  if (input.expired.length) {
    const count = input.expired.length;
    const total = input.expired.reduce((sum, w) => sum + Number(w.stake ?? 0), 0);
    const title = `${count} wager${count === 1 ? "" : "s"} refunded in ${leagueName}`;
    const body = `No box score was submitted in time — ${formatCoins(total)} was returned to the players involved with no wager conclusion.`;
    for (const userId of userIds) {
      bestEffortVoid("notification.wager_expired", createSiteNotification({ userId, leagueId: input.leagueId, kind: "wager_expired", title, body, href }), { leagueId: input.leagueId, userId });
    }
    await bestEffort("push.wager_expired", () => sendPushToUsers(userIds, { title, body, url: href }), { leagueId: input.leagueId });
  }
}

// Cancel a pending wager: refund the held stake and remove the wager. leagueId is optional only
// because cancelOwnWager (below) already independently verified league scoping + ownership
// before delegating here — every other caller must pass it.
export async function cancelWager(input: { wagerId: string; leagueId?: string }) {
  let query = supabase.from("rec_wagers").select("*").eq("id", input.wagerId);
  if (input.leagueId) query = query.eq("league_id", input.leagueId);
  const { data: wager, error } = await query.maybeSingle();
  if (error) throw new ApiError(500, "We couldn't load that wager. Please try again.", error);
  if (!wager) throw new ApiError(404, "Wager not found.");
  if (!["pending", "confirmed", "awaiting_accept"].includes(wager.status)) {
    return { ok: false, status: wager.status };
  }
  await refundWagerStake(wager, "Wager cancelled — refund");
  await supabase.from("rec_wagers").delete().eq("id", wager.id);
  return { ok: true, refunded: Number(wager.stake ?? 0), pendingChannelId: wager.pending_channel_id, pendingMessageId: wager.pending_message_id };
}

export async function cancelOwnWager(input: { guildId: string; discordId: string; wagerId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const { data: wager, error } = await supabase.from("rec_wagers").select("*").eq("id", input.wagerId).eq("league_id", context.leagueId).maybeSingle();
  if (error) throw new ApiError(500, "We couldn't load that wager. Please try again.", error);
  if (!wager || wager.placed_by_user_id !== userId) throw new ApiError(404, "Your open wager was not found.");
  if (!["awaiting_accept", "pending", "confirmed"].includes(wager.status)) {
    throw new ApiError(409, "This wager is no longer eligible for cancellation.");
  }
  if (wager.game_id) {
    const game = await supabase.from("rec_games").select("status").eq("id", wager.game_id).eq("league_id", context.leagueId).maybeSingle();
    if (game.error) throw new ApiError(500, "We couldn't verify whether that wager can still be cancelled. Please try again.", game.error);
    if (!game.data || game.data.status !== "scheduled") {
      throw new ApiError(409, "The wager cancellation window closed when game activity was recorded.");
    }
  } else if (wager.is_parlay) {
    // A parlay's own row has no game_id (each leg carries its own) — this check was missing
    // entirely, so a bettor could watch all three legs play out and cancel for a full refund
    // the moment any leg looked like a loser, with no downside if all three would have won.
    const legs = await supabase.from("rec_wager_legs").select("game_id").eq("wager_id", wager.id);
    if (legs.error) throw new ApiError(500, "We couldn't verify whether that parlay can still be cancelled. Please try again.", legs.error);
    const legGameIds = [...new Set((legs.data ?? []).map((leg) => leg.game_id).filter(Boolean))];
    if (legGameIds.length) {
      const games = await supabase.from("rec_games").select("id,status").eq("league_id", context.leagueId).in("id", legGameIds);
      if (games.error) throw new ApiError(500, "We couldn't verify whether that parlay can still be cancelled. Please try again.", games.error);
      const allStillScheduled = legGameIds.every((id) => (games.data ?? []).find((g) => g.id === id)?.status === "scheduled");
      if (!allStillScheduled) {
        throw new ApiError(409, "The wager cancellation window closed when game activity was recorded on one or more legs.");
      }
    }
  }
  return cancelWager({ wagerId: wager.id });
}

// Stops new bets immediately. Unaccepted challenges are refunded; accepted/house
// wagers stay pending so their result can be settled through commissioner review.
export async function closeWageringForGame(input: { guildId: string; gameId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const game = await supabase.from("rec_games").select("id,status").eq("id", input.gameId).eq("league_id", context.leagueId).maybeSingle();
  if (game.error) throw new ApiError(500, "We couldn't load that game. Please try again.", game.error);
  if (!game.data) throw new ApiError(404, "Scheduled game not found.");
  const offers = await supabase.from("rec_wagers").select("*").eq("league_id", context.leagueId).eq("game_id", input.gameId).eq("status", "awaiting_accept");
  if (offers.error) throw new ApiError(500, "We couldn't close the open wagers. Please try again.", offers.error);
  for (const wager of offers.data ?? []) await refundWagerStake(wager, "Wager refunded - game wagering closed");
  if (offers.data?.length) await supabase.from("rec_wagers").update({ status: "refunded", settled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in("id", offers.data.map((wager) => wager.id));
  // "in_progress" isn't a valid rec_game_status enum value (only scheduled/pending_schedule/
  // ready/completed/locked/cancelled exist) — this update threw every single time, uncaught,
  // which aborted the rest of closeGameMarketsAfterStream's Promise.all (and thus the rest of
  // recordStreamPost) whenever a stream triggered this path. "locked" is the real value other
  // wager gates already check for via `status !== "scheduled"` (lines 118, 170, 1394 above).
  if (game.data.status === "scheduled") await supabase.from("rec_games").update({ status: "locked", updated_at: new Date().toISOString() }).eq("id", input.gameId);
  return { closed: true, refundedCount: offers.data?.length ?? 0 };
}

export async function reopenWageringForGame(input: { guildId: string; gameId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const game = await supabase.from("rec_games").select("id,status").eq("id", input.gameId).eq("league_id", context.leagueId).maybeSingle();
  if (game.error) throw new ApiError(500, "We couldn't load that game. Please try again.", game.error);
  if (!game.data) throw new ApiError(404, "Scheduled game not found.");
  // "final" is not a real rec_game_status value (see closeWageringForGame above) — the enum only
  // has scheduled/pending_schedule/ready/completed/locked/cancelled, so that half of this check
  // could never match. "cancelled" should block reopening too, same as "completed".
  if (["completed", "cancelled"].includes(String(game.data.status))) throw new ApiError(409, "Completed or cancelled games cannot be reopened for wagering.");
  const updated = await supabase.from("rec_games").update({ status: "scheduled", updated_at: new Date().toISOString() }).eq("id", input.gameId);
  if (updated.error) throw new ApiError(500, "We couldn't reopen wagering. Please try again.", updated.error);
  return { reopened: true };
}

// Full void, unlike closeWageringForGame: refunds and cancels every not-yet-settled wager on
// the game — including already-accepted/house wagers that would otherwise ride to a normal
// settlement — for when the game itself won't produce a real result (Fair Sim, Force Win,
// or otherwise voided) and no wager on it should have a winner or loser.
export async function cancelAllWagersForGame(input: { guildId: string; gameId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const game = await supabase.from("rec_games").select("id").eq("id", input.gameId).eq("league_id", context.leagueId).maybeSingle();
  if (game.error) throw new ApiError(500, "We couldn't load that game. Please try again.", game.error);
  if (!game.data) throw new ApiError(404, "Scheduled game not found.");
  const openWagers = await supabase.from("rec_wagers").select("*").eq("league_id", context.leagueId).eq("game_id", input.gameId).in("status", ["awaiting_accept", "pending", "confirmed"]);
  if (openWagers.error) throw new ApiError(500, "We couldn't load the wagers to cancel. Please try again.", openWagers.error);
  for (const wager of openWagers.data ?? []) await refundWagerStake(wager, "Wager cancelled — game voided");
  if (openWagers.data?.length) {
    await supabase.from("rec_wagers").update({ status: "refunded", settled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in("id", openWagers.data.map((wager) => wager.id));
  }
  return { cancelled: true, refundedCount: openWagers.data?.length ?? 0 };
}

// Commissioner-facing browse of every not-yet-settled wager league-wide (peer and
// house, any week) so League Mgmt can cancel/refund a specific one on request —
// distinct from listPeerWagerBoard (current-week peer only, player-facing).
export async function listOpenWagersForCommissioner(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;

  const { data, error } = await supabase
    .from("rec_wagers")
    .select(
      "id,game_id,wager_kind,challenge_type,market,pick,line,odds,stake,potential_payout,status,season_number,week_number,placed_by_user_id,placed_by_discord_id,accepted_by_user_id,accepted_by_discord_id,created_at",
    )
    .eq("league_id", leagueId)
    .in("status", ["awaiting_accept", "pending", "confirmed"])
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "We couldn't load the open wagers. Please try again.", error);
  const rows = data ?? [];

  const gameIds = [...new Set(rows.map((w: any) => w.game_id).filter(Boolean))];
  const games = gameIds.length
    ? await supabase
        .from("rec_games")
        .select(
          "id,home_team_id,away_team_id,home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation,display_abbr)",
        )
        .in("id", gameIds)
    : { data: [] };
  const gameById = new Map<string, any>((games.data ?? []).map((g: any) => [g.id, g]));
  const gameLabelById = new Map(
    (games.data ?? []).map((g: any) => [g.id, `${teamAbbr(g.away_team)} at ${teamAbbr(g.home_team)}`]),
  );

  const userIds = [
    ...new Set(rows.flatMap((w: any) => [w.placed_by_user_id, w.accepted_by_user_id]).filter(Boolean)),
  ];
  const users = userIds.length
    ? await supabase.from("rec_users").select("id,username,display_name").in("id", userIds)
    : { data: [] };
  const nameByUserId = new Map(
    (users.data ?? []).map((u: any) => [u.id, u.display_name ?? u.username ?? "REC Member"]),
  );

  return {
    wagers: rows.map((w: any) => ({
      id: w.id,
      gameId: w.game_id,
      gameLabel: w.game_id ? (gameLabelById.get(w.game_id) ?? "Scheduled game") : "House line",
      wagerKind: w.wager_kind,
      challengeType: w.challenge_type,
      market: w.market,
      marketLabel: WAGER_MARKET_BY_KEY.get(w.market)?.label ?? w.market,
      pick: w.pick,
      pickLabel: pickLabelFor(w, gameById),
      line: w.line,
      odds: w.odds,
      stake: Number(w.stake ?? 0),
      potentialPayout: Number(w.potential_payout ?? 0),
      status: w.status,
      seasonNumber: w.season_number,
      weekNumber: w.week_number,
      placedByName: nameByUserId.get(w.placed_by_user_id) ?? "REC Member",
      acceptedByName: w.accepted_by_user_id ? (nameByUserId.get(w.accepted_by_user_id) ?? "REC Member") : null,
      createdAt: w.created_at,
    })),
  };
}

// Commissioner cancel/refund of a single open wager (peer or house), from League Mgmt.
// Unlike cancelWager (bot-internal, deletes the row), this keeps the row for the
// audit trail — same pattern as cancelAllWagersForGame.
export async function commissionerCancelWager(input: { guildId: string; wagerId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const { data: wager, error } = await supabase
    .from("rec_wagers")
    .select("*")
    .eq("id", input.wagerId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (error) throw new ApiError(500, "We couldn't load that wager. Please try again.", error);
  if (!wager) throw new ApiError(404, "Wager not found.");
  if (!["pending", "confirmed", "awaiting_accept"].includes(wager.status)) {
    throw new ApiError(409, "This wager is no longer open — it has already been settled or cancelled.");
  }
  await refundWagerStake(wager, "Wager cancelled by commissioner — refund");
  await supabase
    .from("rec_wagers")
    .update({ status: "refunded", settled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", wager.id);
  return { ok: true, refunded: Number(wager.stake ?? 0) };
}

async function refundWagerStake(wager: any, description: string) {
  const refund = await supabase.rpc("add_to_wallet", {
    p_user_id: wager.placed_by_user_id,
    p_amount: Number(wager.stake ?? 0),
    p_league_id: wager.league_id,
    p_description: description,
    p_transaction_type: "wager_refund",
    p_source: "wager",
    p_source_reference: { wagerId: wager.id, refund: true },
  });
  if (refund.error) throw new ApiError(500, "We couldn't refund that wager stake. Please try again.", refund.error);
  // Refund any accepted peer counterparty's stake too.
  if (wager.accepted_by_user_id) {
    await supabase.rpc("add_to_wallet", {
      p_user_id: wager.accepted_by_user_id,
      p_amount: Number(wager.stake ?? 0),
      p_league_id: wager.league_id,
      p_description: description,
      p_transaction_type: "wager_refund",
      p_source: "wager",
      p_source_reference: { wagerId: wager.id, refund: true, counterparty: true },
    }).throwOnError();
  }
}

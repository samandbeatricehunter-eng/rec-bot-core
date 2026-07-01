// House wager placement. Validates eligibility (economy on, game this week, not the
// bettor's own game, market allowed for the game's data tier, weekly CPU-game cap,
// funds), escrows the stake out of the wallet into holding, and stores a pending
// wager whose payout the commissioner approves once the result is confirmed.

import { canonicalConferenceName, WAGER_MARKET_BY_KEY, parlayOdds, potentialPayout } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { getGameWagerOptions } from "./odds.service.js";

function teamAbbr(team?: { display_abbr?: string | null; abbreviation?: string | null; name?: string | null } | null): string {
  if (!team) return "TBD";
  return (team.display_abbr ?? "").trim() || (team.abbreviation ?? "").trim() || (team.name ?? "").trim() || "TBD";
}

const CUSTOM_SPREAD_MIN = -10;
const CUSTOM_SPREAD_MAX = 10;

// A custom spread applies directly to the bettor's chosen side (no sign flip — the
// number they enter is their line), clamped to the house's allowed range. Odds stay
// the standard spread price; only the line moves.
function resolveCustomLine(kind: string, offeredLine: number | null, customLine: number | null | undefined): number | null {
  if (customLine == null) return offeredLine;
  if (kind !== "spread") throw new ApiError(400, "Custom lines are only available on spread wagers.");
  if (!Number.isFinite(customLine) || customLine < CUSTOM_SPREAD_MIN || customLine > CUSTOM_SPREAD_MAX) {
    throw new ApiError(400, `Custom spread must be between ${CUSTOM_SPREAD_MIN} and +${CUSTOM_SPREAD_MAX}.`);
  }
  return Math.round(customLine * 2) / 2; // nearest half-point
}

async function userIdFromDiscord(discordId: string): Promise<string> {
  const { data, error } = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load Discord account.", error);
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

// Games for the current week the bettor may wager on (their own game excluded).
export async function listWagerableGames(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const userId = await userIdFromDiscord(discordId);
  const myTeamId = await activeTeamId(leagueId, userId);

  const { data: games, error } = await supabase
    .from("rec_games")
    .select("id,week_number,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation,display_abbr)")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .order("external_game_id", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load games for wagering.", error);

  // Active assignments → which team slots are human-controlled this week.
  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  const humanTeams = new Set((assignments ?? []).map((a) => a.team_id).filter(Boolean));

  const out = (games ?? [])
    .filter((g: any) => g.home_team_id !== myTeamId && g.away_team_id !== myTeamId)
    .map((g: any) => {
      const humanInvolved =
        Boolean(g.home_user_id) || Boolean(g.away_user_id) || humanTeams.has(g.home_team_id) || humanTeams.has(g.away_team_id);
      return {
        gameId: g.id,
        weekNumber: g.week_number,
        awayLabel: teamAbbr(g.away_team),
        homeLabel: teamAbbr(g.home_team),
        humanInvolved,
      };
    });

  return { seasonNumber, weekNumber, games: out };
}

export type PlaceHouseWagerInput = {
  guildId: string;
  discordId: string;
  gameId: string;
  market: string;
  pick: string;
  stake: number;
  customLine?: number | null;
};

export async function placeHouseWager(input: PlaceHouseWagerInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const userId = await userIdFromDiscord(input.discordId);

  // Economy gate.
  const { data: cfg } = await supabase
    .from("rec_league_configuration")
    .select("coin_economy_enabled")
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!cfg?.coin_economy_enabled) throw new ApiError(400, "The coin economy is not enabled for this league.");

  const stake = Math.floor(Number(input.stake));
  if (!Number.isFinite(stake) || stake <= 0) throw new ApiError(400, "Enter a positive whole-dollar stake.");

  const marketDef = WAGER_MARKET_BY_KEY.get(input.market);
  if (!marketDef) throw new ApiError(400, "Unknown wager market.");

  // Game must be this week and not the bettor's own game.
  const { data: game, error: gameErr } = await supabase
    .from("rec_games")
    .select("id,week_number,home_team_id,away_team_id,home_user_id,away_user_id")
    .eq("league_id", leagueId)
    .eq("id", input.gameId)
    .maybeSingle();
  if (gameErr) throw new ApiError(500, "Failed to load the game.", gameErr);
  if (!game) throw new ApiError(404, "That game isn't on the schedule.");
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
  line = resolveCustomLine(marketDef.kind, line, input.customLine);

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
  if (balance < stake) throw new ApiError(400, `Insufficient funds. This stakes $${stake} and you have $${balance}.`);

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
    throw new ApiError(500, "Failed to place wager.", insert.error);
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
    throw new ApiError(500, "Failed to hold wager funds.", hold.error);
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
    pendingPayoutsChannelId: (context.routes as any)?.pending_payouts_channel_id ?? null,
  };
}

// Shared placement validation + line/odds resolution for house and peer wagers.
async function prepareSingleWager(guildId: string, userId: string, leagueId: string, weekNumber: number, gameId: string, market: string, pick: string, stake: number, customLine?: number | null) {
  if (!Number.isFinite(stake) || stake <= 0) throw new ApiError(400, "Enter a positive whole-dollar stake.");
  const marketDef = WAGER_MARKET_BY_KEY.get(market);
  if (!marketDef) throw new ApiError(400, "Unknown wager market.");

  const { data: game, error: gameErr } = await supabase
    .from("rec_games")
    .select("id,week_number,home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("id", gameId)
    .maybeSingle();
  if (gameErr) throw new ApiError(500, "Failed to load the game.", gameErr);
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
  line = resolveCustomLine(marketDef.kind, line, customLine);

  const balance = await walletBalance(userId);
  if (balance < stake) throw new ApiError(400, `Insufficient funds. This stakes $${stake} and you have $${balance}.`);
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
  customLine?: number | null;
};

// Propose a peer wager: escrow the proposer's stake and leave it awaiting an opponent
// who takes the opposite side. Even-money pot — winner takes 2× the stake.
export async function placePeerWager(input: PlacePeerWagerInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const userId = await userIdFromDiscord(input.discordId);

  const { data: cfg } = await supabase.from("rec_league_configuration").select("coin_economy_enabled").eq("league_id", leagueId).maybeSingle();
  if (!cfg?.coin_economy_enabled) throw new ApiError(400, "The coin economy is not enabled for this league.");

  const stake = Math.floor(Number(input.stake));
  const prep = await prepareSingleWager(input.guildId, userId, leagueId, weekNumber, input.gameId, input.market, input.pick, stake, input.customLine);

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
    throw new ApiError(500, "Failed to propose wager.", insert.error);
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
    throw new ApiError(500, "Failed to hold wager funds.", hold.error);
  }
  await supabase.from("rec_wagers").update({ hold_ledger_id: hold.data }).eq("id", insert.data.id);

  return {
    wager: { ...insert.data, hold_ledger_id: hold.data },
    proposerPickLabel: prep.side.label,
    marketLabel: prep.marketDef.label,
    gameLabel: `${prep.options.awayLabel} at ${prep.options.homeLabel}`,
    stake,
    payout,
    walletBalance: prep.balance - stake,
    announcementsChannelId: (context.routes as any)?.announcements_channel_id ?? null,
    pendingPayoutsChannelId: (context.routes as any)?.pending_payouts_channel_id ?? null,
  };
}

// A user takes the opposite side of an open/direct peer wager.
export async function acceptPeerWager(input: { guildId: string; discordId: string; wagerId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const accepterId = await userIdFromDiscord(input.discordId);

  const { data: wager, error } = await supabase.from("rec_wagers").select("*").eq("id", input.wagerId).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load wager.", error);
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
  const balance = await walletBalance(accepterId);
  if (balance < stake) throw new ApiError(400, `Insufficient funds. This wager stakes $${stake} and you have $${balance}.`);

  const hold = await supabase.rpc("add_to_wallet", {
    p_user_id: accepterId,
    p_amount: -stake,
    p_league_id: leagueId,
    p_description: `Peer wager hold — ${wager.market}`,
    p_transaction_type: "wager_hold",
    p_source: "wager",
    p_source_reference: { wagerId: wager.id, accepter: true },
  });
  if (hold.error) throw new ApiError(500, "Failed to hold wager funds.", hold.error);

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

  return {
    wager: updated.data,
    pendingPayoutsChannelId: (context.routes as any)?.pending_payouts_channel_id ?? null,
  };
}

// Load an open peer wager's game options so a counter-er can pick new terms.
export async function getPeerWagerForCounter(guildId: string, wagerId: string) {
  const { data: wager } = await supabase.from("rec_wagers").select("*").eq("id", wagerId).maybeSingle();
  if (!wager || wager.status !== "awaiting_accept") throw new ApiError(409, "This wager is no longer open.");
  if (!wager.game_id) throw new ApiError(400, "This wager has no game to counter.");
  const options = await getGameWagerOptions(guildId, wager.game_id);
  return {
    originalWagerId: wager.id,
    proposerUserId: wager.placed_by_user_id,
    proposerDiscordId: wager.placed_by_discord_id,
    proposerStake: Number(wager.stake ?? 0),
    gameId: wager.game_id,
    options,
  };
}

export type PlaceCounterInput = { guildId: string; discordId: string; originalWagerId: string; market: string; pick: string; stake: number; customLine?: number | null };

// A counter-offer: the counter-er escrows their stake and proposes new terms to the
// original poster (delivered via DM). It's its own awaiting_accept wager linked back
// to the original.
export async function placeCounterWager(input: PlaceCounterInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const counterUserId = await userIdFromDiscord(input.discordId);

  const { data: original } = await supabase.from("rec_wagers").select("*").eq("id", input.originalWagerId).maybeSingle();
  if (!original || original.status !== "awaiting_accept") throw new ApiError(409, "That wager is no longer open to counter.");
  if (original.placed_by_user_id === counterUserId) throw new ApiError(400, "You can't counter your own wager.");

  const stake = Math.floor(Number(input.stake));
  const prep = await prepareSingleWager(input.guildId, counterUserId, leagueId, weekNumber, original.game_id, input.market, input.pick, stake, input.customLine);

  const insert = await supabase
    .from("rec_wagers")
    .insert({
      league_id: leagueId, season_number: seasonNumber, week_number: weekNumber,
      game_id: original.game_id, placed_by_user_id: counterUserId, placed_by_discord_id: input.discordId,
      wager_kind: "peer", challenge_type: "counter", counterparty_user_id: original.placed_by_user_id,
      countered_from_wager_id: original.id,
      market: input.market, pick: input.pick, line: prep.line, odds: 2,
      stake, potential_payout: stake * 2, status: "awaiting_accept",
    })
    .select("*")
    .single();
  if (insert.error) throw new ApiError(500, "Failed to create counter.", insert.error);

  const hold = await supabase.rpc("add_to_wallet", {
    p_user_id: counterUserId, p_amount: -stake, p_league_id: leagueId,
    p_description: `Peer counter hold — ${prep.marketDef.label}`, p_transaction_type: "wager_hold", p_source: "wager",
    p_source_reference: { wagerId: insert.data.id },
  });
  if (hold.error) {
    await supabase.from("rec_wagers").delete().eq("id", insert.data.id);
    throw new ApiError(500, "Failed to hold counter funds.", hold.error);
  }
  await supabase.from("rec_wagers").update({ hold_ledger_id: hold.data }).eq("id", insert.data.id);

  return {
    counterWager: insert.data,
    proposerDiscordId: original.placed_by_discord_id,
    counterPickLabel: prep.side.label,
    marketLabel: prep.marketDef.label,
    gameLabel: `${prep.options.awayLabel} at ${prep.options.homeLabel}`,
    stake,
    payout: stake * 2,
  };
}

// The original poster accepts a counter: refund their original hold, escrow the
// counter stake, lock the counter as the live wager, and close the original.
export async function acceptCounter(input: { guildId: string; discordId: string; counterWagerId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const proposerUserId = await userIdFromDiscord(input.discordId);

  const { data: counter } = await supabase.from("rec_wagers").select("*").eq("id", input.counterWagerId).maybeSingle();
  if (!counter || counter.status !== "awaiting_accept") throw new ApiError(409, "This counter is no longer pending.");
  if (counter.counterparty_user_id !== proposerUserId) throw new ApiError(403, "Only the original poster can accept this counter.");

  const { data: original } = counter.countered_from_wager_id
    ? await supabase.from("rec_wagers").select("*").eq("id", counter.countered_from_wager_id).maybeSingle()
    : { data: null };

  const counterStake = Number(counter.stake ?? 0);
  const originalStake = Number(original?.stake ?? 0);
  const balance = await walletBalance(proposerUserId);
  if (balance + originalStake < counterStake) {
    throw new ApiError(400, `You need $${counterStake} to take this counter and only have $${balance + originalStake} available.`);
  }

  // Refund + close the original offer.
  let originalAnnouncement: { channelId: string | null; messageId: string | null } = { channelId: null, messageId: null };
  if (original && ["awaiting_accept"].includes(original.status)) {
    await refundWagerStake(original, "Original offer closed — counter accepted");
    originalAnnouncement = { channelId: original.announcement_channel_id, messageId: original.announcement_message_id };
    await supabase.from("rec_wagers").delete().eq("id", original.id);
  }

  // Escrow the proposer's counter stake and lock the counter.
  const hold = await supabase.rpc("add_to_wallet", {
    p_user_id: proposerUserId, p_amount: -counterStake, p_league_id: leagueId,
    p_description: `Peer counter accepted — ${counter.market}`, p_transaction_type: "wager_hold", p_source: "wager",
    p_source_reference: { wagerId: counter.id, accepter: true },
  });
  if (hold.error) throw new ApiError(500, "Failed to hold counter funds.", hold.error);

  const updated = await supabase
    .from("rec_wagers")
    .update({ accepted_by_user_id: proposerUserId, accepted_by_discord_id: input.discordId, status: "pending", updated_at: new Date().toISOString() })
    .eq("id", counter.id)
    .eq("status", "awaiting_accept")
    .select("*")
    .single();
  if (updated.error) {
    await supabase.rpc("add_to_wallet", { p_user_id: proposerUserId, p_amount: counterStake, p_league_id: leagueId, p_description: "Counter hold reversed", p_transaction_type: "wager_refund", p_source: "wager", p_source_reference: { wagerId: counter.id } });
    throw new ApiError(409, "This counter was already resolved.");
  }

  return {
    wager: updated.data,
    originalAnnouncementChannelId: originalAnnouncement.channelId,
    originalAnnouncementMessageId: originalAnnouncement.messageId,
    pendingPayoutsChannelId: (context.routes as any)?.pending_payouts_channel_id ?? null,
  };
}

export async function declineCounter(input: { discordId: string; counterWagerId: string }) {
  const { data: counter } = await supabase.from("rec_wagers").select("*").eq("id", input.counterWagerId).maybeSingle();
  if (!counter || counter.status !== "awaiting_accept") return { ok: false };
  // Only the original poster (the counter's counterparty) may deny it.
  const decliner = await userIdFromDiscord(input.discordId).catch(() => null);
  if (counter.counterparty_user_id && decliner && counter.counterparty_user_id !== decliner) {
    throw new ApiError(403, "Only the original poster can respond to this counter.");
  }
  await refundWagerStake(counter, "Counter declined — refund");
  await supabase.from("rec_wagers").delete().eq("id", counter.id);
  return { ok: true, counterByDiscordId: counter.placed_by_discord_id };
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
  const me = await userIdFromDiscord(discordId).catch(() => null);
  const { data } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,rec_teams(name,abbreviation,display_abbr,conference,division),rec_users(rec_discord_accounts(discord_id))")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  const coaches = (data ?? [])
    .filter((a: any) => a.user_id && a.user_id !== me)
    .map((a: any) => {
      const acc = a.rec_users?.rec_discord_accounts;
      const discord = Array.isArray(acc) ? acc[0]?.discord_id : acc?.discord_id;
      const team = a.rec_teams;
      return {
        userId: a.user_id,
        discordId: discord ?? null,
        teamAbbr: teamAbbr(team),
        conference: canonicalConferenceName(team?.conference, team?.division),
      };
    });
  return { coaches };
}

export async function attachWagerAnnouncementMessage(input: { wagerId: string; channelId: string; messageId: string }) {
  const { error } = await supabase
    .from("rec_wagers")
    .update({ announcement_channel_id: input.channelId, announcement_message_id: input.messageId, updated_at: new Date().toISOString() })
    .eq("id", input.wagerId);
  if (error) throw new ApiError(500, "Failed to store wager announcement message.", error);
  return { ok: true };
}

export type PlaceParlayInput = {
  guildId: string;
  discordId: string;
  legs: Array<{ gameId: string; market: string; pick: string; customLine?: number | null }>;
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

  const { data: cfg } = await supabase.from("rec_league_configuration").select("coin_economy_enabled").eq("league_id", leagueId).maybeSingle();
  if (!cfg?.coin_economy_enabled) throw new ApiError(400, "The coin economy is not enabled for this league.");

  if (!Array.isArray(input.legs) || input.legs.length < 2 || input.legs.length > 3) throw new ApiError(400, "A parlay needs 2 or 3 picks.");
  const gameMarketSeen = new Set<string>();
  for (const leg of input.legs) {
    const key = `${leg.gameId}:${leg.market}`;
    if (gameMarketSeen.has(key)) throw new ApiError(400, "Each parlay leg must be a different game+market.");
    gameMarketSeen.add(key);
  }

  const stake = Math.floor(Number(input.stake));
  if (!Number.isFinite(stake) || stake <= 0) throw new ApiError(400, "Enter a positive whole-dollar stake.");
  const balance = await walletBalance(userId);
  if (balance < stake) throw new ApiError(400, `Insufficient funds. This stakes $${stake} and you have $${balance}.`);

  const prepared = [];
  for (const leg of input.legs) {
    const prep = await prepareSingleWager(input.guildId, userId, leagueId, weekNumber, leg.gameId, leg.market, leg.pick, stake, leg.customLine);
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
  if (insert.error) throw new ApiError(500, "Failed to place parlay.", insert.error);

  const legRows = prepared.map((l) => ({ wager_id: insert.data.id, game_id: l.gameId, market: l.market, pick: l.pick, line: l.line, odds: l.odds }));
  const legInsert = await supabase.from("rec_wager_legs").insert(legRows);
  if (legInsert.error) {
    await supabase.from("rec_wagers").delete().eq("id", insert.data.id);
    throw new ApiError(500, "Failed to save parlay legs.", legInsert.error);
  }

  const hold = await supabase.rpc("add_to_wallet", {
    p_user_id: userId, p_amount: -stake, p_league_id: leagueId,
    p_description: `Parlay hold (${input.legs.length}-pick)`, p_transaction_type: "wager_hold", p_source: "wager",
    p_source_reference: { wagerId: insert.data.id },
  });
  if (hold.error) {
    await supabase.from("rec_wagers").delete().eq("id", insert.data.id);
    throw new ApiError(500, "Failed to hold parlay funds.", hold.error);
  }
  await supabase.from("rec_wagers").update({ hold_ledger_id: hold.data }).eq("id", insert.data.id);

  return {
    wager: { ...insert.data, hold_ledger_id: hold.data },
    legs: prepared.map((l) => l.label),
    combinedOdds, stake, payout,
    walletBalance: balance - stake,
    pendingPayoutsChannelId: (context.routes as any)?.pending_payouts_channel_id ?? null,
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
    await supabase.from("rec_wager_legs").update({ leg_result: outcome }).eq("id", leg.id);
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
  if (error) throw new ApiError(500, "Failed to store wager pending message.", error);
  return { ok: true };
}

// ─── Result resolution ──────────────────────────────────────────────────────────

type GameResult = { home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null; winning_team_id: string | null; is_tie: boolean | null };

async function loadGameResult(leagueId: string, gameId: string): Promise<GameResult | null> {
  const { data } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,winning_team_id,is_tie")
    .eq("league_id", leagueId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (data && data.home_score != null && data.away_score != null) return data as GameResult;
  // Some results are keyed without game_id; fall back to a team-pair lookup.
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
    actual = homeScore + awayScore;
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

export async function getWagerResolvability(leagueId: string, wagerId: string) {
  const { data: wager } = await supabase.from("rec_wagers").select("*").eq("id", wagerId).maybeSingle();
  if (!wager) return { resolvable: false, outcome: null as null };
  const outcome = await resolveOutcome(leagueId, wager);
  return { resolvable: outcome != null, outcome, wager };
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
    const credit = await supabase.rpc("add_to_wallet", {
      p_user_id: winnerUserId,
      p_amount: amount,
      p_league_id: wager.league_id,
      p_description: `Wager payout — ${wager.market}`,
      p_transaction_type: "wager_payout",
      p_source: "wager",
      p_source_reference: { wagerId: wager.id, outcome },
    });
    if (credit.error) throw new ApiError(500, "Failed to credit wager payout.", credit.error);
    payoutLedgerId = credit.data;
    credited = amount;
  } else if (isPeer) {
    // Peer loss for the proposer means the accepter won the pot.
    const amount = Number(wager.stake ?? 0) * 2;
    const credit = await supabase.rpc("add_to_wallet", {
      p_user_id: wager.accepted_by_user_id,
      p_amount: amount,
      p_league_id: wager.league_id,
      p_description: `Wager payout — ${wager.market}`,
      p_transaction_type: "wager_payout",
      p_source: "wager",
      p_source_reference: { wagerId: wager.id, outcome: "won-by-accepter" },
    });
    if (credit.error) throw new ApiError(500, "Failed to credit peer wager payout.", credit.error);
    payoutLedgerId = credit.data;
    credited = amount;
  }

  await supabase
    .from("rec_wagers")
    .update({ status: outcome, settled_at: now, payout_ledger_id: payoutLedgerId, updated_at: now })
    .eq("id", wager.id);
  return credited;
}

// Approve a wager payout — only succeeds once the game result is confirmed.
export async function settleWager(input: { wagerId: string; reviewedByDiscordId: string }) {
  const { data: wager, error } = await supabase.from("rec_wagers").select("*").eq("id", input.wagerId).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load wager.", error);
  if (!wager) throw new ApiError(404, "Wager not found.");
  if (!["pending", "confirmed"].includes(wager.status)) {
    return { ok: false, alreadyResolved: true, status: wager.status, wager };
  }

  if (wager.is_parlay) {
    const r = await resolveParlay(wager.league_id, wager.id, Number(wager.stake ?? 0));
    if (!r) return { ok: false, notConfirmed: true, wager };
    let credited = 0;
    if (r.payout > 0) {
      const credit = await supabase.rpc("add_to_wallet", {
        p_user_id: wager.placed_by_user_id,
        p_amount: r.payout,
        p_league_id: wager.league_id,
        p_description: r.outcome === "won" ? "Parlay payout (3-pick)" : "Parlay push refund",
        p_transaction_type: r.outcome === "won" ? "wager_payout" : "wager_refund",
        p_source: "wager",
        p_source_reference: { wagerId: wager.id, outcome: r.outcome, parlay: true },
      });
      if (credit.error) throw new ApiError(500, "Failed to credit parlay payout.", credit.error);
      credited = r.payout;
    }
    await supabase.from("rec_wagers").update({ status: r.outcome, settled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", wager.id);
    return { ok: true, outcome: r.outcome, credited, wager: { ...wager, status: r.outcome } };
  }

  const outcome = await resolveOutcome(wager.league_id, wager);
  if (!outcome) {
    return { ok: false, notConfirmed: true, wager };
  }

  const credited = await creditAndCloseWager(wager, outcome);
  return { ok: true, outcome, credited, wager: { ...wager, status: outcome } };
}

// Pending wagers whose game result is now available — used to refresh their
// pending-payout embeds to the "confirmed" state after a result is logged.
export async function listConfirmableWagers(leagueId: string) {
  const { data } = await supabase
    .from("rec_wagers")
    .select("id,pending_channel_id,pending_message_id,game_id,market,pick,line,wager_kind,is_parlay,stake")
    .eq("league_id", leagueId)
    .eq("status", "pending")
    .not("pending_message_id", "is", null);
  const wagers: Array<{ id: string; channelId: string; messageId: string }> = [];
  for (const w of data ?? []) {
    const resolvable = w.is_parlay
      ? (await resolveParlay(leagueId, w.id, Number(w.stake ?? 0))) != null
      : (await resolveOutcome(leagueId, w)) != null;
    if (resolvable && w.pending_channel_id && w.pending_message_id) {
      wagers.push({ id: w.id, channelId: w.pending_channel_id, messageId: w.pending_message_id });
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

// On advance, refund + close any open wager whose game has no logged result (and any
// peer challenge that was never accepted). Resolved-but-unapproved wagers are left
// for the commissioner to approve. Returns Discord message coords for cleanup.
export async function resolveWagersOnAdvance(leagueId: string, seasonNumber: number, weekNumber: number) {
  const { data } = await supabase
    .from("rec_wagers")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .in("status", ["awaiting_accept", "pending", "confirmed"]);

  const now = new Date().toISOString();
  const refundedMessages: Array<{ pendingChannelId: string | null; pendingMessageId: string | null; announcementChannelId: string | null; announcementMessageId: string | null }> = [];

  for (const w of data ?? []) {
    if (w.status === "awaiting_accept") {
      await refundWagerStake(w, "Wager expired — no opponent took it before advance");
      await supabase.from("rec_wagers").update({ status: "refunded", settled_at: now, updated_at: now }).eq("id", w.id);
      refundedMessages.push({ pendingChannelId: w.pending_channel_id, pendingMessageId: w.pending_message_id, announcementChannelId: w.announcement_channel_id, announcementMessageId: w.announcement_message_id });
      continue;
    }
    const resolvable = w.is_parlay
      ? (await resolveParlay(leagueId, w.id, Number(w.stake ?? 0))) != null
      : (await resolveOutcome(leagueId, w)) != null;
    if (!resolvable) {
      await refundWagerStake(w, "Wager refunded — results not logged before advance");
      await supabase.from("rec_wagers").update({ status: "refunded", settled_at: now, updated_at: now }).eq("id", w.id);
      refundedMessages.push({ pendingChannelId: w.pending_channel_id, pendingMessageId: w.pending_message_id, announcementChannelId: w.announcement_channel_id, announcementMessageId: w.announcement_message_id });
    }
  }
  return { refundedCount: refundedMessages.length, refundedMessages };
}

// Cancel a pending wager: refund the held stake and remove the wager.
export async function cancelWager(input: { wagerId: string }) {
  const { data: wager, error } = await supabase.from("rec_wagers").select("*").eq("id", input.wagerId).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load wager.", error);
  if (!wager) throw new ApiError(404, "Wager not found.");
  if (!["pending", "confirmed", "awaiting_accept"].includes(wager.status)) {
    return { ok: false, status: wager.status };
  }
  await refundWagerStake(wager, "Wager cancelled — refund");
  await supabase.from("rec_wagers").delete().eq("id", wager.id);
  return { ok: true, refunded: Number(wager.stake ?? 0), pendingChannelId: wager.pending_channel_id, pendingMessageId: wager.pending_message_id };
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
  if (refund.error) throw new ApiError(500, "Failed to refund wager stake.", refund.error);
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

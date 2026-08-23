import {
  WAGER_MARKET_BY_KEY,
  formatCoins,
  formatTournamentPlayerName,
  parlayOdds,
  potentialPayout,
} from "@rec/shared";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getGlobalEconomyConfig } from "../economy/global-economy-config.service.js";
import {
  buildTournamentMatchWagerOptions,
  parseTournamentBoxScore,
  resolveTournamentMarket,
  type TournamentBoxScore,
  type TournamentMatchWagerOptions,
} from "./tournaments-odds.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MatchRow = {
  id: string;
  tournament_id: string;
  player_a_user_id: string | null;
  player_b_user_id: string | null;
  winner_user_id: string | null;
  status: string;
  betting_open: boolean;
  player_a_score: number | null;
  player_b_score: number | null;
  box_score: unknown;
};

async function debitWallet(userId: string, amount: number, description: string, extra: Record<string, unknown>) {
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: userId,
    p_amount: -amount,
    p_league_id: null,
    p_description: description,
    p_transaction_type: "tournament_wager",
    p_source: "site_tournament",
    p_source_reference: extra,
    p_allow_negative: false,
  });
  if (ledger.error) throw new ApiError(400, ledger.error.message || "Could not hold that wager stake.");
}

async function creditWallet(userId: string, amount: number, description: string, extra: Record<string, unknown>) {
  if (amount <= 0) return;
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: userId,
    p_amount: amount,
    p_league_id: null,
    p_description: description,
    p_transaction_type: "tournament_wager",
    p_source: "site_tournament",
    p_source_reference: extra,
    p_allow_negative: false,
  });
  if (ledger.error) throw new ApiError(500, "Failed to settle the wager.", ledger.error);
}

async function loadMatch(tournamentId: string, matchId: string): Promise<MatchRow> {
  const result = await getPgPool().query(
    `select * from rec_site_tournament_matches where id = $1 and tournament_id = $2`,
    [matchId, tournamentId],
  );
  const match = result.rows[0] as MatchRow | undefined;
  if (!match) throw new ApiError(404, "Match not found.");
  return match;
}

async function wagerCaps() {
  const { houseWeeklyMaximum, peerWeeklyMaximum } = (await getGlobalEconomyConfig()).wagers;
  return { house: houseWeeklyMaximum, peer: peerWeeklyMaximum };
}

async function assertTournamentCap(input: {
  tournamentId: string;
  recUserId: string;
  kind: "house" | "peer";
  stake: number;
}) {
  const caps = await wagerCaps();
  const maximum = input.kind === "house" ? caps.house : caps.peer;
  const result = await getPgPool().query(
    `
      select coalesce(sum(stake), 0)::int as n
      from rec_site_tournament_wagers
      where tournament_id = $1
        and wager_kind = $2
        and status in ('open', 'accepted')
        and (user_id = $3 or accepted_by_user_id = $3)
    `,
    [input.tournamentId, input.kind, input.recUserId],
  );
  const active = Number(result.rows[0]?.n ?? 0);
  if (active + input.stake > maximum) {
    throw new ApiError(
      400,
      `${input.kind === "house" ? "House" : "Peer"} wagers are capped at ${formatCoins(maximum)} per tournament. You already have ${formatCoins(active)} active.`,
    );
  }
}

function pickUserIdFrom(pick: string): string | null {
  return UUID_RE.test(pick) ? pick : null;
}

async function playerMap(userIds: Array<string | null>) {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)))];
  if (!ids.length) return new Map<string, string>();
  const result = await getPgPool().query(
    `select id, username, display_name from rec_users where id = any($1::uuid[])`,
    [ids],
  );
  return new Map(result.rows.map((row) => [
    String(row.id),
    formatTournamentPlayerName(row.username, row.display_name, null),
  ]));
}

async function matchLabels(match: MatchRow) {
  const names = await playerMap([match.player_a_user_id, match.player_b_user_id]);
  const teams = await getPgPool().query(
    `
      select user_id, team_name, team_abbr
      from rec_site_tournament_entrants
      where tournament_id = $1 and user_id = any($2::uuid[])
    `,
    [match.tournament_id, [match.player_a_user_id, match.player_b_user_id].filter(Boolean)],
  );
  const teamByUser = new Map(teams.rows.map((row) => [String(row.user_id), row.team_name || row.team_abbr]));
  const labelFor = (userId: string | null) => {
    if (!userId) return "TBD";
    const team = teamByUser.get(userId);
    const name = names.get(userId) ?? "Player";
    return team ? `${team} · ${name}` : name;
  };
  return {
    homeLabel: labelFor(match.player_a_user_id),
    awayLabel: labelFor(match.player_b_user_id),
  };
}

async function loadRecords(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) {
    return new Map<string, { wins: number; losses: number; pointDifferential: number; pointsFor: number; gamesPlayed: number }>();
  }
  const result = await getPgPool().query(
    `
      select user_id, wins, losses, point_differential, points_for, games_played
      from rec_global_user_records
      where user_id = any($1::uuid[])
    `,
    [ids],
  );
  return new Map(result.rows.map((row) => [String(row.user_id), {
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    pointDifferential: Number(row.point_differential ?? 0),
    pointsFor: Number(row.points_for ?? 0),
    gamesPlayed: Number(row.games_played ?? 0),
  }]));
}

function assertOpenMatch(match: MatchRow, recUserId: string) {
  if (match.status === "complete" || match.status === "bye") throw new ApiError(409, "Betting is closed on a finished match.");
  if (match.betting_open === false) throw new ApiError(409, "Betting is closed on this match.");
  if (!match.player_a_user_id || !match.player_b_user_id) throw new ApiError(409, "Both players must be set before betting.");
  if (recUserId === match.player_a_user_id || recUserId === match.player_b_user_id) {
    throw new ApiError(403, "You cannot bet on your own tournament games.");
  }
}

export async function getTournamentMatchWagerOptions(input: {
  tournamentId: string;
  matchId: string;
}): Promise<TournamentMatchWagerOptions> {
  const match = await loadMatch(input.tournamentId, input.matchId);
  if (!match.player_a_user_id || !match.player_b_user_id) {
    throw new ApiError(409, "Both players must be set before betting.");
  }
  const [labels, records] = await Promise.all([
    matchLabels(match),
    loadRecords([match.player_a_user_id, match.player_b_user_id]),
  ]);
  return buildTournamentMatchWagerOptions({
    matchId: match.id,
    homeUserId: match.player_a_user_id,
    awayUserId: match.player_b_user_id,
    homeLabel: labels.homeLabel,
    awayLabel: labels.awayLabel,
    bettingOpen: match.betting_open !== false && match.status !== "complete" && match.status !== "bye",
    homeRecord: records.get(match.player_a_user_id) ?? null,
    awayRecord: records.get(match.player_b_user_id) ?? null,
  });
}

function pickLabel(pick: string, line: number | null, names: Map<string, string>) {
  if (pick === "over") return `Over${line != null ? ` ${line}` : ""}`;
  if (pick === "under") return `Under${line != null ? ` ${line}` : ""}`;
  if (pick === "parlay") return "Parlay";
  return names.get(pick) ?? pick;
}

export async function listTournamentWagers(input: { tournamentId: string; matchId?: string }) {
  const result = await getPgPool().query(
    `
      select w.*,
        u.username as user_username, u.display_name as user_display_name,
        a.username as accepted_username, a.display_name as accepted_display_name
      from rec_site_tournament_wagers w
      inner join rec_users u on u.id = w.user_id
      left join rec_users a on a.id = w.accepted_by_user_id
      where w.tournament_id = $1
        and ($2::uuid is null or w.match_id = $2)
      order by w.created_at desc
    `,
    [input.tournamentId, input.matchId ?? null],
  );
  const names = await playerMap(result.rows.flatMap((row) => [row.user_id, row.accepted_by_user_id, row.pick_user_id, row.pick]));
  const caps = await wagerCaps();
  return {
    wagers: result.rows.map((row) => ({
      id: row.id,
      matchId: row.match_id,
      wagerKind: row.wager_kind === "peer" || row.market === "h2h" ? "peer" : "house",
      market: row.wager_kind === "peer" || row.market === "h2h" ? "peer" : "house",
      marketKey: row.market_key ?? "moneyline",
      pick: row.pick ?? row.pick_user_id,
      pickUserId: row.pick_user_id,
      line: row.line == null ? null : Number(row.line),
      odds: row.odds == null ? null : Number(row.odds),
      stake: Number(row.stake),
      potentialPayout: Number(row.potential_payout ?? 0),
      isParlay: Boolean(row.is_parlay),
      status: row.status,
      userId: row.user_id,
      userDisplayName: formatTournamentPlayerName(row.user_username, row.user_display_name, null),
      pickDisplayName: pickLabel(String(row.pick ?? row.pick_user_id ?? ""), row.line == null ? null : Number(row.line), names),
      acceptedByUserId: row.accepted_by_user_id,
      acceptedDisplayName: row.accepted_by_user_id
        ? formatTournamentPlayerName(row.accepted_username, row.accepted_display_name, null)
        : null,
      payoutAmount: Number(row.payout_amount ?? 0),
    })),
    caps: { house: caps.house, peer: caps.peer, h2h: caps.peer },
  };
}

async function prepareLeg(input: {
  match: MatchRow;
  options: TournamentMatchWagerOptions;
  marketKey: string;
  pick: string;
}) {
  const marketDef = WAGER_MARKET_BY_KEY.get(input.marketKey);
  if (!marketDef) throw new ApiError(400, "Unknown wager market.");
  const marketOption = input.options.markets.find((market) => market.market === input.marketKey);
  if (!marketOption) throw new ApiError(400, "That market isn't available for this match.");
  const side = marketOption.sides.find((item) => item.pick === input.pick);
  if (!side) throw new ApiError(400, "Invalid pick for this market.");
  let line: number | null = marketOption.line;
  if (marketDef.kind === "spread") {
    const isHome = input.pick === input.options.homeUserId;
    line = isHome ? -(marketOption.line ?? 0) : (marketOption.line ?? 0);
  } else if (marketDef.kind === "moneyline") {
    line = null;
  }
  return { marketDef, marketOption, side, line, odds: Number(side.odds) };
}

export async function placeTournamentWager(input: {
  recUserId: string;
  tournamentId: string;
  matchId: string;
  wagerKind: "house" | "peer";
  marketKey: string;
  pick: string;
  stake: number;
  isParlay?: boolean;
  legs?: Array<{ marketKey: string; pick: string }>;
}) {
  const tournament = await getPgPool().query(
    `select event_paused from rec_site_tournaments where id = $1`,
    [input.tournamentId],
  );
  if (!tournament.rows[0]) throw new ApiError(404, "Tournament not found.");
  if (tournament.rows[0].event_paused) throw new ApiError(409, "This tournament is closed.");
  const match = await loadMatch(input.tournamentId, input.matchId);
  assertOpenMatch(match, input.recUserId);
  const stake = Math.trunc(input.stake);
  if (!Number.isFinite(stake) || stake < 10) throw new ApiError(400, "Bets must be at least 10 coins.");
  await assertTournamentCap({
    tournamentId: input.tournamentId,
    recUserId: input.recUserId,
    kind: input.wagerKind,
    stake,
  });
  const options = await getTournamentMatchWagerOptions({ tournamentId: input.tournamentId, matchId: match.id });

  if (input.isParlay || input.marketKey === "parlay") {
    if (input.wagerKind !== "house") throw new ApiError(400, "Parlays are house bets.");
    const legs = input.legs ?? [];
    if (legs.length !== 3) throw new ApiError(400, "3-pick parlays need exactly three selections.");
    const seen = new Set<string>();
    const prepared: Awaited<ReturnType<typeof prepareLeg>>[] = [];
    for (const leg of legs) {
      const definition = WAGER_MARKET_BY_KEY.get(leg.marketKey);
      if (definition?.kind !== "total" || !definition.statKey || definition.statKey === "points") {
        throw new ApiError(400, "3-pick parlays only allow player/team stat-line over-under markets.");
      }
      if (seen.has(leg.marketKey)) throw new ApiError(400, "Each parlay leg must be a different market.");
      seen.add(leg.marketKey);
      prepared.push(await prepareLeg({ match, options, marketKey: leg.marketKey, pick: leg.pick }));
    }
    const combinedOdds = parlayOdds(prepared.map((leg) => leg.odds));
    const payout = potentialPayout(stake, combinedOdds);
    const inserted = await getPgPool().query(
      `
        insert into rec_site_tournament_wagers
          (tournament_id, match_id, user_id, market, wager_kind, market_key, pick, pick_user_id, line, odds, stake, potential_payout, is_parlay, status)
        values ($1, $2, $3, 'house', 'house', 'parlay', 'parlay', null, null, $4, $5, $6, true, 'accepted')
        returning id
      `,
      [input.tournamentId, match.id, input.recUserId, combinedOdds, stake, payout],
    );
    try {
      for (const [index, leg] of legs.entries()) {
        await getPgPool().query(
          `
            insert into rec_site_tournament_wager_legs (wager_id, match_id, market_key, pick, line, odds)
            values ($1, $2, $3, $4, $5, $6)
          `,
          [inserted.rows[0].id, match.id, leg.marketKey, leg.pick, prepared[index].line, prepared[index].odds],
        );
      }
      await debitWallet(input.recUserId, stake, "Tournament 3-pick parlay", {
        wagerId: inserted.rows[0].id,
        matchId: match.id,
      });
    } catch (error) {
      await getPgPool().query(`delete from rec_site_tournament_wagers where id = $1`, [inserted.rows[0].id]);
      throw error;
    }
    return listTournamentWagers({ tournamentId: input.tournamentId, matchId: match.id });
  }

  const prepared = await prepareLeg({ match, options, marketKey: input.marketKey, pick: input.pick });
  const pickUserId = pickUserIdFrom(input.pick);
  const status = input.wagerKind === "house" ? "accepted" : "open";
  const odds = input.wagerKind === "peer" ? 2 : prepared.odds;
  const payout = input.wagerKind === "peer" ? stake * 2 : potentialPayout(stake, odds);
  const existing = await getPgPool().query(
    `
      select id from rec_site_tournament_wagers
      where match_id = $1 and user_id = $2 and market_key = $3 and wager_kind = $4 and status in ('open', 'accepted')
        and coalesce(is_parlay, false) = false
    `,
    [match.id, input.recUserId, input.marketKey, input.wagerKind],
  );
  if (existing.rows[0]) throw new ApiError(409, "You already have this market on this match.");
  const inserted = await getPgPool().query(
    `
      insert into rec_site_tournament_wagers
        (tournament_id, match_id, user_id, market, wager_kind, market_key, pick, pick_user_id, line, odds, stake, potential_payout, is_parlay, status)
      values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)
      returning id
    `,
    [
      input.tournamentId,
      match.id,
      input.recUserId,
      input.wagerKind,
      input.marketKey,
      input.pick,
      pickUserId,
      prepared.line,
      odds,
      stake,
      payout,
      status,
    ],
  );
  await debitWallet(input.recUserId, stake, `Tournament ${input.wagerKind} wager`, {
    wagerId: inserted.rows[0].id,
    matchId: match.id,
  });
  return listTournamentWagers({ tournamentId: input.tournamentId, matchId: match.id });
}

export async function acceptTournamentWager(input: { recUserId: string; wagerId: string }) {
  const result = await getPgPool().query(`select * from rec_site_tournament_wagers where id = $1`, [input.wagerId]);
  const wager = result.rows[0] as {
    id: string;
    tournament_id: string;
    match_id: string;
    user_id: string;
    wager_kind: string;
    market: string;
    stake: number;
    status: string;
  } | undefined;
  if (!wager) throw new ApiError(404, "Wager not found.");
  const kind = wager.wager_kind === "peer" || wager.market === "h2h" ? "peer" : "house";
  if (kind !== "peer" || wager.status !== "open") throw new ApiError(409, "That wager is not open to accept.");
  if (wager.user_id === input.recUserId) throw new ApiError(400, "You cannot accept your own wager.");
  const match = await loadMatch(wager.tournament_id, wager.match_id);
  assertOpenMatch(match, input.recUserId);
  await assertTournamentCap({
    tournamentId: wager.tournament_id,
    recUserId: input.recUserId,
    kind: "peer",
    stake: Number(wager.stake),
  });
  await debitWallet(input.recUserId, Number(wager.stake), "Tournament peer wager", {
    wagerId: wager.id,
    matchId: wager.match_id,
  });
  await getPgPool().query(
    `update rec_site_tournament_wagers set status = 'accepted', accepted_by_user_id = $2 where id = $1`,
    [wager.id, input.recUserId],
  );
  return listTournamentWagers({ tournamentId: wager.tournament_id, matchId: wager.match_id });
}

async function gradeWager(
  wager: {
    market_key: string;
    pick: string;
    line: number | null;
    wager_kind: string;
    market: string;
  },
  match: MatchRow,
): Promise<"won" | "lost" | "push" | "void"> {
  if (!match.player_a_user_id || !match.player_b_user_id) return "void";
  return resolveTournamentMarket({
    marketKey: wager.market_key || "moneyline",
    pick: wager.pick,
    line: wager.line == null ? null : Number(wager.line),
    wagerKind: wager.wager_kind === "peer" || wager.market === "h2h" ? "peer" : "house",
    homeUserId: match.player_a_user_id,
    awayUserId: match.player_b_user_id,
    homeScore: match.player_a_score == null ? null : Number(match.player_a_score),
    awayScore: match.player_b_score == null ? null : Number(match.player_b_score),
    winnerUserId: match.winner_user_id,
    boxScore: parseTournamentBoxScore(match.box_score),
  });
}

async function settleParlay(
  wager: { id: string; user_id: string; stake: number },
  match: MatchRow,
) {
  const legs = await getPgPool().query(
    `select * from rec_site_tournament_wager_legs where wager_id = $1`,
    [wager.id],
  );
  if (!legs.rows.length) {
    await creditWallet(wager.user_id, Number(wager.stake), "Tournament parlay refunded", { wagerId: wager.id });
    await getPgPool().query(
      `update rec_site_tournament_wagers set status = 'refunded', settled_at = now() where id = $1`,
      [wager.id],
    );
    return;
  }
  const results: Array<"won" | "lost" | "push" | "void"> = [];
  for (const leg of legs.rows) {
    const outcome = await gradeWager({
      market_key: leg.market_key,
      pick: leg.pick,
      line: leg.line,
      wager_kind: "house",
      market: "house",
    }, match);
    results.push(outcome);
    await getPgPool().query(
      `update rec_site_tournament_wager_legs set result = $2 where id = $1`,
      [leg.id, outcome === "void" ? null : outcome],
    );
  }
  if (results.some((result) => result === "void")) {
    await creditWallet(wager.user_id, Number(wager.stake), "Tournament parlay refunded (missing box score)", { wagerId: wager.id });
    await getPgPool().query(
      `update rec_site_tournament_wagers set status = 'refunded', settled_at = now() where id = $1`,
      [wager.id],
    );
    return;
  }
  if (results.some((result) => result === "lost")) {
    await getPgPool().query(
      `update rec_site_tournament_wagers set status = 'settled', payout_amount = 0, settled_at = now() where id = $1`,
      [wager.id],
    );
    return;
  }
  const wonOdds = legs.rows.filter((_, index) => results[index] === "won").map((leg) => Number(leg.odds));
  const payout = wonOdds.length ? potentialPayout(Number(wager.stake), parlayOdds(wonOdds)) : Number(wager.stake);
  if (payout) await creditWallet(wager.user_id, payout, wonOdds.length ? "Tournament parlay won" : "Tournament parlay push", { wagerId: wager.id });
  await getPgPool().query(
    `update rec_site_tournament_wagers set status = 'settled', payout_amount = $2, settled_at = now() where id = $1`,
    [wager.id, payout],
  );
}

export async function settleTournamentMatchWagers(matchId: string) {
  const matchResult = await getPgPool().query(`select * from rec_site_tournament_matches where id = $1`, [matchId]);
  const match = matchResult.rows[0] as MatchRow | undefined;
  if (!match) return;
  const result = await getPgPool().query(
    `select * from rec_site_tournament_wagers where match_id = $1 and status in ('open', 'accepted')`,
    [matchId],
  );
  for (const wager of result.rows as Array<{
    id: string;
    user_id: string;
    wager_kind: string;
    market: string;
    market_key: string;
    pick: string;
    pick_user_id: string | null;
    line: number | null;
    odds: number | null;
    stake: number;
    potential_payout: number;
    is_parlay: boolean;
    status: string;
    accepted_by_user_id: string | null;
  }>) {
    const kind = wager.wager_kind === "peer" || wager.market === "h2h" ? "peer" : "house";
    if (kind === "peer" && wager.status === "open") {
      await creditWallet(wager.user_id, Number(wager.stake), "Unmatched tournament wager refunded", { wagerId: wager.id });
      await getPgPool().query(
        `update rec_site_tournament_wagers set status = 'refunded', settled_at = now() where id = $1`,
        [wager.id],
      );
      continue;
    }
    if (wager.is_parlay) {
      await settleParlay(wager, match);
      continue;
    }
    const outcome = await gradeWager({
      market_key: wager.market_key || "moneyline",
      pick: wager.pick || wager.pick_user_id || "",
      line: wager.line,
      wager_kind: kind,
      market: wager.market,
    }, match);
    const stake = Number(wager.stake);
    if (outcome === "void") {
      await creditWallet(wager.user_id, stake, "Tournament wager refunded (missing box score)", { wagerId: wager.id });
      if (wager.accepted_by_user_id) {
        await creditWallet(wager.accepted_by_user_id, stake, "Tournament wager refunded (missing box score)", { wagerId: wager.id });
      }
      await getPgPool().query(
        `update rec_site_tournament_wagers set status = 'refunded', settled_at = now() where id = $1`,
        [wager.id],
      );
      continue;
    }
    if (kind === "house") {
      const payout = outcome === "won"
        ? Number(wager.potential_payout || 0) || potentialPayout(stake, Number(wager.odds || 1.91))
        : outcome === "push" ? stake : 0;
      if (payout) await creditWallet(wager.user_id, payout, outcome === "push" ? "Tournament house wager push" : "Tournament house wager won", { wagerId: wager.id });
      await getPgPool().query(
        `update rec_site_tournament_wagers set status = 'settled', payout_amount = $2, settled_at = now() where id = $1`,
        [wager.id, payout],
      );
      continue;
    }
    if (outcome === "push") {
      await creditWallet(wager.user_id, stake, "Tournament peer wager push", { wagerId: wager.id });
      if (wager.accepted_by_user_id) {
        await creditWallet(wager.accepted_by_user_id, stake, "Tournament peer wager push", { wagerId: wager.id });
      }
      await getPgPool().query(
        `update rec_site_tournament_wagers set status = 'settled', payout_amount = $2, settled_at = now() where id = $1`,
        [wager.id, stake],
      );
      continue;
    }
    const proposerWon = outcome === "won";
    const winnerId = proposerWon ? wager.user_id : wager.accepted_by_user_id;
    const payout = stake * 2;
    if (winnerId) await creditWallet(winnerId, payout, "Tournament peer wager won", { wagerId: wager.id });
    await getPgPool().query(
      `update rec_site_tournament_wagers set status = 'settled', payout_amount = $2, settled_at = now() where id = $1`,
      [wager.id, winnerId ? payout : 0],
    );
  }
}

export async function refundTournamentMatchWagers(matchId: string, reason: string) {
  const result = await getPgPool().query(
    `select * from rec_site_tournament_wagers where match_id = $1 and status in ('open', 'accepted')`,
    [matchId],
  );
  for (const wager of result.rows as Array<{
    id: string;
    user_id: string;
    accepted_by_user_id: string | null;
    stake: number;
  }>) {
    await creditWallet(wager.user_id, Number(wager.stake), reason, { wagerId: wager.id });
    if (wager.accepted_by_user_id) {
      await creditWallet(wager.accepted_by_user_id, Number(wager.stake), reason, { wagerId: wager.id });
    }
    await getPgPool().query(
      `update rec_site_tournament_wagers set status = 'refunded', settled_at = now() where id = $1`,
      [wager.id],
    );
  }
}

export function normalizeTournamentBoxScore(value: unknown): TournamentBoxScore | null {
  return parseTournamentBoxScore(value);
}

import {
  generateTournamentBracket,
  tournamentBracketType,
  type TournamentPayoutScope,
} from "@rec/shared";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

const GAME = ["madden_26", "madden_27", "cfb_27"] as const;
type Game = (typeof GAME)[number];

type TournamentRow = {
  id: string;
  title: string;
  description: string | null;
  game: string;
  bracket_type: string;
  payout_scope: TournamentPayoutScope;
  winner_coins: number;
  runner_up_coins: number;
  semifinalist_coins: number;
  status: string;
  created_by_user_id: string;
  starts_at: string | null;
  created_at: string;
  updated_at: string;
  locked_at: string | null;
  completed_at: string | null;
  payouts_issued_at: string | null;
  entrant_count?: number;
};

type EntrantRow = {
  user_id: string;
  seed: number | null;
  joined_at: string;
  username: string | null;
  display_name: string | null;
};

type MatchRow = {
  id: string;
  tournament_id: string;
  bracket_key: string;
  bracket_side: "winners" | "losers" | "grand_final";
  round: number;
  slot: number;
  player_a_user_id: string | null;
  player_b_user_id: string | null;
  winner_user_id: string | null;
  feeds_winner_match_id: string | null;
  feeds_winner_slot: "a" | "b" | null;
  feeds_loser_match_id: string | null;
  feeds_loser_slot: "a" | "b" | null;
  status: string;
};

function displayName(row: { username: string | null; display_name: string | null } | undefined): string {
  if (!row) return "TBD";
  if (row.username) return `@${row.username}`;
  return row.display_name || "REC Member";
}

async function loadTournament(id: string): Promise<TournamentRow> {
  const result = await getPgPool().query(`select * from rec_site_tournaments where id = $1`, [id]);
  const row = result.rows[0] as TournamentRow | undefined;
  if (!row) throw new ApiError(404, "Tournament not found.");
  return row;
}

function publicTournament(row: TournamentRow, extra: { joined?: boolean; entrantCount?: number } = {}) {
  const meta = tournamentBracketType(row.bracket_type);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    game: row.game,
    bracketType: row.bracket_type,
    bracketLabel: meta?.label ?? row.bracket_type,
    bracketSize: meta?.size ?? null,
    payoutScope: row.payout_scope,
    winnerCoins: Number(row.winner_coins),
    runnerUpCoins: Number(row.runner_up_coins),
    semifinalistCoins: Number(row.semifinalist_coins),
    status: row.status,
    startsAt: row.starts_at,
    createdAt: row.created_at,
    lockedAt: row.locked_at,
    completedAt: row.completed_at,
    payoutsIssuedAt: row.payouts_issued_at,
    entrantCount: extra.entrantCount ?? Number(row.entrant_count ?? 0),
    joined: extra.joined ?? false,
  };
}

export async function listTournaments(input: { recUserId: string }) {
  const result = await getPgPool().query(
    `
      select t.*,
        (select count(*)::int from rec_site_tournament_entrants e where e.tournament_id = t.id) as entrant_count,
        exists (
          select 1 from rec_site_tournament_entrants e
          where e.tournament_id = t.id and e.user_id = $1
        ) as joined
      from rec_site_tournaments t
      where t.status <> 'cancelled'
      order by
        case t.status when 'open' then 0 when 'locked' then 1 when 'draft' then 2 else 3 end,
        t.created_at desc
    `,
    [input.recUserId],
  );
  return {
    tournaments: result.rows.map((row) =>
      publicTournament(row as TournamentRow, {
        joined: Boolean(row.joined),
        entrantCount: Number(row.entrant_count ?? 0),
      }),
    ),
  };
}

export async function getTournamentDetail(input: { recUserId: string; tournamentId: string }) {
  const tournament = await loadTournament(input.tournamentId);
  const [entrants, matches] = await Promise.all([
    getPgPool().query(
      `
        select e.user_id, e.seed, e.joined_at, u.username, u.display_name
        from rec_site_tournament_entrants e
        inner join rec_users u on u.id = e.user_id
        where e.tournament_id = $1
        order by e.seed nulls last, e.joined_at asc
      `,
      [input.tournamentId],
    ),
    getPgPool().query(
      `
        select m.*,
          a.username as a_username, a.display_name as a_display_name,
          b.username as b_username, b.display_name as b_display_name,
          w.username as w_username, w.display_name as w_display_name
        from rec_site_tournament_matches m
        left join rec_users a on a.id = m.player_a_user_id
        left join rec_users b on b.id = m.player_b_user_id
        left join rec_users w on w.id = m.winner_user_id
        where m.tournament_id = $1
        order by
          case m.bracket_side when 'winners' then 0 when 'losers' then 1 else 2 end,
          m.round, m.slot
      `,
      [input.tournamentId],
    ),
  ]);
  const joined = (entrants.rows as EntrantRow[]).some((row) => row.user_id === input.recUserId);
  return {
    tournament: publicTournament(tournament, { joined, entrantCount: entrants.rows.length }),
    entrants: (entrants.rows as EntrantRow[]).map((row) => ({
      userId: row.user_id,
      seed: row.seed,
      displayName: displayName(row),
      isYou: row.user_id === input.recUserId,
    })),
    matches: matches.rows.map((row) => ({
      id: row.id,
      key: row.bracket_key,
      side: row.bracket_side,
      round: Number(row.round),
      slot: Number(row.slot),
      status: row.status,
      playerA: row.player_a_user_id
        ? { userId: row.player_a_user_id, displayName: displayName({ username: row.a_username, display_name: row.a_display_name }) }
        : null,
      playerB: row.player_b_user_id
        ? { userId: row.player_b_user_id, displayName: displayName({ username: row.b_username, display_name: row.b_display_name }) }
        : null,
      winnerUserId: row.winner_user_id,
      winnerDisplayName: row.winner_user_id
        ? displayName({ username: row.w_username, display_name: row.w_display_name })
        : null,
    })),
  };
}

export async function createTournament(input: {
  recUserId: string;
  title: string;
  description?: string | null;
  game: Game;
  bracketType: string;
  payoutScope: TournamentPayoutScope;
  winnerCoins: number;
  runnerUpCoins: number;
  semifinalistCoins: number;
}) {
  const meta = tournamentBracketType(input.bracketType);
  if (!meta) throw new ApiError(400, "Unknown bracket type.");
  if (input.winnerCoins < 0 || input.runnerUpCoins < 0 || input.semifinalistCoins < 0) {
    throw new ApiError(400, "Payouts cannot be negative.");
  }
  if (input.payoutScope !== "winner" && input.runnerUpCoins <= 0) {
    throw new ApiError(400, "Set a runner-up payout for this prize structure.");
  }
  if (input.payoutScope === "final_four" && input.semifinalistCoins <= 0) {
    throw new ApiError(400, "Set a semifinalist payout for Final Four prizes.");
  }
  const result = await getPgPool().query(
    `
      insert into rec_site_tournaments
        (title, description, game, bracket_type, payout_scope, winner_coins, runner_up_coins, semifinalist_coins,
         status, created_by_user_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9)
      returning *
    `,
    [
      input.title.trim(),
      input.description?.trim() || null,
      input.game,
      input.bracketType,
      input.payoutScope,
      Math.trunc(input.winnerCoins),
      Math.trunc(input.runnerUpCoins),
      Math.trunc(input.semifinalistCoins),
      input.recUserId,
    ],
  );
  return { tournament: publicTournament(result.rows[0] as TournamentRow, { entrantCount: 0 }) };
}

export async function cancelTournament(input: { tournamentId: string }) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status === "complete") throw new ApiError(409, "Completed tournaments cannot be cancelled.");
  await getPgPool().query(
    `update rec_site_tournaments set status = 'cancelled', updated_at = now() where id = $1`,
    [input.tournamentId],
  );
  return { ok: true as const };
}

export async function joinTournament(input: { recUserId: string; tournamentId: string }) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status !== "open") throw new ApiError(409, "This tournament is not accepting entrants.");
  const meta = tournamentBracketType(tournament.bracket_type);
  const count = await getPgPool().query(
    `select count(*)::int as n from rec_site_tournament_entrants where tournament_id = $1`,
    [input.tournamentId],
  );
  if (Number(count.rows[0]?.n ?? 0) >= (meta?.size ?? 0)) {
    throw new ApiError(409, "This bracket is full.");
  }
  try {
    await getPgPool().query(
      `insert into rec_site_tournament_entrants (tournament_id, user_id) values ($1, $2)`,
      [input.tournamentId, input.recUserId],
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") throw new ApiError(409, "You are already in this tournament.");
    throw error;
  }
  return getTournamentDetail(input);
}

export async function leaveTournament(input: { recUserId: string; tournamentId: string }) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status !== "open") throw new ApiError(409, "You can only leave before the bracket locks.");
  await getPgPool().query(
    `delete from rec_site_tournament_entrants where tournament_id = $1 and user_id = $2`,
    [input.tournamentId, input.recUserId],
  );
  return getTournamentDetail(input);
}

async function placePlayer(matchId: string, slot: "a" | "b", userId: string) {
  const column = slot === "a" ? "player_a_user_id" : "player_b_user_id";
  await getPgPool().query(
    `update rec_site_tournament_matches set ${column} = $2 where id = $1`,
    [matchId, userId],
  );
}

async function refreshMatchReadiness(matchId: string) {
  const result = await getPgPool().query(`select * from rec_site_tournament_matches where id = $1`, [matchId]);
  const match = result.rows[0] as MatchRow | undefined;
  if (!match || match.status === "complete" || match.status === "bye") return match;
  const a = match.player_a_user_id;
  const b = match.player_b_user_id;
  if (a && b) {
    await getPgPool().query(`update rec_site_tournament_matches set status = 'ready' where id = $1`, [matchId]);
  } else if (a || b) {
    await getPgPool().query(`update rec_site_tournament_matches set status = 'pending' where id = $1`, [matchId]);
  }
  return match;
}

async function resolveByes(tournamentId: string) {
  for (let i = 0; i < 16; i += 1) {
    const pending = await getPgPool().query(
      `
        select m.* from rec_site_tournament_matches m
        where m.tournament_id = $1
          and m.status in ('pending', 'ready')
          and (
            (m.player_a_user_id is not null and m.player_b_user_id is null)
            or (m.player_a_user_id is null and m.player_b_user_id is not null)
          )
          and not exists (
            select 1 from rec_site_tournament_matches feeder
            where feeder.feeds_winner_match_id = m.id
              and feeder.status in ('pending', 'ready')
          )
      `,
      [tournamentId],
    );
    if (!pending.rows.length) break;
    for (const row of pending.rows as MatchRow[]) {
      const winner = row.player_a_user_id ?? row.player_b_user_id;
      if (!winner) continue;
      await getPgPool().query(
        `update rec_site_tournament_matches set winner_user_id = $2, status = 'bye' where id = $1`,
        [row.id, winner],
      );
      if (row.feeds_winner_match_id && row.feeds_winner_slot) {
        await placePlayer(row.feeds_winner_match_id, row.feeds_winner_slot, winner);
        await refreshMatchReadiness(row.feeds_winner_match_id);
      }
    }
  }
}

export async function lockTournamentBracket(input: { tournamentId: string }) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status !== "open" && tournament.status !== "draft") {
    throw new ApiError(409, "The bracket is already locked.");
  }
  const meta = tournamentBracketType(tournament.bracket_type);
  if (!meta) throw new ApiError(400, "Unknown bracket type.");
  const entrants = await getPgPool().query(
    `select user_id from rec_site_tournament_entrants where tournament_id = $1 order by joined_at asc`,
    [input.tournamentId],
  );
  const ids = (entrants.rows as Array<{ user_id: string }>).map((row) => row.user_id);
  if (ids.length < 2) throw new ApiError(409, "Need at least two players to lock a bracket.");
  if (ids.length > meta.size) throw new ApiError(409, "Too many entrants for this bracket type.");

  const specs = generateTournamentBracket({ bracketType: tournament.bracket_type, entrantIds: ids });
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`delete from rec_site_tournament_matches where tournament_id = $1`, [input.tournamentId]);
    const idByKey = new Map<string, string>();
    for (const spec of specs) {
      const inserted = await client.query(
        `
          insert into rec_site_tournament_matches
            (tournament_id, bracket_key, bracket_side, round, slot, player_a_user_id, player_b_user_id, status)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          returning id
        `,
        [
          input.tournamentId,
          spec.key,
          spec.side,
          spec.round,
          spec.slot,
          spec.playerA,
          spec.playerB,
          spec.playerA && spec.playerB ? "ready" : "pending",
        ],
      );
      idByKey.set(spec.key, String(inserted.rows[0].id));
    }
    for (const spec of specs) {
      const id = idByKey.get(spec.key);
      if (!id) continue;
      await client.query(
        `
          update rec_site_tournament_matches
          set feeds_winner_match_id = $2, feeds_winner_slot = $3,
              feeds_loser_match_id = $4, feeds_loser_slot = $5
          where id = $1
        `,
        [
          id,
          spec.winnerFeed ? idByKey.get(spec.winnerFeed.key) ?? null : null,
          spec.winnerFeed?.slot ?? null,
          spec.loserFeed ? idByKey.get(spec.loserFeed.key) ?? null : null,
          spec.loserFeed?.slot ?? null,
        ],
      );
    }
    let seed = 1;
    for (const userId of ids) {
      await client.query(
        `update rec_site_tournament_entrants set seed = $3 where tournament_id = $1 and user_id = $2`,
        [input.tournamentId, userId, seed],
      );
      seed += 1;
    }
    await client.query(
      `update rec_site_tournaments set status = 'locked', locked_at = now(), updated_at = now() where id = $1`,
      [input.tournamentId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  await resolveByes(input.tournamentId);
  await maybeCompleteTournament(input.tournamentId);
  return getTournamentDetail({ recUserId: tournament.created_by_user_id, tournamentId: input.tournamentId });
}

async function creditPayout(userId: string, amount: number, tournamentId: string, place: string) {
  if (amount <= 0) return;
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: userId,
    p_amount: amount,
    p_league_id: null,
    p_description: `Tournament ${place} payout`,
    p_transaction_type: "tournament_payout",
    p_source: "site_tournament",
    p_source_reference: { tournamentId, place },
    p_allow_negative: false,
  });
  if (ledger.error) throw new ApiError(500, "Failed to pay tournament coins.", ledger.error);
}

function otherPlayer(match: MatchRow, winnerId: string): string | null {
  if (match.player_a_user_id === winnerId) return match.player_b_user_id;
  if (match.player_b_user_id === winnerId) return match.player_a_user_id;
  return null;
}

async function maybeCompleteTournament(tournamentId: string) {
  const tournament = await loadTournament(tournamentId);
  if (tournament.status !== "locked") return;
  const matches = await getPgPool().query(
    `select * from rec_site_tournament_matches where tournament_id = $1`,
    [tournamentId],
  );
  const rows = matches.rows as MatchRow[];
  const championship =
    rows.find((row) => row.bracket_side === "grand_final") ??
    rows
      .filter((row) => row.bracket_side === "winners")
      .sort((a, b) => b.round - a.round || a.slot - b.slot)[0];
  if (!championship?.winner_user_id || (championship.status !== "complete" && championship.status !== "bye")) {
    return;
  }

  const winnerId = championship.winner_user_id;
  const runnerUpId = otherPlayer(championship, winnerId);
  const wbRounds = Math.max(0, ...rows.filter((row) => row.bracket_side === "winners").map((row) => row.round));
  const semiLosers = rows
    .filter((row) => row.bracket_side === "winners" && row.round === wbRounds - 1 && row.winner_user_id)
    .map((row) => otherPlayer(row, row.winner_user_id!))
    .filter((id): id is string => Boolean(id) && id !== winnerId && id !== runnerUpId);

  const paid = new Set<string>();
  await creditPayout(winnerId, Number(tournament.winner_coins), tournamentId, "champion");
  paid.add(winnerId);
  if (tournament.payout_scope !== "winner" && runnerUpId) {
    await creditPayout(runnerUpId, Number(tournament.runner_up_coins), tournamentId, "runner-up");
    paid.add(runnerUpId);
  }
  if (tournament.payout_scope === "final_four") {
    for (const userId of semiLosers.slice(0, 2)) {
      if (paid.has(userId)) continue;
      await creditPayout(userId, Number(tournament.semifinalist_coins), tournamentId, "semifinalist");
      paid.add(userId);
    }
  }

  await getPgPool().query(
    `
      update rec_site_tournaments
      set status = 'complete', completed_at = now(), payouts_issued_at = now(), updated_at = now()
      where id = $1
    `,
    [tournamentId],
  );
}

export async function reportTournamentWinner(input: {
  recUserId: string;
  isAdmin: boolean;
  tournamentId: string;
  matchId: string;
  winnerUserId: string;
}) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status !== "locked") throw new ApiError(409, "Results can only be recorded on a locked bracket.");
  const result = await getPgPool().query(
    `select * from rec_site_tournament_matches where id = $1 and tournament_id = $2`,
    [input.matchId, input.tournamentId],
  );
  const match = result.rows[0] as MatchRow | undefined;
  if (!match) throw new ApiError(404, "Match not found.");
  if (match.status === "complete" || match.status === "bye") throw new ApiError(409, "That match is already decided.");
  const players = [match.player_a_user_id, match.player_b_user_id];
  if (!players.includes(input.winnerUserId)) throw new ApiError(400, "Winner must be one of the two players.");
  if (!match.player_a_user_id || !match.player_b_user_id) {
    throw new ApiError(409, "Both players must be set before recording a result.");
  }
  const inMatch = input.recUserId === match.player_a_user_id || input.recUserId === match.player_b_user_id;
  if (!input.isAdmin && !inMatch) throw new ApiError(403, "Only a player in this match or a site admin can report it.");

  const loserId = otherPlayer(match, input.winnerUserId);
  await getPgPool().query(
    `update rec_site_tournament_matches set winner_user_id = $2, status = 'complete' where id = $1`,
    [match.id, input.winnerUserId],
  );
  if (match.feeds_winner_match_id && match.feeds_winner_slot) {
    await placePlayer(match.feeds_winner_match_id, match.feeds_winner_slot, input.winnerUserId);
    await refreshMatchReadiness(match.feeds_winner_match_id);
  }
  if (loserId && match.feeds_loser_match_id && match.feeds_loser_slot) {
    await placePlayer(match.feeds_loser_match_id, match.feeds_loser_slot, loserId);
    await refreshMatchReadiness(match.feeds_loser_match_id);
  }
  await resolveByes(input.tournamentId);
  await maybeCompleteTournament(input.tournamentId);
  return getTournamentDetail({ recUserId: input.recUserId, tournamentId: input.tournamentId });
}

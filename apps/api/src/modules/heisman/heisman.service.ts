import { ApiError } from "../../lib/errors.js";
import { getPgPool } from "../../db/client.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";

const MAX_CANDIDATES = 4;
const AWARD_AMOUNT = 1000;

async function recUserIdForDiscord(discordId: string | null): Promise<string | null> {
  if (!discordId) return null;
  const result = await getPgPool().query(
    `select user_id from rec_discord_accounts where discord_id=$1 limit 1`,
    [discordId],
  );
  return result.rows[0]?.user_id ?? null;
}

export type HeismanCandidateRow = {
  id: string;
  player_name: string;
  team_id: string | null;
  team_name: string | null;
  team_abbreviation: string | null;
  created_at: string;
};

async function loadRaceState(leagueId: string, seasonNumber: number) {
  const result = await getPgPool().query(
    `select rs.winner_candidate_id,rs.awarded_at,c.player_name as winner_name
     from rec_heisman_race_state rs left join rec_heisman_candidates c on c.id=rs.winner_candidate_id
     where rs.league_id=$1 and rs.season_number=$2`,
    [leagueId, seasonNumber],
  );
  const row = result.rows[0];
  return {
    closed: Boolean(row?.awarded_at),
    winnerCandidateId: row?.winner_candidate_id ?? null,
    winnerName: row?.winner_name ?? null,
    awardedAt: row?.awarded_at ?? null,
  };
}

export async function listHeismanCandidates(input: { guildId: string; seasonNumber?: number | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const [result, state] = await Promise.all([
    getPgPool().query(
      `select c.id,c.player_name,c.team_id,t.name as team_name,t.abbreviation as team_abbreviation,c.created_at
       from rec_heisman_candidates c left join rec_teams t on t.id=c.team_id
       where c.league_id=$1 and c.season_number=$2 order by c.created_at asc`,
      [context.leagueId, seasonNumber],
    ),
    loadRaceState(context.leagueId, seasonNumber),
  ]);
  return { seasonNumber, candidates: result.rows as HeismanCandidateRow[], ...state };
}

export async function addHeismanCandidate(input: {
  guildId: string;
  seasonNumber?: number | null;
  playerName: string;
  teamId?: string | null;
  requestedByDiscordId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (context.rec_leagues.game !== "cfb_27") throw new ApiError(400, "The Heisman Race is available only for CFB 27 leagues.");
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const playerName = input.playerName.trim();
  if (!playerName) throw new ApiError(400, "Enter the candidate's name.");
  if (playerName.length > 100) throw new ApiError(400, "Candidate name is too long.");

  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`heisman:${context.leagueId}:${seasonNumber}`]);
    const state = await client.query(`select awarded_at from rec_heisman_race_state where league_id=$1 and season_number=$2`, [context.leagueId, seasonNumber]);
    if (state.rows[0]?.awarded_at) throw new ApiError(400, "The Heisman Race is closed for this season — it reopens at the start of next season.");
    const count = await client.query(
      `select count(*)::int as count from rec_heisman_candidates where league_id=$1 and season_number=$2`,
      [context.leagueId, seasonNumber],
    );
    if (Number(count.rows[0]?.count) >= MAX_CANDIDATES) {
      throw new ApiError(400, `The Heisman Race is capped at ${MAX_CANDIDATES} candidates — remove one before adding another.`);
    }
    if (input.teamId) {
      const validTeam = await client.query(`select 1 from rec_teams where id=$1 and league_id=$2`, [input.teamId, context.leagueId]);
      if (!validTeam.rowCount) throw new ApiError(400, "That team doesn't belong to this league.");
    }
    const userId = await recUserIdForDiscord(input.requestedByDiscordId ?? null);
    await client.query(
      `insert into rec_heisman_candidates(league_id,season_number,player_name,team_id,added_by_user_id)
       values($1,$2,$3,$4,$5)`,
      [context.leagueId, seasonNumber, playerName, input.teamId ?? null, userId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return listHeismanCandidates({ guildId: input.guildId, seasonNumber });
}

export async function removeHeismanCandidate(input: { guildId: string; candidateId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context, null);
  const state = await loadRaceState(context.leagueId, seasonNumber);
  if (state.closed) throw new ApiError(400, "The Heisman Race is closed for this season — it reopens at the start of next season.");
  const result = await getPgPool().query(
    `delete from rec_heisman_candidates where id=$1 and league_id=$2`,
    [input.candidateId, context.leagueId],
  );
  if (!result.rowCount) throw new ApiError(404, "Candidate not found.");
  return listHeismanCandidates({ guildId: input.guildId });
}

export async function awardHeismanWinner(input: {
  guildId: string;
  seasonNumber?: number | null;
  candidateId: string;
  requestedByDiscordId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);

  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`heisman:${context.leagueId}:${seasonNumber}`]);
    const state = await client.query(`select awarded_at from rec_heisman_race_state where league_id=$1 and season_number=$2`, [context.leagueId, seasonNumber]);
    if (state.rows[0]?.awarded_at) throw new ApiError(400, "The Heisman Race has already been awarded for this season.");

    const candidate = await client.query(
      `select id,player_name,team_id from rec_heisman_candidates where id=$1 and league_id=$2 and season_number=$3`,
      [input.candidateId, context.leagueId, seasonNumber],
    );
    if (!candidate.rowCount) throw new ApiError(404, "Candidate not found.");
    const row = candidate.rows[0];
    if (!row.team_id) throw new ApiError(400, "Set a team for this candidate before awarding — the winner's coach receives the coins.");

    const assignment = await client.query(
      `select user_id from rec_team_assignments where league_id=$1 and team_id=$2 and assignment_status='active' and ended_at is null limit 1`,
      [context.leagueId, row.team_id],
    );
    const winnerUserId = assignment.rows[0]?.user_id ?? null;
    if (!winnerUserId) throw new ApiError(400, "This candidate's team isn't linked to a coach — link it before awarding.");

    // Discord-only accounts (no linked site login) are supposed to be excluded from payout
    // eligibility, same as they're already blocked from spending (assertSiteAccountForEconomy)
    // — this credit skipped that check entirely. Queue it in the same backlog table other
    // payout types already use instead of crediting a wallet the user can't touch yet; it
    // releases once they link (releaseBacklogForUser, called from linkDiscordFromOAuth).
    const linked = await client.query(`select supabase_auth_user_id from rec_users where id=$1`, [winnerUserId]);
    const isDiscordOnly = !linked.rows[0]?.supabase_auth_user_id;

    // Repeated failure to set scheduling availability holds payouts too (see
    // availability-compliance.service.ts) -- this path duplicates economy-backlog.ts's
    // creditOrBacklog logic rather than calling it (same existing pattern as the Discord-only
    // check above), so it needs the same condition mirrored here.
    const compliance = await client.query(`select warning_count from rec_availability_compliance where user_id=$1 and league_id=$2`, [winnerUserId, context.leagueId]);
    const payoutsHeldForAvailability = Number(compliance.rows[0]?.warning_count ?? 0) > 2;

    // Same connection/transaction as the race-state write below, so the coin payout (or its
    // backlog entry) and closing the race commit atomically — never one without the other.
    if (isDiscordOnly || payoutsHeldForAvailability) {
      await client.query(
        `insert into rec_economy_payout_backlog (league_id, season_number, user_id, amount, description, transaction_type, source, source_reference)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [context.leagueId, seasonNumber, winnerUserId, AWARD_AMOUNT, "Heisman Trophy award", "heisman_award", "heisman", JSON.stringify({ candidateId: input.candidateId })],
      );
    } else {
      await client.query(
        `select add_to_wallet($1,$2,$3,$4,$5,$6::rec_source_type,$7::jsonb)`,
        [winnerUserId, AWARD_AMOUNT, context.leagueId, "Heisman Trophy award", "heisman_award", "heisman", JSON.stringify({ candidateId: input.candidateId })],
      );
    }

    const requestedByUserId = await recUserIdForDiscord(input.requestedByDiscordId ?? null);
    await client.query(
      `insert into rec_heisman_race_state(league_id,season_number,winner_candidate_id,awarded_user_id,awarded_at,awarded_by_user_id)
       values($1,$2,$3,$4,now(),$5)
       on conflict(league_id,season_number) do update set winner_candidate_id=excluded.winner_candidate_id,
         awarded_user_id=excluded.awarded_user_id, awarded_at=excluded.awarded_at, awarded_by_user_id=excluded.awarded_by_user_id, updated_at=now()`,
      [context.leagueId, seasonNumber, row.id, winnerUserId, requestedByUserId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return listHeismanCandidates({ guildId: input.guildId, seasonNumber });
}

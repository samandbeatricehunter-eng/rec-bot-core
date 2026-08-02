import { ApiError } from "../../lib/errors.js";
import { getPgPool } from "../../db/client.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";

const MAX_CANDIDATES = 4;

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

export async function listHeismanCandidates(input: { guildId: string; seasonNumber?: number | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const result = await getPgPool().query(
    `select c.id,c.player_name,c.team_id,t.name as team_name,t.abbreviation as team_abbreviation,c.created_at
     from rec_heisman_candidates c left join rec_teams t on t.id=c.team_id
     where c.league_id=$1 and c.season_number=$2 order by c.created_at asc`,
    [context.leagueId, seasonNumber],
  );
  return { seasonNumber, candidates: result.rows as HeismanCandidateRow[] };
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
  const result = await getPgPool().query(
    `delete from rec_heisman_candidates where id=$1 and league_id=$2`,
    [input.candidateId, context.leagueId],
  );
  if (!result.rowCount) throw new ApiError(404, "Candidate not found.");
  return listHeismanCandidates({ guildId: input.guildId });
}

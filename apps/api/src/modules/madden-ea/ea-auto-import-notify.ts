import { getPgPool } from "../../db/client.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { describeImportChanges, type ImportChangeNote, type ImportStateSnapshot } from "./ea-auto-import-notify.lib.js";

export type { ImportChangeNote, ImportStateSnapshot } from "./ea-auto-import-notify.lib.js";
export { describeImportChanges } from "./ea-auto-import-notify.lib.js";

export async function snapshotImportState(leagueId: string): Promise<ImportStateSnapshot> {
  const pool = getPgPool();
  const [games, playerStats, teamStats, roster] = await Promise.all([
    pool.query<{ n: number }>(
      `select count(*)::int as n from rec_games
        where league_id=$1 and lower(coalesce(status,'')) in ('completed','final')`,
      [leagueId],
    ),
    pool.query<{ n: number }>(
      `select count(*)::int as n from rec_player_weekly_stats where league_id=$1`,
      [leagueId],
    ),
    pool.query<{ n: number }>(
      `select count(*)::int as n from rec_team_game_stats where league_id=$1`,
      [leagueId],
    ),
    pool.query<{ fingerprint: string }>(
      `select coalesce(md5(string_agg(coalesce(madden_player_id,'') || ':' || coalesce(team_id::text,''), ',' order by madden_player_id)), '') as fingerprint
         from rec_players
        where league_id=$1 and coalesce(is_free_agent, false) = false`,
      [leagueId],
    ),
  ]);
  return {
    completedGames: games.rows[0]?.n ?? 0,
    playerStatRows: playerStats.rows[0]?.n ?? 0,
    teamStatRows: teamStats.rows[0]?.n ?? 0,
    rosterFingerprint: roster.rows[0]?.fingerprint ?? "",
  };
}

export async function notifyCommissionersOfAutoImport(leagueId: string, notes: ImportChangeNote[]): Promise<void> {
  if (!notes.length) return;
  const link = await getPgPool().query<{ guild_id: string; server_id: string }>(
    `select s.guild_id, s.id as server_id
       from rec_server_league_links l
       join rec_discord_servers s on s.id = l.server_id
      where l.league_id = $1
      order by l.is_primary desc
      limit 1`,
    [leagueId],
  );
  const guildId = link.rows[0]?.guild_id;
  if (!guildId) return;

  const league = await getPgPool().query<{ season_number: number | null; current_week: number | null }>(
    `select season_number, current_week from rec_leagues where id=$1`,
    [leagueId],
  );
  const header = notes.length === 1 ? `EA Auto-Import: ${notes[0]!.message}` : "EA Auto-Import: league data updated";
  const summary = notes.map((note) => note.message).join(". ") + ".";

  await getPgPool().query(
    `insert into rec_commissioners_inbox
       (guild_id, server_id, league_id, season_number, week_number, queue_type, status, priority,
        header, summary, payload)
     values ($1,$2,$3,$4,$5,'ea_auto_import','pending',0,$6,$7,$8::jsonb)`,
    [
      guildId,
      link.rows[0]?.server_id ?? null,
      leagueId,
      league.rows[0]?.season_number ?? 1,
      league.rows[0]?.current_week ?? 1,
      header,
      summary,
      JSON.stringify({ notes }),
    ],
  );
  void notifyLeagueCommissionersOfPendingItem(leagueId);
}

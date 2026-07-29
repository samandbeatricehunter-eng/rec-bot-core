import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { badgesForUser, careerStatsByGameForUser } from "../site-home/site-home.service.js";

export type CompUserSummary = {
  id: string;
  username: string | null;
  displayName: string;
};

export async function listConnectedUsers(input: { page?: number; pageSize?: number }): Promise<{
  users: CompUserSummary[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const pageSize = 50;
  const page = Math.max(input.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  const [rows, countResult] = await Promise.all([
    getPgPool().query(
      `
        select id, username, display_name
        from rec_users
        where supabase_auth_user_id is not null
        order by username nulls last, display_name
        limit $1 offset $2
      `,
      [pageSize, offset],
    ),
    getPgPool().query(`select count(*)::int as n from rec_users where supabase_auth_user_id is not null`),
  ]);

  return {
    users: rows.rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      displayName: row.username ?? row.display_name ?? "REC Member",
    })),
    page,
    pageSize,
    total: countResult.rows[0]?.n ?? 0,
  };
}

export async function getUserCompDetail(recUserId: string) {
  const [profileResult, globalRecordRow, discordRow] = await Promise.all([
    getPgPool().query(
      `select id, username, display_name from rec_users
       where id = $1 and supabase_auth_user_id is not null`,
      [recUserId],
    ),
    supabase.from("rec_global_user_records").select("*").eq("user_id", recUserId).maybeSingle(),
    supabase
      .from("rec_discord_accounts")
      .select("first_seen_at")
      .eq("user_id", recUserId)
      .order("first_seen_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const profile = profileResult.rows[0];
  if (!profile) throw new ApiError(404, "User not found.");
  if (globalRecordRow.error) throw new ApiError(500, "Failed to load global record.", globalRecordRow.error);

  const [careerStats, badges] = await Promise.all([
    careerStatsByGameForUser(recUserId),
    badgesForUser(recUserId),
  ]);

  const globalRecord = globalRecordRow.data ?? {
    wins: 0, losses: 0, ties: 0, playoff_wins: 0, playoff_losses: 0,
    superbowl_wins: 0, superbowl_losses: 0, point_differential: 0, games_played: 0,
  };

  return {
    displayName: profile.username ?? profile.display_name ?? "REC Member",
    username: profile.username,
    memberSince: discordRow.data?.first_seen_at ?? null,
    globalRecord: {
      wins: Number((globalRecord as any).wins ?? 0),
      losses: Number((globalRecord as any).losses ?? 0),
      ties: Number((globalRecord as any).ties ?? 0),
      playoffWins: Number((globalRecord as any).playoff_wins ?? 0),
      playoffLosses: Number((globalRecord as any).playoff_losses ?? 0),
      superbowlWins: Number((globalRecord as any).superbowl_wins ?? 0),
      superbowlLosses: Number((globalRecord as any).superbowl_losses ?? 0),
      gamesPlayed: Number((globalRecord as any).games_played ?? 0),
      pointDifferential: Number((globalRecord as any).point_differential ?? 0),
    },
    careerStats: careerStats.games,
    badges: badges.badges,
  };
}

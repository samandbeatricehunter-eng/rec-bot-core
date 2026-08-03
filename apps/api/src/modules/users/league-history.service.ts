import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

function wagerSummary(rows: any[], userId: string, kind: "house" | "peer") {
  const relevant = rows.filter((row) => kind === "house" ? row.wager_kind === "house" && row.placed_by_user_id === userId : row.wager_kind !== "house" && (row.placed_by_user_id === userId || row.accepted_by_user_id === userId));
  return relevant.reduce((out, row) => {
    const ownStake = row.placed_by_user_id === userId ? Number(row.stake ?? 0) : Number(row.stake ?? 0);
    out.staked += ownStake;
    if (["won", "paid", "settled_won"].includes(row.status)) { out.won += 1; out.paid += Number(row.potential_payout ?? 0); }
    else if (["lost", "settled_lost"].includes(row.status)) out.lost += 1;
    else if (row.status === "refunded") out.refunded += ownStake;
    return out;
  }, { wagers: relevant.length, staked: 0, paid: 0, won: 0, lost: 0, refunded: 0 });
}

export async function snapshotLeagueHistory(leagueId: string, archived = false) {
  const [league, records, assignments, ledger, wagers] = await Promise.all([
    supabase.from("rec_leagues").select("id,name,game,season_number,display_season_number,created_at").eq("id", leagueId).single(),
    supabase.from("rec_league_user_records").select("*").eq("league_id", leagueId),
    supabase.from("rec_team_assignments").select("user_id,team_id,started_at,ended_at,assignment_status,team:rec_teams(name,abbreviation)").eq("league_id", leagueId),
    supabase.from("rec_dollar_ledger").select("user_id,amount,transaction_type,created_at").eq("league_id", leagueId),
    supabase.from("rec_wagers").select("placed_by_user_id,accepted_by_user_id,wager_kind,stake,potential_payout,status,created_at").eq("league_id", leagueId),
  ]);
  for (const result of [league, records, assignments, ledger, wagers]) if (result.error) throw new ApiError(500, "Failed to preserve league history.", result.error);
  const userIds = [...new Set([...(records.data ?? []).map((row: any) => row.user_id), ...(assignments.data ?? []).map((row: any) => row.user_id)].filter(Boolean))];
  const season = Number(league.data.season_number ?? league.data.display_season_number ?? 1);
  for (const userId of userIds) {
    const record = (records.data ?? []).find((row: any) => row.user_id === userId) ?? {};
    const userLedger = (ledger.data ?? []).filter((row: any) => row.user_id === userId);
    const economy = userLedger.reduce((out: any, row: any) => { const amount = Number(row.amount ?? 0); out.net += amount; amount > 0 ? out.earned += amount : out.spent += Math.abs(amount); return out; }, { earned: 0, spent: 0, net: 0, transactions: userLedger.length });
    const history = await supabase.from("rec_user_league_history").upsert({
      user_id: userId, league_id: leagueId, league_name: league.data.name, game: league.data.game,
      first_joined_at: (assignments.data ?? []).filter((row: any) => row.user_id === userId).map((row: any) => row.started_at).sort()[0] ?? league.data.created_at,
      last_active_at: new Date().toISOString(), archived_at: archived ? new Date().toISOString() : null, is_active: !archived,
      seasons_participated: season, first_season: 1, last_season: season, record,
      statistics: {}, achievements: {}, economy,
      wager_house: wagerSummary(wagers.data ?? [], userId, "house"), wager_peer: wagerSummary(wagers.data ?? [], userId, "peer"),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,league_id" }).select("id").single();
    if (history.error) throw new ApiError(500, "Failed to save a league history snapshot.", history.error);
    for (const assignment of (assignments.data ?? []).filter((row: any) => row.user_id === userId)) {
      const team = Array.isArray(assignment.team) ? assignment.team[0] : assignment.team;
      const existing = await supabase.from("rec_user_league_team_tenures").select("id").eq("history_id", history.data.id).eq("team_id", assignment.team_id).eq("started_at", assignment.started_at).maybeSingle();
      const payload = { history_id: history.data.id, user_id: userId, league_id: leagueId, team_id: assignment.team_id,
        team_name: team?.name ?? null, team_abbreviation: team?.abbreviation ?? null, started_at: assignment.started_at,
        ended_at: archived ? assignment.ended_at ?? new Date().toISOString() : assignment.ended_at,
        archived_at: archived ? new Date().toISOString() : null, is_active: !archived && !assignment.ended_at,
        first_season: 1, last_season: season, record: {}, statistics: {}, economy, updated_at: new Date().toISOString() };
      const saved = existing.data ? await supabase.from("rec_user_league_team_tenures").update(payload).eq("id", existing.data.id) : await supabase.from("rec_user_league_team_tenures").insert(payload);
      if (saved.error) throw new ApiError(500, "Failed to save a team tenure snapshot.", saved.error);
    }
  }
  return { usersPreserved: userIds.length };
}

export async function getLeagueHistoryForDiscord(discordId: string) {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to resolve the REC account.", account.error);
  if (!account.data?.user_id) return { leagues: [] };
  const active = await supabase.from("rec_team_assignments").select("league_id").eq("user_id", account.data.user_id).is("ended_at", null);
  if (active.error) throw new ApiError(500, "Failed to load active league memberships.", active.error);
  const activeLeagueIds: string[] = [...new Set<string>((active.data ?? []).map((row: any) => String(row.league_id)).filter(Boolean))];
  for (const leagueId of activeLeagueIds) {
    await snapshotLeagueHistory(leagueId, false);
  }
  const rows = await supabase.from("rec_user_league_history").select("*,teamTenures:rec_user_league_team_tenures(*)").eq("user_id", account.data.user_id).order("last_active_at", { ascending: false });
  if (rows.error) throw new ApiError(500, "Failed to load league history.", rows.error);
  return { leagues: rows.data ?? [] };
}

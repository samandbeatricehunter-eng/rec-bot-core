import { createClient } from "@supabase/supabase-js";
import { env } from "../src/config/env.js";
import { evalTeamStat } from "../src/modules/league-week/eos-payouts.service.js";
import { evaluatePayoutTier, isPayoutEligibleForGame, REC_END_SEASON_PAYOUTS, regularSeasonWeeks, type RecPayoutTier } from "@rec/shared";

const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function run() {
  const leagues = await client.from("rec_leagues").select("id,name,game,season_stage,current_week");
  if (leagues.error) throw new Error(`load leagues: ${JSON.stringify(leagues.error)}`);
  const leagueRows = leagues.data ?? [];

  for (const league of leagueRows) {
    const seasonRows = await client.from("rec_team_game_stats").select("season_number").eq("league_id", league.id);
    if (seasonRows.error) throw new Error(`load seasons: ${JSON.stringify(seasonRows.error)}`);
    const seasons = [...new Set((seasonRows.data ?? []).map((r: any) => Number(r.season_number)))].sort((a, b) => a - b);
    const season = seasons.length ? seasons[seasons.length - 1] : null;
    console.log(`\n===== ${league.name} (${league.id.slice(0, 8)}) [game=${league.game}, stage=${league.season_stage}, week=${league.current_week}]`);

    if (season == null) {
      console.log("  no team-game stats yet");
      continue;
    }

    const game = league.game as string;
    const weeks = regularSeasonWeeks(game as any);
    const stats = await client
      .from("rec_team_game_stats")
      .select("user_id,team_id,points_for,points_against,yards_allowed,generated_turnovers,turnovers_committed,total_yards_gained,off_yards_gained,red_zone_off_percentage,red_zone_def_percentage,offensive_stats,defensive_stats")
      .eq("league_id", league.id)
      .eq("season_number", season)
      .lte("week_number", weeks)
      .not("user_id", "is", null);
    if (stats.error) throw new Error(`load stats: ${JSON.stringify(stats.error)}`);

    const byUser = new Map<string, any[]>();
    for (const row of stats.data ?? []) {
      const rows = byUser.get(row.user_id) ?? [];
      rows.push(row);
      byUser.set(row.user_id, rows);
    }

    const teamNameById = new Map<string, string>();
    const teamIds = [...new Set((stats.data ?? []).map((r: any) => r.team_id).filter((id: any) => Boolean(id)))];
    if (teamIds.length) {
      const teams = await client.from("rec_teams").select("id,display_nick,display_abbr,name").in("id", teamIds);
      if (teams.error) throw new Error(`load teams: ${JSON.stringify(teams.error)}`);
      for (const team of teams.data ?? []) teamNameById.set(team.id, team.display_nick ?? team.display_abbr ?? team.name);
    }

    const definitions = REC_END_SEASON_PAYOUTS.filter((d) => d.scope === "team" && isPayoutEligibleForGame(d, game));
    console.log(`  user teams with stats: ${byUser.size}`);
    for (const definition of definitions) {
      const tierCounts = new Map<string, number>();
      let none = 0;
      const perTeam: Array<{ team: string; tier: string; value: number }> = [];
      for (const [userId, rows] of byUser.entries()) {
        const value = evalTeamStat(definition.statKey, rows);
        const tier = evaluatePayoutTier(value, definition.tiers);
        const teamId = rows.find((r: any) => r.team_id)?.team_id ?? null;
        const team = teamId ? (teamNameById.get(teamId) ?? teamId.slice(0, 8)) : userId.slice(0, 8);
        const games = rows.length;
        if (tier) {
          tierCounts.set(tier.tier, (tierCounts.get(tier.tier) ?? 0) + 1);
          perTeam.push({ team: `${team}(g${games})`, tier: tier.tier, value: Math.round(value * 100) / 100 });
        } else {
          none += 1;
          perTeam.push({ team: `${team}(g${games})`, tier: "-", value: Math.round(value * 100) / 100 });
        }
      }
      const tiers = "SABCD";
      const counts = tiers.split("").map((t) => `${t}=${tierCounts.get(t) ?? 0}`);
      const qualifiers = byUser.size - none;
      console.log(`  ${definition.label.padEnd(38)} none=${String(none).padStart(2)} ${counts.join(" ")}  (${qualifiers}/${byUser.size} qualify)`);
      const sorted = perTeam.sort((a, b) => b.value - a.value);
      console.log(`      ${sorted.map((p) => `${p.team}:${p.tier}:${p.value}`).join("  ")}`);
    }

    const rank = await client.rpc("rec_eos_rank_payouts", { p_league_id: league.id, p_season_number: season });
    if (rank.error) {
      console.log(`  power_ranking_position: RPC failed (${JSON.stringify(rank.error).slice(0, 120)})`);
    } else {
      const paid = (rank.data ?? []).filter((r: any) => Number(r.rank_amount ?? 0) > 0);
      console.log(`  power_ranking_position: ${paid.length} team(s) ranked high enough to earn a payout`);
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

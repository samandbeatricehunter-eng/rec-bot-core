import { createClient } from "@supabase/supabase-js";
import { env } from "../src/config/env.js";
import { evalTeamStat } from "../src/modules/league-week/eos-payouts.service.js";
import { evaluatePayoutTier, REC_END_SEASON_PAYOUTS } from "@rec/shared";

const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const definition = REC_END_SEASON_PAYOUTS.find((d) => d.key === "defense_needs_a_name");
if (!definition) throw new Error("defense_needs_a_name payout definition not found");

const CFB_REGULAR_SEASON_WEEKS = 14;

async function run() {
  const leagues = await client.from("rec_leagues").select("id,name,season_number,game,season_stage,current_week").eq("game", "cfb_27");
  if (leagues.error) throw new Error(`load leagues: ${JSON.stringify(leagues.error)}`);
  const leagueRows = leagues.data ?? [];

  let totalQualifying = 0;
  const allQualifying: Array<{ league: string; season: number; team: string; score: number }> = [];

  for (const league of leagueRows) {
    const seasonRows = await client
      .from("rec_team_game_stats")
      .select("season_number")
      .eq("league_id", league.id);
    if (seasonRows.error) throw new Error(`load seasons: ${JSON.stringify(seasonRows.error)}`);
    const seasons = [...new Set((seasonRows.data ?? []).map((r: any) => Number(r.season_number)))].sort((a, b) => a - b);
    const season = seasons.length ? seasons[seasons.length - 1] : null;
    if (season == null) {
      console.log(`— ${league.name} (${league.id.slice(0, 8)}): no team-game stats yet`);
      continue;
    }

    const stats = await client
      .from("rec_team_game_stats")
      .select("user_id,team_id,red_zone_def_percentage,defensive_stats")
      .eq("league_id", league.id)
      .eq("season_number", season)
      .lte("week_number", CFB_REGULAR_SEASON_WEEKS)
      .not("user_id", "is", null);
    if (stats.error) throw new Error(`load stats: ${JSON.stringify(stats.error)}`);

    const byUser = new Map<string, any[]>();
    for (const row of stats.data ?? []) {
      const rows = byUser.get(row.user_id) ?? [];
      rows.push(row);
      byUser.set(row.user_id, rows);
    }

    const qualifying: Array<{ userId: string; teamId: string | null; score: number }> = [];
    for (const [userId, rows] of byUser.entries()) {
      const value = evalTeamStat("defense_identity_score", rows);
      const teamId = rows.find((r: any) => r.team_id)?.team_id ?? null;
      const games = rows.length;
      const avgRz = rows.map((r: any) => r.red_zone_def_percentage).filter((v: any) => v != null).map(Number);
      const rzPct = avgRz.length ? avgRz.reduce((a: number, b: number) => a + b, 0) / avgRz.length : 0;
      const ints = rows.reduce((a: number, r: any) => a + Number(r.defensive_stats?.interceptions_thrown ?? 0), 0);
      const fum = rows.reduce((a: number, r: any) => a + Number(r.defensive_stats?.fumbles_lost ?? 0), 0);
      const madeAttempts = (key: string) => {
        let made = 0, att = 0;
        for (const r of rows) {
          const raw = r.defensive_stats?.[key];
          const m = raw != null ? String(raw).match(/^(-?\d+)-(-?\d+)$/) : null;
          if (m) { made += parseInt(m[1], 10); att += parseInt(m[2], 10); }
        }
        return att > 0 ? { made, att, pct: (made / att) * 100 } : { made, att, pct: null };
      };
      const third = madeAttempts("third_down_conversions");
      const fourth = madeAttempts("fourth_down_conversions");
      console.log(
        `  RAW ${teamId ? teamId.slice(0, 8) : "(none)"} games=${games} rz=${rzPct.toFixed(1)} ints=${ints} fum=${fum} ` +
          `ints/g=${(ints / games).toFixed(2)} fum/g=${(fum / games).toFixed(2)} ` +
          `3rd=${third.pct != null ? third.pct.toFixed(1) + "%" : "n/a"} 4th=${fourth.pct != null ? fourth.pct.toFixed(1) + "%" : "n/a"} ` +
          `score=${Math.round(value * 100) / 100}`,
      );
      if (evaluatePayoutTier(value, definition.tiers)) {
        qualifying.push({ userId, teamId, score: Math.round(value * 100) / 100 });
      }
    }

    const teamIds = [...new Set(qualifying.map((q) => q.teamId).filter((id): id is string => Boolean(id)))];
    const teamNameById = new Map<string, string>();
    if (teamIds.length) {
      const teams = await client.from("rec_teams").select("id,name,display_nick,display_abbr").in("id", teamIds);
      if (teams.error) throw new Error(`load teams: ${JSON.stringify(teams.error)}`);
      for (const team of teams.data ?? []) {
        teamNameById.set(team.id, team.display_nick ?? team.display_abbr ?? team.name);
      }
    }

    const items = await client
      .from("rec_eos_payout_items")
      .select("id,status")
      .eq("league_id", league.id)
      .eq("season_number", season)
      .eq("payout_key", "defense_needs_a_name");
    if (items.error) throw new Error(`load payout items: ${JSON.stringify(items.error)}`);

    const nicks = await client
      .from("rec_team_defense_nicknames")
      .select("id")
      .eq("league_id", league.id)
      .in("team_id", teamIds)
      .eq("is_active", true);
    if (nicks.error) throw new Error(`load nicknames: ${JSON.stringify(nicks.error)}`);

    totalQualifying += qualifying.length;
    console.log(
      `— ${league.name} (${league.id.slice(0, 8)}), season ${season}: ${qualifying.length}/${byUser.size} user team(s) qualify` +
        ` [stage=${league.season_stage ?? "?"}, week=${league.current_week ?? "?"}]`,
    );
    for (const q of qualifying.sort((a, b) => b.score - a.score)) {
      const team = q.teamId ? (teamNameById.get(q.teamId) ?? q.teamId.slice(0, 8)) : "(no team)";
      console.log(`    ${team}: ${q.score}`);
      allQualifying.push({ league: league.name, season, team, score: q.score });
    }
    console.log(`    (EOS items drafted: ${(items.data ?? []).length}; active nicknames: ${(nicks.data ?? []).length})`);
  }

  console.log(`\nTOTAL qualifying user teams across ${leagueRows.length} CFB league(s): ${totalQualifying}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

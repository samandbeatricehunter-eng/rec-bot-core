import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";

const BOX_SCORE_SOURCES = ["box_score", "box_score_screenshot"];

export const EOS_AWARD_DEFINITIONS = [
  { key: "mvp", label: "MVP", amount: 1000, limit: 4 },
  { key: "best_passing_game", label: "Best Passing Game", amount: 200, limit: 4 },
  { key: "best_rushing_game", label: "Best Rushing Game", amount: 200, limit: 4 },
  { key: "best_defense", label: "Best Defense", amount: 200, limit: 4 },
  { key: "best_user_skills", label: "Best User Skills", amount: 350, limit: 8 },
  { key: "most_heart", label: "Most Heart", amount: 500, limit: 4 },
] as const;

type AwardKey = (typeof EOS_AWARD_DEFINITIONS)[number]["key"];
type Nominee = {
  userId: string;
  discordId: string | null;
  teamId: string;
  teamName: string;
  metric: number;
  detail: string;
};

function num(value: unknown) {
  return Number(value) || 0;
}

function teamName(team: any) {
  if (!team) return "Team";
  if (team.display_city || team.display_nick) return `${team.display_city ?? ""} ${team.display_nick ?? team.name}`.trim();
  return team.display_abbr ?? team.abbreviation ?? team.name ?? "Team";
}

async function linkedTeams(leagueId: string) {
  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,team:rec_teams(id,name,abbreviation,display_abbr,display_city,display_nick)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load linked teams for EOS awards.", assignments.error);

  const userIds = [...new Set((assignments.data ?? []).map((row: any) => row.user_id).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds)
    : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "Failed to load Discord accounts for EOS awards.", accounts.error);
  const discordByUser = new Map((accounts.data ?? []).map((row: any) => [row.user_id, row.discord_id]));

  return (assignments.data ?? []).map((row: any) => ({
    userId: row.user_id,
    teamId: row.team_id,
    teamName: teamName(row.team),
    discordId: discordByUser.get(row.user_id) ?? null,
  })).filter((row) => row.userId && row.teamId);
}

async function statsByUser(leagueId: string, seasonNumber: number) {
  const stats = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", 18)
    .not("user_id", "is", null);
  if (stats.error) throw new ApiError(500, "Failed to load EOS award stats.", stats.error);
  const byUser = new Map<string, any[]>();
  for (const row of stats.data ?? []) {
    const rows = byUser.get(row.user_id) ?? [];
    rows.push(row);
    byUser.set(row.user_id, rows);
  }
  return byUser;
}

async function resultAggByTeam(leagueId: string, seasonNumber: number) {
  const results = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,winning_team_id,losing_team_id,is_tie,source")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", 18);
  if (results.error) throw new ApiError(500, "Failed to load EOS award results.", results.error);
  const map = new Map<string, { wins: number; losses: number; ties: number; pf: number; pa: number; close: number }>();
  const get = (teamId: string) => {
    let row = map.get(teamId);
    if (!row) {
      row = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, close: 0 };
      map.set(teamId, row);
    }
    return row;
  };
  for (const game of results.data ?? []) {
    const home = game.home_team_id;
    const away = game.away_team_id;
    if (!home || !away) continue;
    const hs = num(game.home_score);
    const as = num(game.away_score);
    const margin = Math.abs(hs - as);
    const isBox = BOX_SCORE_SOURCES.includes(String(game.source));
    for (const [teamId, pf, pa] of [[home, hs, as], [away, as, hs]] as const) {
      const row = get(teamId);
      row.pf += pf;
      row.pa += pa;
      if (game.is_tie) row.ties += 1;
      else if (game.winning_team_id === teamId) row.wins += 1;
      else if (game.losing_team_id === teamId) row.losses += 1;
      if (isBox && margin <= 7) row.close += 1;
    }
  }
  return map;
}

function sumRows(rows: any[], key: string) {
  return rows.reduce((total, row) => total + num(row[key]), 0);
}

function rankNominees(base: Array<Omit<Nominee, "metric" | "detail">>, metrics: Map<string, { metric: number; detail: string }>, limit: number) {
  return base
    .map((row) => ({ ...row, metric: metrics.get(row.userId)?.metric ?? metrics.get(row.teamId)?.metric ?? 0, detail: metrics.get(row.userId)?.detail ?? metrics.get(row.teamId)?.detail ?? "No data" }))
    .filter((row) => row.metric > 0)
    .sort((a, b) => b.metric - a.metric || a.teamName.localeCompare(b.teamName))
    .slice(0, limit);
}

export async function prepareEosAwardNominees(input: { guildId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const linked = await linkedTeams(context.leagueId);
  const stats = await statsByUser(context.leagueId, seasonNumber);
  const results = await resultAggByTeam(context.leagueId, seasonNumber);

  const base = linked.map((row) => ({ userId: row.userId, discordId: row.discordId, teamId: row.teamId, teamName: row.teamName }));
  const byUserMetric = (fn: (rows: any[]) => { metric: number; detail: string }) => {
    const map = new Map<string, { metric: number; detail: string }>();
    for (const row of base) map.set(row.userId, fn(stats.get(row.userId) ?? []));
    return map;
  };

  const mvp = new Map<string, { metric: number; detail: string }>();
  for (const row of base) {
    const agg = results.get(row.teamId) ?? { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, close: 0 };
    const games = agg.wins + agg.losses + agg.ties;
    const pct = games ? (agg.wins + 0.5 * agg.ties) / games : 0;
    const pd = agg.pf - agg.pa;
    mvp.set(row.teamId, { metric: pct * 1000 + pd, detail: `${agg.wins}-${agg.losses}${agg.ties ? `-${agg.ties}` : ""}, PD ${pd}` });
  }

  const defense = byUserMetric((rows) => {
    const pointsAgainst = sumRows(rows, "points_against");
    const yardsAllowed = sumRows(rows, "yards_allowed");
    const turnovers = sumRows(rows, "generated_turnovers");
    return { metric: turnovers * 75 - pointsAgainst * 5 - yardsAllowed / 10, detail: `${pointsAgainst} PA, ${yardsAllowed} yds allowed, ${turnovers} takeaways` };
  });

  const close = new Map<string, { metric: number; detail: string }>();
  for (const row of base) {
    const agg = results.get(row.teamId) ?? { close: 0 };
    close.set(row.teamId, { metric: agg.close, detail: `${agg.close} close box-score game${agg.close === 1 ? "" : "s"}` });
  }

  const awards = EOS_AWARD_DEFINITIONS.map((definition) => {
    let nominees: Nominee[];
    if (definition.key === "mvp") nominees = rankNominees(base, mvp, definition.limit);
    else if (definition.key === "best_passing_game") nominees = rankNominees(base, byUserMetric((rows) => ({ metric: sumRows(rows, "off_pass_yards"), detail: `${sumRows(rows, "off_pass_yards")} pass yards` })), definition.limit);
    else if (definition.key === "best_rushing_game") nominees = rankNominees(base, byUserMetric((rows) => ({ metric: sumRows(rows, "off_rush_yards"), detail: `${sumRows(rows, "off_rush_yards")} rush yards` })), definition.limit);
    else if (definition.key === "best_defense") nominees = rankNominees(base, defense, definition.limit);
    else if (definition.key === "best_user_skills") nominees = rankNominees(base, defense, definition.limit);
    else nominees = rankNominees(base, close, definition.limit);
    return { ...definition, nominees };
  });

  return { league: { id: context.leagueId, seasonNumber, currentWeek: Number(context.rec_leagues.current_week ?? 1) }, awards };
}

export async function recordEosAwardPoll(input: {
  guildId: string;
  categoryKey: AwardKey;
  discordChannelId: string;
  discordMessageId: string;
  closesAt: string;
  nominees: Nominee[];
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const definition = EOS_AWARD_DEFINITIONS.find((award) => award.key === input.categoryKey);
  if (!definition) throw new ApiError(400, "Unknown EOS award category.");
  const row = await supabase
    .from("rec_eos_award_polls")
    .upsert({
      league_id: context.leagueId,
      season_number: seasonNumber,
      category_key: definition.key,
      category_label: definition.label,
      category_description: definition.label,
      award_amount: definition.amount,
      nominee_user_ids: input.nominees.map((nominee) => nominee.userId),
      nominee_payloads: input.nominees,
      status: "open",
      discord_channel_id: input.discordChannelId,
      discord_message_id: input.discordMessageId,
      closes_at: input.closesAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: "league_id,season_number,category_key" })
    .select("*")
    .single();
  if (row.error) throw new ApiError(500, "Failed to record EOS award poll.", row.error);
  return { poll: row.data };
}

export async function listOpenEosAwardPolls() {
  const polls = await supabase.from("rec_eos_award_polls").select("*").eq("status", "open").order("closes_at", { ascending: true });
  if (polls.error) throw new ApiError(500, "Failed to load open EOS award polls.", polls.error);
  const leagueIds = [...new Set((polls.data ?? []).map((poll: any) => poll.league_id).filter(Boolean))];
  const links = leagueIds.length
    ? await supabase.from("rec_server_league_links").select("league_id,server_id").in("league_id", leagueIds).eq("is_primary", true)
    : { data: [], error: null };
  if (links.error) throw new ApiError(500, "Failed to load EOS award servers.", links.error);
  const serverIds = [...new Set((links.data ?? []).map((row: any) => row.server_id).filter(Boolean))];
  const servers = serverIds.length
    ? await supabase.from("rec_discord_servers").select("id,guild_id").in("id", serverIds)
    : { data: [], error: null };
  if (servers.error) throw new ApiError(500, "Failed to load EOS award Discord servers.", servers.error);
  const guildByServer = new Map((servers.data ?? []).map((row: any) => [row.id, row.guild_id]));
  const guildByLeague = new Map((links.data ?? []).map((row: any) => [row.league_id, guildByServer.get(row.server_id)]));
  return { polls: (polls.data ?? []).map((poll: any) => ({ ...poll, guildId: guildByLeague.get(poll.league_id) ?? null })) };
}

export async function cancelOpenEosAwardPolls(input: { guildId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const existing = await supabase
    .from("rec_eos_award_polls")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("status", "open");
  if (existing.error) throw new ApiError(500, "Failed to load open EOS award polls.", existing.error);
  const ids = (existing.data ?? []).map((row: any) => row.id).filter(Boolean);
  if (ids.length) {
    const cancelled = await supabase
      .from("rec_eos_award_polls")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in("id", ids);
    if (cancelled.error) throw new ApiError(500, "Failed to cancel open EOS award polls.", cancelled.error);
  }
  return { cancelled: existing.data ?? [] };
}

export async function settleEosAwardPoll(input: { pollId: string; voteCounts: Record<string, number>; discordMessageId?: string | null }) {
  const poll = await supabase.from("rec_eos_award_polls").select("*").eq("id", input.pollId).maybeSingle();
  if (poll.error) throw new ApiError(500, "Failed to load EOS award poll.", poll.error);
  if (!poll.data) throw new ApiError(404, "EOS award poll not found.");
  if (poll.data.status === "settled") return { poll: poll.data, alreadySettled: true };
  if (poll.data.status !== "open") return { poll: poll.data, skipped: true, reason: "not_open" };
  if (input.discordMessageId && poll.data.discord_message_id !== input.discordMessageId) {
    return { poll: poll.data, skipped: true, reason: "message_mismatch" };
  }
  const nominees = Array.isArray(poll.data.nominee_payloads) ? poll.data.nominee_payloads : [];
  let winner = nominees[0] ?? null;
  let winnerVotes = -1;
  nominees.forEach((nominee: any, index: number) => {
    const votes = Number(input.voteCounts[String(index)] ?? 0);
    if (votes > winnerVotes) {
      winner = nominee;
      winnerVotes = votes;
    }
  });
  if (!winner?.userId) throw new ApiError(400, "EOS award poll has no nominees.");
  const amount = Number(poll.data.award_amount ?? 200);
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: winner.userId,
    p_amount: amount,
    p_league_id: poll.data.league_id,
    p_description: `EOS Award - ${poll.data.category_label}`,
    p_transaction_type: "eos_award_payout",
    p_source: "eos",
    p_source_reference: { pollId: poll.data.id, categoryKey: poll.data.category_key },
  });
  if (ledger.error) throw new ApiError(500, "Failed to issue EOS award payout.", ledger.error);
  const updated = await supabase
    .from("rec_eos_award_polls")
    .update({
      status: "settled",
      winner_user_id: winner.userId,
      locked_at: new Date().toISOString(),
      settled_at: new Date().toISOString(),
      paid_ledger_id: ledger.data,
      vote_counts: input.voteCounts,
      updated_at: new Date().toISOString(),
    })
    .eq("id", poll.data.id)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to settle EOS award poll.", updated.error);
  return { poll: updated.data, winner, amount, votes: winnerVotes };
}

export async function listSettledEosAwards(input: { guildId: string; seasonNumber?: number | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
  const rows = await supabase
    .from("rec_eos_award_polls")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("status", "settled")
    .order("category_key", { ascending: true });
  if (rows.error) throw new ApiError(500, "Failed to load settled EOS awards.", rows.error);
  return { seasonNumber, awards: rows.data ?? [] };
}

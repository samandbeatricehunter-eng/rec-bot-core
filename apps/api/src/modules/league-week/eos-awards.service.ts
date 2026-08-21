import { regularSeasonWeeks, formatCoins } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { publishTransitionStory } from "../hub/story-publishing.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";
import { getGlobalEconomyConfig } from "../economy/global-economy-config.service.js";
import { computeUserRatings } from "./ratings.service.js";

const BOX_SCORE_SOURCES = ["box_score", "box_score_screenshot"];

// Auto-issued at season end — no poll, straight to the top-1 team by the stat.
export const EOS_AUTO_AWARD_DEFINITIONS = [
  { key: "best_passing_game", label: "Season Passing Leader", amount: 1000 },
  { key: "best_rushing_game", label: "Season Rushing Leader", amount: 1000 },
  { key: "best_defense", label: "Season Defensive Leader", amount: 1000 },
  { key: "mvp", label: "League MVP", amount: 5000 },
] as const;

// Web-hub poll categories — the only two that still require a vote.
export const EOS_POLL_AWARD_DEFINITIONS = [
  { key: "best_user_skills", label: "Most Skilled User", amount: 2000, limit: 10 },
  { key: "most_heart", label: "Most Heart", amount: 2500, limit: 32 },
] as const;

export const EOS_AWARD_DEFINITIONS = [...EOS_AUTO_AWARD_DEFINITIONS, ...EOS_POLL_AWARD_DEFINITIONS];

async function configuredAwardAmount(key: string, fallback: number) {
  const awards = (await getGlobalEconomyConfig()).awards;
  const map: Record<string, number> = { best_passing_game: awards.bestPassing, best_rushing_game: awards.bestRushing, best_defense: awards.bestDefense, mvp: awards.mvp, best_user_skills: awards.mostSkilled, most_heart: awards.mostHeart };
  return map[key] ?? fallback;
}

type AwardKey = (typeof EOS_AWARD_DEFINITIONS)[number]["key"];

function awardLabel(key: AwardKey, _game: string | null): string {
  return EOS_AWARD_DEFINITIONS.find((award) => award.key === key)?.label ?? key;
}
type Nominee = {
  userId: string;
  discordId: string | null;
  displayName: string;
  teamId: string;
  teamName: string;
  record: string;
  pointDifferential: number;
  metric: number;
  detail: string;
};

function num(value: unknown) {
  return Number(value) || 0;
}

function teamName(team: any) {
  if (!team) return "Team";
  const name = (team.name ?? "").trim();
  const nick = (team.display_nick ?? "").trim();
  if (team.is_relocated) {
    if (name && (!nick || name.toLowerCase() !== nick.toLowerCase())) return name;
    const combined = `${team.display_city ?? ""} ${nick}`.trim();
    if (combined) return combined;
  }
  return name || nick || team.display_abbr || team.abbreviation || "Team";
}

async function linkedTeams(leagueId: string) {
  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,team:rec_teams(id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "We couldn't load linked teams for end-of-season awards. Please try again.", assignments.error);

  const userIds = [...new Set((assignments.data ?? []).map((row: any) => row.user_id).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name,user:rec_users(username,display_name)").in("user_id", userIds)
    : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "We couldn't load Discord accounts for end-of-season awards. Please try again.", accounts.error);
  const discordByUser = new Map((accounts.data ?? []).map((row: any) => [row.user_id, row.discord_id]));
  const nameByUser = new Map<string, string>((accounts.data ?? []).map((row: any): [string, string] => {
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    return [row.user_id, user?.username || user?.display_name || row.global_name || row.username || "REC Member"];
  }));

  return (assignments.data ?? []).map((row: any) => ({
    userId: row.user_id,
    teamId: row.team_id,
    teamName: teamName(row.team),
    discordId: discordByUser.get(row.user_id) ?? null,
    displayName: nameByUser.get(row.user_id) ?? "REC Member",
  })).filter((row) => row.userId && row.teamId);
}

async function statsByUser(leagueId: string, seasonNumber: number, game: string | null) {
  const stats = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", regularSeasonWeeks(game))
    .not("user_id", "is", null);
  if (stats.error) throw new ApiError(500, "We couldn't load end-of-season award stats. Please try again.", stats.error);
  const byUser = new Map<string, any[]>();
  for (const row of stats.data ?? []) {
    const rows = byUser.get(row.user_id) ?? [];
    rows.push(row);
    byUser.set(row.user_id, rows);
  }
  return byUser;
}

async function engagementScoreByUser(leagueId: string, seasonNumber: number, userIds: string[], seasonWeeks: number) {
  if (!userIds.length) return new Map<string, { count: number; percent: number }>();
  const [media, streams, highlights, gotwVotes] = await Promise.all([
    supabase.from("rec_media_submissions").select("submitter_user_id,week_number,submission_type,status").eq("league_id", leagueId).eq("season_number", seasonNumber).in("submitter_user_id", userIds).neq("status", "denied"),
    supabase.from("rec_stream_payout_reviews").select("user_id,week_number,status").eq("league_id", leagueId).eq("season_number", seasonNumber).in("user_id", userIds).neq("status", "denied"),
    supabase.from("rec_highlight_posts").select("user_id,week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).in("user_id", userIds),
    supabase.from("rec_game_of_week_votes").select("user_id,week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).in("user_id", userIds),
  ]);
  const completed = new Map<string, Set<string>>(userIds.map((id) => [id, new Set<string>()]));
  for (const row of media.data ?? []) completed.get(row.submitter_user_id)?.add(`${row.week_number}:${row.submission_type}`);
  for (const row of streams.data ?? []) completed.get(row.user_id)?.add(`${row.week_number}:stream`);
  const highlightCounts = new Map<string, number>();
  for (const row of highlights.data ?? []) {
    const key = `${row.user_id}:${row.week_number}`;
    highlightCounts.set(key, Math.min(2, (highlightCounts.get(key) ?? 0) + 1));
  }
  for (const [key, count] of highlightCounts) for (let i = 1; i <= count; i += 1) completed.get(key.split(":")[0])?.add(`${key.split(":")[1]}:highlight:${i}`);
  for (const row of gotwVotes.data ?? []) if (row.user_id) completed.get(row.user_id)?.add(`${row.week_number}:gotw_vote`);
  const possible = Math.max(1, seasonWeeks * 6); // interview, article, stream, 2 highlights, GOTW vote
  return new Map(userIds.map((id) => {
    const count = completed.get(id)?.size ?? 0;
    return [id, { count, percent: Math.min(100, count / possible * 100) }];
  }));
}

type TeamGameLog = { opponentTeamId: string; won: boolean; margin: number };
type TeamResultAgg = { wins: number; losses: number; ties: number; pf: number; pa: number; close: number; games: TeamGameLog[] };

async function resultAggByTeam(leagueId: string, seasonNumber: number, game: string | null): Promise<Map<string, TeamResultAgg>> {
  const results = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,winning_team_id,losing_team_id,is_tie,source")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", regularSeasonWeeks(game));
  if (results.error) throw new ApiError(500, "We couldn't load end-of-season award results. Please try again.", results.error);
  const map = new Map<string, TeamResultAgg>();
  const get = (teamId: string) => {
    let row = map.get(teamId);
    if (!row) {
      row = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, close: 0, games: [] };
      map.set(teamId, row);
    }
    return row;
  };
  for (const g of results.data ?? []) {
    const home = g.home_team_id;
    const away = g.away_team_id;
    if (!home || !away) continue;
    const hs = num(g.home_score);
    const as = num(g.away_score);
    const margin = Math.abs(hs - as);
    const isBox = BOX_SCORE_SOURCES.includes(String(g.source));
    for (const [teamId, opponentTeamId, pf, pa] of [[home, away, hs, as], [away, home, as, hs]] as const) {
      const row = get(teamId);
      row.pf += pf;
      row.pa += pa;
      if (g.is_tie) row.ties += 1;
      else if (g.winning_team_id === teamId) row.wins += 1;
      else if (g.losing_team_id === teamId) row.losses += 1;
      if (isBox && margin <= 7) row.close += 1;
      if (!g.is_tie) row.games.push({ opponentTeamId, won: g.winning_team_id === teamId, margin });
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
    .filter((row) => metrics.has(row.userId) || metrics.has(row.teamId))
    .sort((a, b) => b.metric - a.metric || a.teamName.localeCompare(b.teamName))
    .slice(0, limit);
}

/**
 * "Most Heart": teams that competed hard but didn't win enough (or didn't win the
 * games that mattered) — not the league's best team, and not a true tank job either.
 * Eligibility: win% between 30-60%. Score rewards close losses and close wins
 * (competitive every week), a bonus for losing to a better-ranked opponent (a
 * "quality loss" isn't a bad look), and a penalty for blowout losses (getting run
 * over isn't heart). Uses only stats both Madden and CFB track identically
 * (points, wins/losses, season-end power rank), so one formula covers both games.
 */
function mostHeartMetric(agg: TeamResultAgg, powerRankByTeam: Map<string, number>, teamId: string): { metric: number; detail: string } | null {
  const games = agg.wins + agg.losses + agg.ties;
  if (!games) return null;
  const winPct = agg.wins / games;
  if (winPct < 0.3 || winPct > 0.6) return null;

  const myRank = powerRankByTeam.get(teamId) ?? 999;
  let closeLosses = 0, closeWins = 0, qualityLosses = 0, blowoutLosses = 0;
  for (const g of agg.games) {
    if (g.won) {
      if (g.margin <= 7) closeWins += 1;
    } else {
      if (g.margin <= 7) closeLosses += 1;
      if (g.margin >= 21) blowoutLosses += 1;
      const oppRank = powerRankByTeam.get(g.opponentTeamId) ?? 999;
      if (oppRank < myRank) qualityLosses += 1;
    }
  }
  const score = closeLosses * 3 + closeWins * 1 + qualityLosses * 2 - blowoutLosses * 1;
  return { metric: score, detail: `${agg.wins}-${agg.losses}${agg.ties ? `-${agg.ties}` : ""}, ${closeLosses} close loss${closeLosses === 1 ? "" : "es"}, ${qualityLosses} quality loss${qualityLosses === 1 ? "" : "es"}` };
}

/** Builds the Most Skilled top-ten ballot and the league-wide Most Heart ballot. */
export async function prepareEosAwardNominees(input: { guildId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const linked = await linkedTeams(context.leagueId);
  const results = await resultAggByTeam(context.leagueId, seasonNumber, context.rec_leagues.game);
  const ratings = await computeUserRatings(input.guildId).catch(() => ({ users: [] as any[] }));

  const base = linked.map((row) => {
    const agg = results.get(row.teamId) ?? { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, close: 0, games: [] };
    const record = `${agg.wins}-${agg.losses}${agg.ties ? `-${agg.ties}` : ""}`;
    const pointDifferential = agg.pf - agg.pa;
    return { userId: row.userId, discordId: row.discordId, teamId: row.teamId, teamName: row.teamName, record, pointDifferential };
  });

  const mostHeart = new Map<string, { metric: number; detail: string }>(base.map((row): [string, { metric: number; detail: string }] => [row.teamId, { metric: 1, detail: "League-wide user vote" }]));
  const ratingByUser = new Map<string, number>((ratings.users ?? []).map((row: any): [string, number] => [String(row.userId), Number(row.rating ?? 0)]));
  const mostSkilled = new Map<string, { metric: number; detail: string }>();
  for (const row of base) {
    const agg = results.get(row.teamId);
    const games = agg ? agg.wins + agg.losses + agg.ties : 0;
    const winPct = games ? (agg!.wins + agg!.ties * 0.5) / games : 0;
    const userScore = ratingByUser.get(row.userId) ?? 0;
    mostSkilled.set(row.userId, { metric: userScore * winPct, detail: `User Score ${userScore.toFixed(1)} × ${(winPct * 100).toFixed(1)}% win rate` });
  }

  const awards = EOS_POLL_AWARD_DEFINITIONS.map((definition) => {
    const nominees = definition.key === "most_heart" ? rankNominees(base, mostHeart, definition.limit) : rankNominees(base, mostSkilled, definition.limit);
    return { ...definition, label: awardLabel(definition.key, context.rec_leagues.game), nominees };
  });

  return { league: { id: context.leagueId, seasonNumber, currentWeek: Number(context.rec_leagues.current_week ?? 1) }, awards };
}

/** Auto-issues Best Passing/Rushing/Defense to the single top team each — no poll, no commissioner action needed. */
export async function autoIssueStatBasedAwards(guildId: string): Promise<{ issued: number }> {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const linked = await linkedTeams(context.leagueId);
  const stats = await statsByUser(context.leagueId, seasonNumber, context.rec_leagues.game);
  const results = await resultAggByTeam(context.leagueId, seasonNumber, context.rec_leagues.game);
  const rankings = await computePowerRankings(guildId).catch(() => ({ teams: [] as any[] }));
  const rankByTeam = new Map<string, number>((rankings.teams ?? []).map((row: any): [string, number] => [String(row.teamId), Number(row.rank)]));
  const engagement = await engagementScoreByUser(context.leagueId, seasonNumber, linked.map((row) => row.userId), regularSeasonWeeks(context.rec_leagues.game));
  const teamCount = Math.max(1, linked.length);
  const seasonTotals = new Map<string, { takeaways: number; yardsAllowed: number; pointDifferential: number }>(linked.map((row): [string, { takeaways: number; yardsAllowed: number; pointDifferential: number }] => {
    const rows = stats.get(row.userId) ?? [];
    const result = results.get(row.teamId);
    return [row.userId, { takeaways: sumRows(rows, "generated_turnovers"), yardsAllowed: sumRows(rows, "yards_allowed"), pointDifferential: result ? result.pf - result.pa : 0 }];
  }));
  const yardsRank = new Map([...seasonTotals.entries()].sort((a, b) => a[1].yardsAllowed - b[1].yardsAllowed).map(([id], index) => [id, index + 1]));
  const differentialRank = new Map([...seasonTotals.entries()].sort((a, b) => b[1].pointDifferential - a[1].pointDifferential).map(([id], index) => [id, index + 1]));

  const metricFor = (key: (typeof EOS_AUTO_AWARD_DEFINITIONS)[number]["key"], userId: string, teamId: string, rows: any[]) => {
    if (key === "best_passing_game") return sumRows(rows, "off_pass_yards");
    if (key === "best_rushing_game") return sumRows(rows, "off_rush_yards");
    if (key === "mvp") {
      const engagementPercent = engagement.get(userId)?.percent ?? 0;
      const rank = rankByTeam.get(teamId) ?? teamCount;
      const powerPercent = teamCount <= 1 ? 100 : (teamCount - rank) / (teamCount - 1) * 100;
      return engagementPercent * 0.6 + powerPercent * 0.4;
    }
    // Defensive score: takeaways multiplied by up to 2x based equally on yards-allowed
    // rank and point-differential rank. Ranking percentiles keep the formula fair in leagues
    // with fewer than 32 linked teams.
    const totals = seasonTotals.get(userId) ?? { takeaways: 0 };
    const yardsPercent = teamCount <= 1 ? 1 : (teamCount - (yardsRank.get(userId) ?? teamCount)) / (teamCount - 1);
    const differentialPercent = teamCount <= 1 ? 1 : (teamCount - (differentialRank.get(userId) ?? teamCount)) / (teamCount - 1);
    return totals.takeaways * (1 + yardsPercent * 0.5 + differentialPercent * 0.5);
  };

  let issued = 0;
  for (const definition of EOS_AUTO_AWARD_DEFINITIONS) {
    const awardAmount = await configuredAwardAmount(definition.key, definition.amount);
    const existing = await supabase.from("rec_eos_award_polls").select("id").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("category_key", definition.key).maybeSingle();
    if (existing.error) throw new ApiError(500, "We couldn't check for an existing auto-issued award. Please try again.", existing.error);
    if (existing.data) continue; // already issued this season — never re-run

    let best: { userId: string; teamId: string; metric: number } | null = null;
    for (const row of linked) {
      const metric = metricFor(definition.key, row.userId, row.teamId, stats.get(row.userId) ?? []);
      if (!best || metric > best.metric) best = { userId: row.userId, teamId: row.teamId, metric };
    }
    if (!best) continue;

    const label = awardLabel(definition.key, context.rec_leagues.game);
    const credit = await creditOrBacklog({
      leagueId: context.leagueId,
      seasonNumber,
      userId: best.userId,
      amount: awardAmount,
      description: `EOS Award - ${label}`,
      transactionType: "eos_award_payout",
      source: "eos",
      sourceReference: { category: definition.key, season: seasonNumber, autoIssued: true },
    });

    const inserted = await supabase.from("rec_eos_award_polls").insert({
      league_id: context.leagueId, season_number: seasonNumber, category_key: definition.key, category_label: label,
      category_description: label, award_amount: awardAmount, nominee_user_ids: [best.userId], nominee_payloads: [],
      status: "settled", winner_user_id: best.userId, opened_at: new Date().toISOString(), settled_at: new Date().toISOString(),
      paid_ledger_id: credit.ledgerId, vote_counts: {}, updated_at: new Date().toISOString(),
    }).select("id").single();
    if (inserted.error) throw new ApiError(500, `We couldn't record the auto-issued ${label}. Please try again.`, inserted.error);

    await publishTransitionStory({
      guildId,
      headline: `${label}: ${linked.find((t) => t.userId === best!.userId)?.teamName ?? "A program"}`,
      body: `${label} is auto-awarded to ${linked.find((t) => t.userId === best!.userId)?.teamName ?? "the team"} for their season-long performance.`,
      primaryAngle: "eos_award",
    }).catch((error) => console.error(`[ERROR] Failed to publish ${label} headline (non-fatal):`, error));

    issued += 1;
  }
  return { issued };
}

export async function recordEosAwardPoll(input: {
  guildId: string;
  categoryKey: AwardKey;
  discordChannelId?: string | null;
  discordMessageId?: string | null;
  closesAt?: string | null;
  nominees: Nominee[];
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const definition = EOS_AWARD_DEFINITIONS.find((award) => award.key === input.categoryKey);
  if (!definition) throw new ApiError(400, "Unknown EOS award category.");
  const label = awardLabel(definition.key, context.rec_leagues.game);
  const awardAmount = await configuredAwardAmount(definition.key, definition.amount);
  const row = await supabase
    .from("rec_eos_award_polls")
    .upsert({
      league_id: context.leagueId,
      season_number: seasonNumber,
      category_key: definition.key,
      category_label: label,
      category_description: label,
      award_amount: awardAmount,
      nominee_user_ids: input.nominees.map((nominee) => nominee.userId),
      nominee_payloads: input.nominees,
      status: "open",
      discord_channel_id: input.discordChannelId ?? null,
      discord_message_id: input.discordMessageId ?? null,
      closes_at: input.closesAt ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "league_id,season_number,category_key" })
    .select("*")
    .single();
  if (row.error) throw new ApiError(500, "We couldn't create that end-of-season award poll. Please try again.", row.error);

  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: context.leagueId,
    season_number: seasonNumber,
    week_number: null,
    queue_type: "eos_award",
    status: "pending",
    priority: 0,
    header: `EOS Award: ${label}`,
    summary: `Voting open for ${label} (${row.data.nominee_payloads?.length ?? input.nominees.length} nominees).`,
    requester_discord_id: null,
    requester_user_id: null,
    amount: definition.amount,
    source_table: "rec_eos_award_polls",
    source_id: row.data.id,
    payload: { pollId: row.data.id, categoryKey: definition.key },
  });
  void notifyLeagueCommissionersOfPendingItem(context.leagueId);

  return { poll: row.data };
}

/** Opens the 3 web-vote polls for the season, plus auto-issues the 3 stat-based awards. Call once when the league advances into the offseason. */
export async function autoPrepareEosAwards(guildId: string): Promise<{ autoIssued: number; pollsOpened: number }> {
  const { issued: autoIssued } = await autoIssueStatBasedAwards(guildId);
  const { awards } = await prepareEosAwardNominees({ guildId });
  let pollsOpened = 0;
  for (const award of awards) {
    if (!award.nominees.length) continue;
    await recordEosAwardPoll({ guildId, categoryKey: award.key, nominees: award.nominees });
    pollsOpened += 1;
  }
  return { autoIssued, pollsOpened };
}

export async function listOpenEosAwardPolls() {
  const polls = await supabase.from("rec_eos_award_polls").select("*").eq("status", "open").order("closes_at", { ascending: true });
  if (polls.error) throw new ApiError(500, "We couldn't load open end-of-season award polls. Please try again.", polls.error);
  const leagueIds = [...new Set((polls.data ?? []).map((poll: any) => poll.league_id).filter(Boolean))];
  const links = leagueIds.length
    ? await supabase.from("rec_server_league_links").select("league_id,server_id").in("league_id", leagueIds).eq("is_primary", true)
    : { data: [], error: null };
  if (links.error) throw new ApiError(500, "We couldn't load end-of-season award servers. Please try again.", links.error);
  const serverIds = [...new Set((links.data ?? []).map((row: any) => row.server_id).filter(Boolean))];
  const servers = serverIds.length
    ? await supabase.from("rec_discord_servers").select("id,guild_id").in("id", serverIds)
    : { data: [], error: null };
  if (servers.error) throw new ApiError(500, "We couldn't load end-of-season award Discord servers. Please try again.", servers.error);
  const guildByServer = new Map((servers.data ?? []).map((row: any) => [row.id, row.guild_id]));
  const guildByLeague = new Map((links.data ?? []).map((row: any) => [row.league_id, guildByServer.get(row.server_id)]));
  return { polls: (polls.data ?? []).map((poll: any) => ({ ...poll, guildId: guildByLeague.get(poll.league_id) ?? null })) };
}

// Single-poll fetch for the web dashboard's settle form (the Discord flow only ever needs
// the bulk "all open polls" list above).
export async function getEosAwardPoll(pollId: string) {
  const poll = await supabase.from("rec_eos_award_polls").select("*").eq("id", pollId).maybeSingle();
  if (poll.error) throw new ApiError(500, "We couldn't load that end-of-season award poll. Please try again.", poll.error);
  if (!poll.data) throw new ApiError(404, "EOS award poll not found.");
  return { poll: poll.data };
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
  if (existing.error) throw new ApiError(500, "We couldn't load open end-of-season award polls. Please try again.", existing.error);
  const ids = (existing.data ?? []).map((row: any) => row.id).filter(Boolean);
  if (ids.length) {
    const cancelled = await supabase
      .from("rec_eos_award_polls")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in("id", ids);
    if (cancelled.error) throw new ApiError(500, "We couldn't cancel open end-of-season award polls. Please try again.", cancelled.error);
    const now = new Date().toISOString();
    await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "cancelled", reviewed_at: now })
      .eq("source_table", "rec_eos_award_polls")
      .in("source_id", ids);
  }
  return { cancelled: existing.data ?? [] };
}

// ─── Web voting ─────────────────────────────────────────────────────────────────

/** Casts (or changes) the calling user's vote for one open poll. One vote per user per category. */
export async function castEosAwardVote(input: { guildId: string; discordId: string; pollId: string; nomineeUserId: string }): Promise<{ ok: true }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!account.data?.user_id) throw new ApiError(404, "Discord account not linked.");

  const poll = await supabase.from("rec_eos_award_polls").select("id,league_id,status,nominee_user_ids").eq("id", input.pollId).maybeSingle();
  if (poll.error) throw new ApiError(500, "We couldn't load that award poll. Please try again.", poll.error);
  if (!poll.data || poll.data.league_id !== context.leagueId) throw new ApiError(404, "Award poll not found.");
  if (poll.data.status !== "open") throw new ApiError(400, "Voting has closed for this award.");
  const nomineeIds = Array.isArray(poll.data.nominee_user_ids) ? poll.data.nominee_user_ids : [];
  if (!nomineeIds.includes(input.nomineeUserId)) throw new ApiError(400, "That nominee isn't part of this award.");
  if (input.nomineeUserId === account.data.user_id) throw new ApiError(400, "You cannot vote for yourself.");

  const upserted = await supabase.from("rec_eos_award_votes").upsert(
    { poll_id: input.pollId, voter_user_id: account.data.user_id, nominee_user_id: input.nomineeUserId, updated_at: new Date().toISOString() },
    { onConflict: "poll_id,voter_user_id" },
  );
  if (upserted.error) throw new ApiError(500, "We couldn't cast your vote. Please try again.", upserted.error);
  return { ok: true };
}

export type EosBallotSessionInfo = { status: "draft" | "submitted"; lastPollId: string | null; submittedAt: string | null };

async function resolveEosVoterUserId(discordId: string): Promise<string | null> {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  return account.data?.user_id ?? null;
}

// Ballot-session tracking layered on top of the per-category auto-save above (castEosAwardVote)
// — resume position (last_poll_id) and an explicit submitted milestone, not a duplicate of the
// vote data itself.
export async function getOrStartEosBallotSession(guildId: string, discordId: string): Promise<EosBallotSessionInfo | null> {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const userId = await resolveEosVoterUserId(discordId);
  if (!userId) return null;

  const existing = await supabase
    .from("rec_eos_ballot_sessions")
    .select("status,last_poll_id,submitted_at")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("voter_user_id", userId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't load the ballot session. Please try again.", existing.error);
  if (existing.data) return { status: existing.data.status, lastPollId: existing.data.last_poll_id, submittedAt: existing.data.submitted_at };

  const inserted = await supabase
    .from("rec_eos_ballot_sessions")
    .insert({ league_id: context.leagueId, season_number: seasonNumber, voter_user_id: userId })
    .select("status,last_poll_id,submitted_at")
    .single();
  if (inserted.error) throw new ApiError(500, "We couldn't start the ballot session. Please try again.", inserted.error);
  return { status: inserted.data.status, lastPollId: inserted.data.last_poll_id, submittedAt: inserted.data.submitted_at };
}

export async function advanceEosBallotSession(input: { guildId: string; discordId: string; pollId: string }): Promise<{ ok: true }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const userId = await resolveEosVoterUserId(input.discordId);
  if (!userId) throw new ApiError(404, "Discord account not linked.");
  const { error } = await supabase.from("rec_eos_ballot_sessions").upsert(
    { league_id: context.leagueId, season_number: seasonNumber, voter_user_id: userId, last_poll_id: input.pollId, updated_at: new Date().toISOString() },
    { onConflict: "league_id,season_number,voter_user_id" },
  );
  if (error) throw new ApiError(500, "We couldn't update ballot progress. Please try again.", error);
  return { ok: true };
}

export async function submitEosBallot(guildId: string, discordId: string): Promise<{ ok: true }> {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const userId = await resolveEosVoterUserId(discordId);
  if (!userId) throw new ApiError(404, "Discord account not linked.");
  const now = new Date().toISOString();
  const { error } = await supabase.from("rec_eos_ballot_sessions").upsert(
    { league_id: context.leagueId, season_number: seasonNumber, voter_user_id: userId, status: "submitted", submitted_at: now, updated_at: now },
    { onConflict: "league_id,season_number,voter_user_id" },
  );
  if (error) throw new ApiError(500, "We couldn't submit your ballot. Please try again.", error);
  return { ok: true };
}

/**
 * Drives the collapsed voting block on the hub main page: every open poll for the
 * league, this user's current pick per poll, live tallies, and whether they've voted
 * on everything yet (the flashing-label trigger).
 */
export async function getEosAwardVotingBlock(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  const userId = account.data?.user_id ?? null;

  const polls = await supabase.from("rec_eos_award_polls").select("*").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("status", "open");
  if (polls.error) throw new ApiError(500, "We couldn't load open end-of-season award polls. Please try again.", polls.error);
  const openPolls = polls.data ?? [];
  if (!openPolls.length) return { polls: [], hasVotedAll: true };

  const pollIds = openPolls.map((poll: any) => poll.id);
  const votes = await supabase.from("rec_eos_award_votes").select("poll_id,voter_user_id,nominee_user_id").in("poll_id", pollIds);
  if (votes.error) throw new ApiError(500, "We couldn't load end-of-season award votes. Please try again.", votes.error);

  const tallyByPoll = new Map<string, Map<string, number>>();
  const myVoteByPoll = new Map<string, string>();
  for (const vote of votes.data ?? []) {
    const tally = tallyByPoll.get(vote.poll_id) ?? new Map<string, number>();
    tally.set(vote.nominee_user_id, (tally.get(vote.nominee_user_id) ?? 0) + 1);
    tallyByPoll.set(vote.poll_id, tally);
    if (userId && vote.voter_user_id === userId) myVoteByPoll.set(vote.poll_id, vote.nominee_user_id);
  }

  return {
    polls: openPolls.map((poll: any) => ({
      id: poll.id,
      categoryKey: poll.category_key,
      categoryLabel: poll.category_label,
      amount: poll.award_amount,
      nominees: (poll.nominee_payloads ?? []).filter((nominee: any) => nominee.userId !== userId).map((nominee: any) => ({ ...nominee, votes: tallyByPoll.get(poll.id)?.get(nominee.userId) ?? 0 })),
      myVote: myVoteByPoll.get(poll.id) ?? null,
    })),
    hasVotedAll: userId ? openPolls.every((poll: any) => myVoteByPoll.has(poll.id)) : false,
  };
}

/**
 * Votes decide the winner. Raw vote count is the primary ranking — a self-vote is
 * still a real vote and must not be zeroed out of contention. Ties are broken in
 * two stages, both scoped to *only* the tied nominees: first by vote count with
 * each nominee's own self-vote discounted (rewards outside support when several
 * nominees are tied on raw votes, e.g. everyone got exactly their own self-vote),
 * then — if still tied — by the underlying season-stat metric used to build the
 * nominee list. Stats never override an outright vote leader.
 */
export async function settleEosAwardPoll(input: { pollId: string; voteCounts: Record<string, number>; voterDiscordIds?: Record<string, string[]>; discordMessageId?: string | null }) {
  const poll = await supabase.from("rec_eos_award_polls").select("*").eq("id", input.pollId).maybeSingle();
  if (poll.error) throw new ApiError(500, "We couldn't load that end-of-season award poll. Please try again.", poll.error);
  if (!poll.data) throw new ApiError(404, "EOS award poll not found.");
  if (poll.data.status === "settled") return { poll: poll.data, alreadySettled: true };
  if (poll.data.status !== "open") return { poll: poll.data, skipped: true, reason: "not_open" };
  if (input.discordMessageId && poll.data.discord_message_id !== input.discordMessageId) {
    return { poll: poll.data, skipped: true, reason: "message_mismatch" };
  }
  const nominees = Array.isArray(poll.data.nominee_payloads) ? poll.data.nominee_payloads : [];
  if (!nominees.length) throw new ApiError(400, "EOS award poll has no nominees.");

  const voterDiscordIds = input.voterDiscordIds ?? {};
  const scored: Array<{ nominee: any; rawVotes: number; netVotes: number }> = nominees.map((nominee: any, index: number) => {
    const rawVotes = Number(input.voteCounts[String(index)] ?? 0);
    const voters = voterDiscordIds[String(index)] ?? [];
    const selfVoted = Boolean(nominee.discordId) && voters.includes(nominee.discordId);
    return { nominee, rawVotes, netVotes: selfVoted ? Math.max(0, rawVotes - 1) : rawVotes };
  });

  const topRawVotes = Math.max(...scored.map((row) => row.rawVotes));
  const rawTied = scored.filter((row) => row.rawVotes === topRawVotes);
  let finalists = rawTied;
  let tiebreakerNeeded = finalists.length > 1;

  if (tiebreakerNeeded) {
    const topNetVotes = Math.max(...finalists.map((row) => row.netVotes));
    finalists = finalists.filter((row) => row.netVotes === topNetVotes);
    tiebreakerNeeded = finalists.length > 1;
  }
  if (tiebreakerNeeded) {
    const topMetric = Math.max(...finalists.map((row) => Number(row.nominee.metric ?? 0)));
    finalists = finalists.filter((row) => Number(row.nominee.metric ?? 0) === topMetric);
  }
  const winner = finalists[0]?.nominee ?? null;
  if (!winner?.userId) throw new ApiError(400, "EOS award poll has no nominees.");
  const amount = Number(poll.data.award_amount ?? 200);
  const credit = await creditOrBacklog({
    leagueId: poll.data.league_id,
    seasonNumber: poll.data.season_number,
    userId: winner.userId,
    amount,
    description: `EOS Award - ${poll.data.category_label}`,
    transactionType: "eos_award_payout",
    source: "eos",
    sourceReference: { pollId: poll.data.id, categoryKey: poll.data.category_key },
  });
  const updated = await supabase
    .from("rec_eos_award_polls")
    .update({
      status: "settled",
      winner_user_id: winner.userId,
      locked_at: new Date().toISOString(),
      settled_at: new Date().toISOString(),
      paid_ledger_id: credit.ledgerId,
      vote_counts: input.voteCounts,
      tiebreaker_needed: tiebreakerNeeded,
      tied_candidate_ids: tiebreakerNeeded ? rawTied.map((row) => row.nominee.userId) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", poll.data.id)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "We couldn't settle that end-of-season award poll. Please try again.", updated.error);

  // The inbox row's summary/payload are set once at poll-creation time ("Voting open for
  // X (5 nominees)") and were never touched again on settlement — so the Approved & Issued
  // list kept showing the pre-vote placeholder text forever instead of who actually won.
  await supabase
    .from("rec_commissioners_inbox")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      summary: `${poll.data.category_label} winner: ${winner.displayName ?? "REC Member"} (${winner.teamName ?? "Team"}) — ${formatCoins(amount)}${tiebreakerNeeded ? ", settled by tiebreaker" : ""}.`,
      payload: { pollId: poll.data.id, categoryKey: poll.data.category_key, winnerUserId: winner.userId, winnerName: winner.displayName ?? null, winnerTeamName: winner.teamName ?? null, amount },
    })
    .eq("source_table", "rec_eos_award_polls")
    .eq("source_id", poll.data.id);

  return { poll: updated.data, winner, amount, votes: topRawVotes, tiebreakerNeeded };
}

// Tallies rec_eos_award_votes for one poll and settles it — the single source of truth
// for both voting surfaces. Discord native-poll voters are merged into rec_eos_award_votes
// (see recordEosAwardPollVotesFromDiscord) before this ever runs, so it never needs to know
// which surface a given vote came from.
async function settlePollFromWebVotes(guildId: string, poll: any): Promise<boolean> {
  const votes = await supabase.from("rec_eos_award_votes").select("voter_user_id,nominee_user_id").eq("poll_id", poll.id);
  if (votes.error) throw new ApiError(500, "We couldn't load end-of-season award votes. Please try again.", votes.error);
  const nominees = Array.isArray(poll.nominee_payloads) ? poll.nominee_payloads : [];
  const voteCounts: Record<string, number> = {};
  const voterDiscordIds: Record<string, string[]> = {};

  const voterUserIds = [...new Set((votes.data ?? []).map((v: any) => v.voter_user_id))];
  const accounts = voterUserIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", voterUserIds)
    : { data: [], error: null };
  const discordIdByUserId = new Map((accounts.data ?? []).map((row: any) => [row.user_id, row.discord_id]));

  nominees.forEach((nominee: any, index: number) => {
    const nomineeVotes = (votes.data ?? []).filter((v: any) => v.nominee_user_id === nominee.userId);
    voteCounts[String(index)] = nomineeVotes.length;
    voterDiscordIds[String(index)] = nomineeVotes.map((v: any) => discordIdByUserId.get(v.voter_user_id)).filter(Boolean) as string[];
  });
  // No votes cast at all: fall back to the underlying stat metric (already on each
  // nominee) rather than leaving the award unpaid — someone still earned the nomination.
  if (Object.values(voteCounts).every((count) => count === 0)) {
    let bestIndex = 0;
    nominees.forEach((nominee: any, index: number) => { if (Number(nominee.metric ?? 0) > Number(nominees[bestIndex]?.metric ?? -Infinity)) bestIndex = index; });
    voteCounts[String(bestIndex)] = 1;
  }
  const result = await settleEosAwardPoll({ pollId: poll.id, voteCounts, voterDiscordIds });
  if ("winner" in result && result.winner) {
    await publishTransitionStory({
      guildId,
      headline: `${poll.category_label}: ${result.winner.teamName ?? "A program"}`,
      body: `${poll.category_label} goes to ${result.winner.teamName ?? "the winner"}${result.tiebreakerNeeded ? " after a tiebreaker" : ""} — ${formatCoins(result.amount)}.`,
      primaryAngle: "eos_award",
    }).catch((error) => console.error(`[ERROR] Failed to publish ${poll.category_label} headline (non-fatal):`, error));
    return true;
  }
  return false;
}

/** Tallies real votes and settles every open poll for the league — call when the league advances OUT of the first offseason stage. Posts one headline per award. */
export async function closeAndSettleEosAwardVoting(guildId: string): Promise<{ settled: number }> {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const openPolls = await supabase.from("rec_eos_award_polls").select("*").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("status", "open");
  if (openPolls.error) throw new ApiError(500, "We couldn't load open end-of-season award polls. Please try again.", openPolls.error);

  let settled = 0;
  for (const poll of openPolls.data ?? []) {
    if (await settlePollFromWebVotes(guildId, poll)) settled += 1;
  }
  return { settled };
}

// Settles a single poll by id — used by the bot's per-poll close timer instead of it
// tallying the Discord native poll itself, so there's exactly one settlement path (this
// one) reading exactly one vote source (rec_eos_award_votes) regardless of which surface
// each vote was cast on.
export async function closeAndSettleEosAwardPollById(guildId: string, pollId: string): Promise<{ settled: boolean }> {
  const context = await getCurrentLeagueContext(guildId);
  const poll = await supabase.from("rec_eos_award_polls").select("*").eq("id", pollId).eq("league_id", context.leagueId).eq("status", "open").maybeSingle();
  if (poll.error) throw new ApiError(500, "We couldn't load that end-of-season award poll. Please try again.", poll.error);
  if (!poll.data) return { settled: false };
  return { settled: await settlePollFromWebVotes(guildId, poll.data) };
}

// Merges Discord native-poll voters into rec_eos_award_votes (the single vote table both
// surfaces share) so a Discord vote and a site vote from the same person can't double count
// — and so a Discord-only user's pick lands in the same tally site voters use. Upserts on
// (poll_id, voter_user_id) exactly like castEosAwardVote, so whichever surface someone voted
// on last wins if they voted twice, same as changing your pick on the site.
export async function recordEosAwardPollVotesFromDiscord(input: { pollId: string; discordMessageId: string; votesByNomineeIndex: Record<string, string[]> }): Promise<{ recorded: number }> {
  const poll = await supabase.from("rec_eos_award_polls").select("id,status,discord_message_id,nominee_user_ids").eq("id", input.pollId).maybeSingle();
  if (poll.error) throw new ApiError(500, "We couldn't load that end-of-season award poll. Please try again.", poll.error);
  if (!poll.data) throw new ApiError(404, "EOS award poll not found.");
  if (poll.data.status !== "open") return { recorded: 0 };
  if (poll.data.discord_message_id !== input.discordMessageId) return { recorded: 0 };
  const nomineeIds: string[] = Array.isArray(poll.data.nominee_user_ids) ? poll.data.nominee_user_ids : [];

  const allDiscordIds = [...new Set(Object.values(input.votesByNomineeIndex).flat())];
  if (!allDiscordIds.length) return { recorded: 0 };
  const accounts = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("discord_id", allDiscordIds);
  if (accounts.error) throw new ApiError(500, "We couldn't load Discord voters. Please try again.", accounts.error);
  const userIdByDiscordId = new Map<string, string>((accounts.data ?? []).map((row: any) => [row.discord_id, row.user_id]));

  const now = new Date().toISOString();
  const rows: Array<{ poll_id: string; voter_user_id: string; nominee_user_id: string; updated_at: string }> = [];
  for (const [indexStr, discordIds] of Object.entries(input.votesByNomineeIndex)) {
    const nomineeUserId = nomineeIds[Number(indexStr)];
    if (!nomineeUserId) continue;
    for (const discordId of discordIds) {
      const voterUserId = userIdByDiscordId.get(discordId);
      if (!voterUserId) continue; // voter has no linked site account — nothing to attribute the vote to
      rows.push({ poll_id: input.pollId, voter_user_id: voterUserId, nominee_user_id: nomineeUserId, updated_at: now });
    }
  }
  if (!rows.length) return { recorded: 0 };
  const upserted = await supabase.from("rec_eos_award_votes").upsert(rows, { onConflict: "poll_id,voter_user_id" });
  if (upserted.error) throw new ApiError(500, "We couldn't record end-of-season award votes. Please try again.", upserted.error);
  return { recorded: rows.length };
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
  if (rows.error) throw new ApiError(500, "We couldn't load settled end-of-season awards. Please try again.", rows.error);
  return { seasonNumber, awards: rows.data ?? [] };
}

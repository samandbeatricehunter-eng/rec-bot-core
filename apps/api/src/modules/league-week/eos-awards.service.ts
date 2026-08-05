import { regularSeasonWeeks, formatCoins } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { publishTransitionStory } from "../hub/story-publishing.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";

const BOX_SCORE_SOURCES = ["box_score", "box_score_screenshot"];

// Auto-issued at season end — no poll, straight to the top-1 team by the stat.
export const EOS_AUTO_AWARD_DEFINITIONS = [
  { key: "best_passing_game", label: "Best Passing Game", amount: 200 },
  { key: "best_rushing_game", label: "Best Rushing Game", amount: 200 },
  { key: "best_defense", label: "Best Defense", amount: 200 },
] as const;

// Web-hub poll categories — the only 3 that still require a vote.
export const EOS_POLL_AWARD_DEFINITIONS = [
  { key: "mvp", label: "MVP", amount: 1000, limit: 5 },
  { key: "best_user_skills", label: "Best User Skills", amount: 350, limit: 5 },
  { key: "most_heart", label: "Most Heart", amount: 500, limit: 5 },
] as const;

export const EOS_AWARD_DEFINITIONS = [...EOS_AUTO_AWARD_DEFINITIONS, ...EOS_POLL_AWARD_DEFINITIONS];

type AwardKey = (typeof EOS_AWARD_DEFINITIONS)[number]["key"];

// CFB doesn't have an NFL-style "MVP" — the closest real-world equivalent is the
// Heisman Trophy. Every other award category keeps its default label for now.
function awardLabel(key: AwardKey, game: string | null): string {
  if (key === "mvp" && game === "cfb_27") return "Heisman Trophy Winner";
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
  if (assignments.error) throw new ApiError(500, "Failed to load linked teams for EOS awards.", assignments.error);

  const userIds = [...new Set((assignments.data ?? []).map((row: any) => row.user_id).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name,user:rec_users(username,display_name)").in("user_id", userIds)
    : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "Failed to load Discord accounts for EOS awards.", accounts.error);
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
  if (stats.error) throw new ApiError(500, "Failed to load EOS award stats.", stats.error);
  const byUser = new Map<string, any[]>();
  for (const row of stats.data ?? []) {
    const rows = byUser.get(row.user_id) ?? [];
    rows.push(row);
    byUser.set(row.user_id, rows);
  }
  return byUser;
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
  if (results.error) throw new ApiError(500, "Failed to load EOS award results.", results.error);
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

/** Builds nominees for the 3 poll categories only — MVP/Best User Skills from top-5 power rankings, Most Heart from the formula above. */
export async function prepareEosAwardNominees(input: { guildId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const linked = await linkedTeams(context.leagueId);
  const results = await resultAggByTeam(context.leagueId, seasonNumber, context.rec_leagues.game);
  const rankings = await computePowerRankings(input.guildId).catch(() => ({ teams: [] as any[] }));
  const powerRankByTeam = new Map<string, number>(rankings.teams.map((t: any): [string, number] => [t.teamId, t.rank]));

  const base = linked.map((row) => {
    const agg = results.get(row.teamId) ?? { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, close: 0, games: [] };
    const record = `${agg.wins}-${agg.losses}${agg.ties ? `-${agg.ties}` : ""}`;
    const pointDifferential = agg.pf - agg.pa;
    return { userId: row.userId, discordId: row.discordId, teamId: row.teamId, teamName: row.teamName, record, pointDifferential };
  });

  // MVP and Best User Skills: the top-5 human teams by season-end power ranking.
  const powerRankMetric = new Map<string, { metric: number; detail: string }>();
  for (const row of base) {
    const rank = powerRankByTeam.get(row.teamId);
    if (rank == null) continue;
    powerRankMetric.set(row.teamId, { metric: -rank, detail: `Power Rank #${rank}` });
  }

  const mostHeart = new Map<string, { metric: number; detail: string }>();
  for (const row of base) {
    const agg = results.get(row.teamId);
    if (!agg) continue;
    const entry = mostHeartMetric(agg, powerRankByTeam, row.teamId);
    if (entry) mostHeart.set(row.teamId, entry);
  }

  const awards = EOS_POLL_AWARD_DEFINITIONS.map((definition) => {
    const nominees = definition.key === "most_heart" ? rankNominees(base, mostHeart, definition.limit) : rankNominees(base, powerRankMetric, definition.limit);
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

  const metricFor = (key: (typeof EOS_AUTO_AWARD_DEFINITIONS)[number]["key"], rows: any[]) => {
    if (key === "best_passing_game") return sumRows(rows, "off_pass_yards");
    if (key === "best_rushing_game") return sumRows(rows, "off_rush_yards");
    // best_defense: takeaways help, points/yards allowed hurt.
    return sumRows(rows, "generated_turnovers") * 75 - sumRows(rows, "points_against") * 5 - sumRows(rows, "yards_allowed") / 10;
  };

  let issued = 0;
  for (const definition of EOS_AUTO_AWARD_DEFINITIONS) {
    const existing = await supabase.from("rec_eos_award_polls").select("id").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("category_key", definition.key).maybeSingle();
    if (existing.error) throw new ApiError(500, "Failed to check existing auto-issued award.", existing.error);
    if (existing.data) continue; // already issued this season — never re-run

    let best: { userId: string; teamId: string; metric: number } | null = null;
    for (const row of linked) {
      const metric = metricFor(definition.key, stats.get(row.userId) ?? []);
      if (!best || metric > best.metric) best = { userId: row.userId, teamId: row.teamId, metric };
    }
    if (!best) continue;

    const label = awardLabel(definition.key, context.rec_leagues.game);
    const credit = await creditOrBacklog({
      leagueId: context.leagueId,
      seasonNumber,
      userId: best.userId,
      amount: definition.amount,
      description: `EOS Award - ${label}`,
      transactionType: "eos_award_payout",
      source: "eos",
      sourceReference: { category: definition.key, season: seasonNumber, autoIssued: true },
    });

    const inserted = await supabase.from("rec_eos_award_polls").insert({
      league_id: context.leagueId, season_number: seasonNumber, category_key: definition.key, category_label: label,
      category_description: label, award_amount: definition.amount, nominee_user_ids: [best.userId], nominee_payloads: [],
      status: "settled", winner_user_id: best.userId, opened_at: new Date().toISOString(), settled_at: new Date().toISOString(),
      paid_ledger_id: credit.ledgerId, vote_counts: {}, updated_at: new Date().toISOString(),
    }).select("id").single();
    if (inserted.error) throw new ApiError(500, `Failed to record auto-issued ${label}.`, inserted.error);

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
  const row = await supabase
    .from("rec_eos_award_polls")
    .upsert({
      league_id: context.leagueId,
      season_number: seasonNumber,
      category_key: definition.key,
      category_label: label,
      category_description: label,
      award_amount: definition.amount,
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
  if (row.error) throw new ApiError(500, "Failed to record EOS award poll.", row.error);

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

// Single-poll fetch for the web dashboard's settle form (the Discord flow only ever needs
// the bulk "all open polls" list above).
export async function getEosAwardPoll(pollId: string) {
  const poll = await supabase.from("rec_eos_award_polls").select("*").eq("id", pollId).maybeSingle();
  if (poll.error) throw new ApiError(500, "Failed to load EOS award poll.", poll.error);
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
  if (existing.error) throw new ApiError(500, "Failed to load open EOS award polls.", existing.error);
  const ids = (existing.data ?? []).map((row: any) => row.id).filter(Boolean);
  if (ids.length) {
    const cancelled = await supabase
      .from("rec_eos_award_polls")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in("id", ids);
    if (cancelled.error) throw new ApiError(500, "Failed to cancel open EOS award polls.", cancelled.error);
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
  if (poll.error) throw new ApiError(500, "Failed to load award poll.", poll.error);
  if (!poll.data || poll.data.league_id !== context.leagueId) throw new ApiError(404, "Award poll not found.");
  if (poll.data.status !== "open") throw new ApiError(400, "Voting has closed for this award.");
  const nomineeIds = Array.isArray(poll.data.nominee_user_ids) ? poll.data.nominee_user_ids : [];
  if (!nomineeIds.includes(input.nomineeUserId)) throw new ApiError(400, "That nominee isn't part of this award.");

  const upserted = await supabase.from("rec_eos_award_votes").upsert(
    { poll_id: input.pollId, voter_user_id: account.data.user_id, nominee_user_id: input.nomineeUserId, updated_at: new Date().toISOString() },
    { onConflict: "poll_id,voter_user_id" },
  );
  if (upserted.error) throw new ApiError(500, "Failed to cast vote.", upserted.error);
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
  if (existing.error) throw new ApiError(500, "Failed to load ballot session.", existing.error);
  if (existing.data) return { status: existing.data.status, lastPollId: existing.data.last_poll_id, submittedAt: existing.data.submitted_at };

  const inserted = await supabase
    .from("rec_eos_ballot_sessions")
    .insert({ league_id: context.leagueId, season_number: seasonNumber, voter_user_id: userId })
    .select("status,last_poll_id,submitted_at")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to start ballot session.", inserted.error);
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
  if (error) throw new ApiError(500, "Failed to update ballot progress.", error);
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
  if (error) throw new ApiError(500, "Failed to submit ballot.", error);
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
  if (polls.error) throw new ApiError(500, "Failed to load open EOS award polls.", polls.error);
  const openPolls = polls.data ?? [];
  if (!openPolls.length) return { polls: [], hasVotedAll: true };

  const pollIds = openPolls.map((poll: any) => poll.id);
  const votes = await supabase.from("rec_eos_award_votes").select("poll_id,voter_user_id,nominee_user_id").in("poll_id", pollIds);
  if (votes.error) throw new ApiError(500, "Failed to load EOS award votes.", votes.error);

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
      nominees: (poll.nominee_payloads ?? []).map((nominee: any) => ({ ...nominee, votes: tallyByPoll.get(poll.id)?.get(nominee.userId) ?? 0 })),
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
  if (poll.error) throw new ApiError(500, "Failed to load EOS award poll.", poll.error);
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
  if (updated.error) throw new ApiError(500, "Failed to settle EOS award poll.", updated.error);

  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
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
  if (votes.error) throw new ApiError(500, "Failed to load EOS award votes.", votes.error);
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
  if (openPolls.error) throw new ApiError(500, "Failed to load open EOS award polls.", openPolls.error);

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
  if (poll.error) throw new ApiError(500, "Failed to load EOS award poll.", poll.error);
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
  if (poll.error) throw new ApiError(500, "Failed to load EOS award poll.", poll.error);
  if (!poll.data) throw new ApiError(404, "EOS award poll not found.");
  if (poll.data.status !== "open") return { recorded: 0 };
  if (poll.data.discord_message_id !== input.discordMessageId) return { recorded: 0 };
  const nomineeIds: string[] = Array.isArray(poll.data.nominee_user_ids) ? poll.data.nominee_user_ids : [];

  const allDiscordIds = [...new Set(Object.values(input.votesByNomineeIndex).flat())];
  if (!allDiscordIds.length) return { recorded: 0 };
  const accounts = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("discord_id", allDiscordIds);
  if (accounts.error) throw new ApiError(500, "Failed to resolve Discord voters.", accounts.error);
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
  if (upserted.error) throw new ApiError(500, "Failed to record EOS award votes.", upserted.error);
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
  if (rows.error) throw new ApiError(500, "Failed to load settled EOS awards.", rows.error);
  return { seasonNumber, awards: rows.data ?? [] };
}

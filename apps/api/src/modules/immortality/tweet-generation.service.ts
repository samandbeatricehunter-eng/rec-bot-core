// Rise to Immortality "tweets" -- generates up to 10 candidate posts per Advance (regular
// season/postseason only, see gameplaySeasonStages) from that week's actual imported stats and
// game results, favoring the league's custom-created prospects (madden_player_id starting
// "rti:") over baseline real-NFL roster fill, per the league being player-focused. Posting is a
// separate 4-hour drip -- see sweepImmortalityTweetQueue below -- not done here.
import { gameplaySeasonStages, type LeagueGame } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { loadImmortalityLeague } from "./immortality.service.js";
import {
  GENERIC_HANDLES, TWEET_HOSTS, TWEET_TEMPLATES,
  type TweetAuthor, type TweetCategory, type TweetSlots, type TweetTemplate,
} from "./tweet-bank.js";

const QUEUE_SIZE = 10;
const IS_CUSTOM_PROSPECT_PREFIX = "rti:";

type Candidate = { category: TweetCategory; slots: TweetSlots; weight: number };

function fillTemplate(template: string, slots: TweetSlots): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = (slots as Record<string, unknown>)[key];
    return value == null ? "" : String(value);
  }).replace(/\s+/g, " ").trim();
}

function pick<T>(items: T[]): T | null {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)]!;
}

// Round-number season-cumulative thresholds -- fires once per crossing (this week's cumulative
// clears it, last week's didn't).
const MILESTONES: Array<{ statKey: "passYards" | "rushYards" | "receivingYards" | "tackles"; label: string; steps: number[] }> = [
  { statKey: "passYards", label: "career passing yards", steps: [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000] },
  { statKey: "rushYards", label: "career rushing yards", steps: [250, 500, 750, 1000, 1250, 1500] },
  { statKey: "receivingYards", label: "career receiving yards", steps: [250, 500, 750, 1000, 1250, 1500] },
  { statKey: "tackles", label: "career tackles", steps: [50, 100, 150, 200, 250] },
];

function num(value: unknown): number { return Number(value) || 0; }

// Separate queries + JS-side join rather than a nested Supabase embed -- this codebase's
// Supabase-compatible shim has a known gotcha with relation aliases on nested embeds, so plain
// queries joined in JS (same pattern pro-tracker.service.ts's computePlayerLine uses) are the
// safe default here.
async function loadWeekAndSeasonStats(leagueId: string, seasonNumber: number, weekNumber: number) {
  const [weekRows, throughLastWeek] = await Promise.all([
    supabase.from("rec_player_weekly_stats").select("player_id,stats")
      .eq("league_id", leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber),
    supabase.from("rec_player_weekly_stats").select("player_id,stats")
      .eq("league_id", leagueId).eq("season_number", seasonNumber).lt("week_number", weekNumber),
  ]);
  const rows = (weekRows.data ?? []) as Array<{ player_id: string; stats: unknown }>;
  const playerIds = [...new Set(rows.map((row) => row.player_id))];
  if (!playerIds.length) return { weekRows: [] as Array<{ player_id: string; stats: unknown; player: PlayerInfo }>, priorRows: throughLastWeek.data ?? [] };

  const players = await supabase.from("rec_players")
    .select("id,full_name,position,team_id,madden_player_id")
    .in("id", playerIds);
  const teamIds = [...new Set((players.data ?? []).map((p: any) => p.team_id).filter(Boolean))];
  const teams = teamIds.length
    ? await supabase.from("rec_teams").select("id,name,display_city,display_nick,is_relocated,abbreviation,display_abbr").in("id", teamIds)
    : { data: [] as any[] };
  const teamById = new Map<string, any>((teams.data ?? []).map((t: any) => [String(t.id), t]));
  const playerById = new Map<string, PlayerInfo>((players.data ?? []).map((p: any) => [String(p.id), {
    fullName: p.full_name ?? null, position: p.position ?? null, maddenPlayerId: p.madden_player_id ?? null,
    team: p.team_id ? teamById.get(String(p.team_id)) ?? null : null,
  }]));

  const joined = rows
    .map((row) => ({ ...row, player: playerById.get(String(row.player_id)) }))
    .filter((row): row is { player_id: string; stats: unknown; player: PlayerInfo } => Boolean(row.player));
  return { weekRows: joined, priorRows: throughLastWeek.data ?? [] };
}

type PlayerInfo = { fullName: string | null; position: string | null; maddenPlayerId: string | null; team: any | null };

function statLine(stats: Record<string, unknown> | null | undefined) {
  const s = stats ?? {};
  return {
    passYards: num(s.pass_yards), passTds: num(s.pass_tds), interceptionsThrown: num(s.interceptions_thrown),
    rushYards: num(s.rush_yards), rushTds: num(s.rush_tds), rushingFumbles: num(s.rushing_fumbles),
    receivingYards: num(s.receiving_yards), receivingTds: num(s.receiving_tds),
    tackles: num(s.tackles), sacks: num(s.sacks), interceptions: num(s.interceptions),
    forcedFumbles: num(s.forced_fumbles), defensiveTds: num(s.defensive_tds),
  };
}

function teamLabel(team: any): string {
  return formatTeamDisplayName(team) ?? team?.name ?? "That team";
}

/** Builds every trigger-worthy candidate from the week's real stat lines and game results,
 * weighting custom RTI prospects far above baseline roster fill (the league is player-focused). */
async function buildCandidates(leagueId: string, seasonNumber: number, weekNumber: number): Promise<Candidate[]> {
  const { weekRows, priorRows } = await loadWeekAndSeasonStats(leagueId, seasonNumber, weekNumber);
  const priorTotalsByPlayer = new Map<string, ReturnType<typeof statLine>>();
  const priorByPlayer = new Map<string, Array<{ stats: unknown }>>();
  for (const row of priorRows as Array<{ player_id: string; stats: unknown }>) {
    const list = priorByPlayer.get(row.player_id) ?? [];
    list.push(row);
    priorByPlayer.set(row.player_id, list);
  }
  for (const [playerId, rows] of priorByPlayer) {
    const total = { passYards: 0, passTds: 0, interceptionsThrown: 0, rushYards: 0, rushTds: 0, rushingFumbles: 0, receivingYards: 0, receivingTds: 0, tackles: 0, sacks: 0, interceptions: 0, forcedFumbles: 0, defensiveTds: 0 };
    for (const row of rows) {
      const line = statLine(row.stats as Record<string, unknown>);
      for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += line[key];
    }
    priorTotalsByPlayer.set(playerId, total);
  }

  const candidates: Candidate[] = [];

  for (const row of weekRows) {
    const player = row.player;
    if (!player) continue;
    const line = statLine(row.stats as Record<string, unknown>);
    const isCustom = String(player.maddenPlayerId ?? "").startsWith(IS_CUSTOM_PROSPECT_PREFIX);
    const weight = isCustom ? 6 : 1; // heavily favor the league's own created prospects
    const baseSlots: TweetSlots = { player: player.fullName ?? "That player", team: teamLabel(player.team), week: weekNumber };

    if (line.passYards >= 250) candidates.push({ category: "big_pass", weight, slots: { ...baseSlots, value: line.passYards, statLabel: "pass yards", secondValue: line.passTds, secondStatLabel: "pass TDs" } });
    if (line.rushYards >= 100) candidates.push({ category: "big_rush", weight, slots: { ...baseSlots, value: line.rushYards, statLabel: "rush yards" } });
    if (line.receivingYards >= 100) candidates.push({ category: "big_receiving", weight, slots: { ...baseSlots, value: line.receivingYards, statLabel: "receiving yards" } });
    const tds = line.passTds + line.rushTds + line.receivingTds;
    if (tds >= 2) candidates.push({ category: "multi_td", weight, slots: { ...baseSlots, value: tds, statLabel: "touchdowns" } });
    const giveaways = line.interceptionsThrown + line.rushingFumbles;
    if (giveaways >= 2) candidates.push({ category: "turnover_heavy", weight, slots: { ...baseSlots, value: giveaways, statLabel: "turnovers" } });
    if (line.tackles >= 10) candidates.push({ category: "def_takeover", weight, slots: { ...baseSlots, value: line.tackles, statLabel: "tackles" } });
    if (line.sacks >= 2) candidates.push({ category: "def_takeover", weight, slots: { ...baseSlots, value: line.sacks, statLabel: "sacks" } });
    if (line.interceptions >= 1 || line.forcedFumbles >= 1 || line.defensiveTds >= 1) {
      candidates.push({ category: "playmaker", weight, slots: baseSlots });
    }
    if (tds === 0 && line.passYards === 0 && line.rushYards === 0 && line.receivingYards === 0 && line.tackles === 0 && line.sacks === 0) {
      candidates.push({ category: "quiet_game", weight: weight * 0.4, slots: baseSlots });
    }

    const prior = priorTotalsByPlayer.get(row.player_id) ?? { passYards: 0, rushYards: 0, receivingYards: 0, tackles: 0 } as any;
    for (const milestone of MILESTONES) {
      const before = num(prior[milestone.statKey]);
      const after = before + line[milestone.statKey];
      const crossed = milestone.steps.find((step) => before < step && after >= step);
      if (crossed) candidates.push({ category: "milestone", weight: weight * 1.5, slots: { ...baseSlots, value: crossed, statLabel: milestone.label } });
    }
  }

  const results = await supabase.from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,is_tie")
    .eq("league_id", leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber);
  const gameRows = (results.data ?? []) as Array<{ home_team_id: string | null; away_team_id: string | null; home_score: number; away_score: number; is_tie: boolean }>;
  const gameTeamIds = [...new Set(gameRows.flatMap((g) => [g.home_team_id, g.away_team_id]).filter((id): id is string => Boolean(id)))];
  const gameTeams = gameTeamIds.length
    ? await supabase.from("rec_teams").select("id,name,display_city,display_nick,is_relocated,abbreviation,display_abbr").in("id", gameTeamIds)
    : { data: [] as any[] };
  const gameTeamById = new Map<string, any>((gameTeams.data ?? []).map((t: any) => [String(t.id), t]));

  for (const game of gameRows) {
    if (game.is_tie) continue;
    const homeScore = num(game.home_score);
    const awayScore = num(game.away_score);
    const margin = Math.abs(homeScore - awayScore);
    const winnerIsHome = homeScore > awayScore;
    const winner = game.home_team_id && game.away_team_id ? gameTeamById.get(String(winnerIsHome ? game.home_team_id : game.away_team_id)) : null;
    const loser = game.home_team_id && game.away_team_id ? gameTeamById.get(String(winnerIsHome ? game.away_team_id : game.home_team_id)) : null;
    if (!winner || !loser) continue;
    const score = winnerIsHome ? `${homeScore}-${awayScore}` : `${awayScore}-${homeScore}`;
    const slots: TweetSlots = { team: teamLabel(winner), opponent: teamLabel(loser), week: weekNumber, score, margin };
    if (margin >= 21) candidates.push({ category: "blowout_win", weight: 2, slots });
    else if (margin <= 3) candidates.push({ category: "close_game", weight: 2, slots });
    if (margin >= 14) candidates.push({ category: "bad_loss", weight: 2, slots: { ...slots, team: teamLabel(loser), opponent: teamLabel(winner) } });
  }

  // A light sprinkle of non-data-specific flavor so the feed doesn't read as a pure stat dump.
  candidates.push({ category: "hype", weight: 1.5, slots: { week: weekNumber } });
  candidates.push({ category: "hype", weight: 1, slots: { week: weekNumber } });

  return candidates;
}

function weightedSample(candidates: Candidate[], count: number): Candidate[] {
  const pool = [...candidates];
  const chosen: Candidate[] = [];
  while (pool.length && chosen.length < count) {
    const totalWeight = pool.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight <= 0) break;
    let roll = Math.random() * totalWeight;
    let index = 0;
    for (; index < pool.length; index += 1) {
      roll -= pool[index]!.weight;
      if (roll <= 0) break;
    }
    const [taken] = pool.splice(Math.min(index, pool.length - 1), 1);
    if (taken) chosen.push(taken);
  }
  return chosen;
}

function resolveAuthor(voice: TweetAuthor): { authorKind: "host" | "generic"; handle: string; displayName: string } {
  if (voice === "generic") {
    const handle = pick(GENERIC_HANDLES) ?? GENERIC_HANDLES[0]!;
    return { authorKind: "generic", handle: handle.handle, displayName: handle.displayName };
  }
  const host = TWEET_HOSTS[voice];
  return { authorKind: "host", handle: host.handle, displayName: host.displayName };
}

/** Call after a week's advance completes -- no-ops for preseason/offseason (gameplaySeasonStages,
 * same gate postWeeklyProTrackerUpdates uses) or a non-RTI league. Safe to call unconditionally
 * from the advance flow. */
export async function queueImmortalityTweetsAfterAdvance(input: { leagueId: string; seasonNumber: number; weekNumber: number; seasonStage: string; game: LeagueGame }): Promise<void> {
  if (!gameplaySeasonStages(input.game).has(input.seasonStage)) return;
  const immortalityLeague = await loadImmortalityLeague(input.leagueId);
  if (!immortalityLeague) return;
  await generateAndQueueImmortalityTweets(input.leagueId, input.seasonNumber, input.weekNumber);
}

/** Adds two fan-account reactions after an RTI contract is executed. They use the existing
 * four-hour tweet drip instead of posting simultaneously, keeping the channel timeline natural. */
export async function queueContractSigningTweets(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  contractId: string;
  playerName: string;
  position: string;
  teamName: string;
  contractNumber: number;
  startSeason: number;
  endSeason: number;
  playerXp: number;
  coins: number;
}): Promise<void> {
  const seed = [...input.contractId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const first = GENERIC_HANDLES[seed % GENERIC_HANDLES.length]!;
  const second = GENERIC_HANDLES[(seed + 17) % GENERIC_HANDLES.length]!;
  const label = input.contractNumber === 1 ? "rookie deal" : input.contractNumber === 2 ? "second contract" : "final contract";
  await supabase.from("rec_immortality_tweet_queue").insert([
    {
      league_id: input.leagueId,
      season_number: input.seasonNumber,
      week_number: input.weekNumber,
      author_kind: "generic",
      author_handle: first.handle,
      author_display_name: first.displayName,
      body: `${input.teamName} locked in ${input.playerName} (${input.position}) on a Seasons ${input.startSeason}–${input.endSeason} ${label}. The franchise has its cornerstone.`,
      status: "pending",
    },
    {
      league_id: input.leagueId,
      season_number: input.seasonNumber,
      week_number: input.weekNumber,
      author_kind: "generic",
      author_handle: second.handle,
      author_display_name: second.displayName,
      body: `${input.playerName} just signed for ${input.coins.toLocaleString("en-US")} REC Coins and ${input.playerXp} Player XP. Now the pressure shifts to making that ${input.position} investment pay off.`,
      status: "pending",
    },
  ]);
}

/** Clears whatever is still pending from the previous Advance and queues a fresh batch of up to
 * 10 tweets for this one. Safe no-op if the league has nothing tweet-worthy this week. */
async function generateAndQueueImmortalityTweets(leagueId: string, seasonNumber: number, weekNumber: number): Promise<void> {
  await supabase.from("rec_immortality_tweet_queue").update({ status: "cleared" })
    .eq("league_id", leagueId).eq("status", "pending");

  const candidates = await buildCandidates(leagueId, seasonNumber, weekNumber);
  if (!candidates.length) return;
  const chosen = weightedSample(candidates, QUEUE_SIZE);
  if (!chosen.length) return;

  const rows = chosen.map((candidate) => {
    const templates = TWEET_TEMPLATES.filter((tmpl) => tmpl.category === candidate.category);
    const template = pick(templates) as TweetTemplate | null;
    if (!template) return null;
    const author = resolveAuthor(template.voice);
    return {
      league_id: leagueId,
      season_number: seasonNumber,
      week_number: weekNumber,
      author_kind: author.authorKind,
      author_handle: author.handle,
      author_display_name: author.displayName,
      body: fillTemplate(template.text, candidate.slots),
      status: "pending" as const,
    };
  }).filter((row): row is NonNullable<typeof row> => row != null && row.body.length > 0);

  if (!rows.length) return;
  await supabase.from("rec_immortality_tweet_queue").insert(rows);
}

/** Called on a plain interval sweep (apps/api/src/index.ts) -- posts at most one pending tweet
 * per league every 4 hours, oldest-queued first. Cheap when idle: a single filtered query. */
export async function sweepImmortalityTweetQueue(): Promise<void> {
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - FOUR_HOURS_MS).toISOString();

  const leaguesWithPending = await supabase.from("rec_immortality_tweet_queue")
    .select("league_id").eq("status", "pending");
  const leagueIds: string[] = Array.from(new Set((leaguesWithPending.data ?? []).map((row: any) => String(row.league_id))));
  if (!leagueIds.length) return;

  for (const leagueId of leagueIds) {
    try {
      const lastPosted = await supabase.from("rec_immortality_tweet_queue")
        .select("posted_at").eq("league_id", leagueId).eq("status", "posted")
        .order("posted_at", { ascending: false }).limit(1).maybeSingle();
      if (lastPosted.data?.posted_at && lastPosted.data.posted_at > cutoff) continue;

      const next = await supabase.from("rec_immortality_tweet_queue")
        .select("id,author_handle,author_display_name,body")
        .eq("league_id", leagueId).eq("status", "pending")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (!next.data) continue;

      const routes = await findServerRoutesForLeague(leagueId).catch(() => null);
      const channelId = (routes?.routes as any)?.tweets_channel_id as string | null | undefined;
      if (!channelId) continue;

      const claimed = await supabase.from("rec_immortality_tweet_queue")
        .update({ status: "posted", posted_at: new Date().toISOString() })
        .eq("id", String(next.data.id)).eq("status", "pending").select("id").maybeSingle();
      if (!claimed.data) continue; // another tick already claimed this row
      try {
        await postDiscordChannelMessage(channelId, {
          embeds: [{
            author: { name: `${next.data.author_display_name} (${next.data.author_handle})` },
            description: next.data.body,
            color: 0x1d9bf0,
          }],
        }).then(async (posted) => {
          if (!posted) {
            await supabase.from("rec_immortality_tweet_queue")
              .update({ status: "pending", posted_at: null }).eq("id", String(next.data.id));
            console.error(`[ERROR] Discord returned null posting RTI tweet for league ${leagueId} (will retry)`);
          }
        });
      } catch (err) {
        // A Discord outage must not permanently consume the queue entry.
        await supabase.from("rec_immortality_tweet_queue")
          .update({ status: "pending", posted_at: null }).eq("id", String(next.data.id));
        console.error(`[ERROR] Failed to post RTI tweet for league ${leagueId} (will retry):`, err);
      }
    } catch (err) {
      console.error(`[ERROR] Tweet queue sweep failed for league ${leagueId} (non-fatal):`, err);
    }
  }
}

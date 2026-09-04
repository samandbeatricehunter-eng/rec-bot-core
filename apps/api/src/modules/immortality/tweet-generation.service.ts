// Rise to Immortality "tweets" -- generates up to 10 candidate posts per Advance (regular
// season/postseason only, see gameplaySeasonStages) from that week's actual imported stats and
// game results, favoring the league's custom-created prospects (madden_player_id starting
// "rti:") over baseline real-NFL roster fill, per the league being player-focused. Posting is a
// separate 4-hour drip -- see sweepImmortalityTweetQueue below -- not done here.
import { gameplaySeasonStages, type LeagueGame } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague, getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { discordIdForRecUser, loadImmortalityLeague, prospectAvatarUrlForHandle, recUserIdFromDiscordId, requireImmortalityLeague, twitterHandleForProspect } from "./immortality.service.js";
import { ensurePlayerPersonasForLeague, listPlayerPersonasForLeague, playerPersonaFor, playerPersonaAvatarForHandle } from "./player-personas.service.js";
import {
  GENERIC_HANDLES, MANUAL_TWEET_GENERIC_HANDLES, PLAYER_CHATTER_TEMPLATES, TWEET_HOSTS, TWEET_TEMPLATES, staticAvatarUrlForHandle,
  type TweetAuthor, type TweetCategory, type TweetHostKey, type TweetSlots, type TweetTemplate,
} from "./tweet-bank.js";
import { conversationTemplateKey, selectConversationLine, type ConversationKind } from "./tweet-bank-conversations.js";
import { personaForHandle, playerVoiceFromTraits } from "./tweet-bank-voices.js";

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

/** Host/stat tweets still no-op outside gameplay, but player personas must exist in camp so
 * the conversation sweep has real-life roster accounts to talk with. */
export async function queueImmortalityTweetsAfterAdvance(input: { leagueId: string; seasonNumber: number; weekNumber: number; seasonStage: string; game: LeagueGame }): Promise<void> {
  const immortalityLeague = await loadImmortalityLeague(input.leagueId);
  if (!immortalityLeague) return;
  await ensurePlayerPersonasForLeague(input.leagueId).catch((err) =>
    console.error(`[ERROR] Player persona generation failed for league ${input.leagueId} (non-fatal):`, err));
  if (!gameplaySeasonStages(input.game).has(input.seasonStage)) return;
  await generateAndQueueImmortalityTweets(input.leagueId, input.seasonNumber, input.weekNumber);
  await queuePlayerChatterAfterImport(input.leagueId, input.seasonNumber, input.weekNumber).catch((err) =>
    console.error(`[ERROR] Player chatter tweets failed for league ${input.leagueId} (non-fatal):`, err));
}

/** Same generator, called from the EA import completion hooks (ea-connections.service.ts /
 * madden-ea.routes.ts) instead of waiting for a commissioner to click Advance -- a Madden league
 * lives and dies by its data imports, not a separate manual step, so freshly-imported stats
 * should be able to produce tweets right away. Loads its own season/week/stage/game since the
 * import hooks only have a leagueId on hand. */
export async function queueImmortalityTweetsAfterImport(leagueId: string): Promise<void> {
  const league = await supabase.from("rec_leagues")
    .select("season_number,current_week,season_stage,game").eq("id", leagueId).maybeSingle();
  if (!league.data) return;
  await queueImmortalityTweetsAfterAdvance({
    leagueId,
    seasonNumber: Number(league.data.season_number ?? 1),
    weekNumber: Number(league.data.current_week ?? 1),
    seasonStage: String(league.data.season_stage ?? ""),
    game: league.data.game as LeagueGame,
  });
}

export function pickCatalogTweetAuthor(seed: number): { authorKind: "host" | "generic"; handle: string; displayName: string } {
  const catalog = [
    ...Object.values(TWEET_HOSTS).map((host) => ({ authorKind: "host" as const, handle: host.handle, displayName: host.displayName })),
    ...GENERIC_HANDLES.map((account) => ({ authorKind: "generic" as const, handle: account.handle, displayName: account.displayName })),
  ];
  return catalog[Math.abs(seed) % catalog.length]!;
}

async function userOwnedHandlesForLeague(leagueId: string): Promise<Set<string>> {
  const immortality = await loadImmortalityLeague(leagueId);
  if (!immortality) return new Set();
  const [prospects, owners] = await Promise.all([
    supabase.from("rec_immortality_prospects").select("first_name,last_name").eq("immortality_league_id", immortality.id),
    supabase.from("rec_immortality_owners").select("first_name,last_name").eq("immortality_league_id", immortality.id),
  ]);
  const handles = new Set<string>();
  for (const row of [...(prospects.data ?? []), ...(owners.data ?? [])] as Array<{ first_name: string | null; last_name: string | null }>) {
    handles.add(twitterHandleForProspect(row).handle.toLowerCase());
  }
  return handles;
}

const USER_AUTHORED_TWEET_SOURCES = new Set(["player_twitter"]);

/** Resolves "@FutureHendrix"-style fictional handles inside a tweet's body to the real Discord
 * user behind them, if any (an RTI prospect or owner controlled by a real linked member) --
 * mentions inside an embed description never actually notify anyone on Discord, so a real ping
 * has to go in the message's own `content` field instead. Only covers prospects/owners (the
 * "in-fiction person" handles this feature is actually about) -- team handles are already
 * tag-able directly via /tweets' native Discord role picker. */
async function resolveMentionDiscordIds(recLeagueId: string, body: string): Promise<string[]> {
  const mentioned = new Set([...body.matchAll(/@([A-Za-z0-9_]+)/g)].map((m) => m[0].toLowerCase()));
  if (!mentioned.size) return [];
  const immortality = await loadImmortalityLeague(recLeagueId);
  if (!immortality) return [];

  const [prospects, owners] = await Promise.all([
    supabase.from("rec_immortality_prospects").select("first_name,last_name,user_id").eq("immortality_league_id", immortality.id).not("user_id", "is", null),
    supabase.from("rec_immortality_owners").select("first_name,last_name,user_id").eq("immortality_league_id", immortality.id),
  ]);
  const candidates = [...(prospects.data ?? []), ...(owners.data ?? [])] as Array<{ first_name: string | null; last_name: string | null; user_id: string }>;

  const discordIds = new Set<string>();
  for (const person of candidates) {
    if (!mentioned.has(twitterHandleForProspect(person).handle.toLowerCase())) continue;
    const discordId = await discordIdForRecUser(String(person.user_id)).catch(() => null);
    if (discordId) discordIds.add(discordId);
  }
  return [...discordIds];
}

function seedFromId(id: string): number {
  return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function normalizeTweetBody(body: string | null | undefined): string {
  return String(body ?? "").replace(/\s+/g, " ").trim();
}

function looksLikeOfficialContractBody(body: string): boolean {
  return /^It's official — .+ signed .+ to a Seasons .+ The package: .+ REC Coins and .+ Player XP\./.test(normalizeTweetBody(body));
}

/** Pending auto tweets must never post as a member's owner or created-player handle. Also
 * collapse leftover contract-blurb copies that landed on interview/ambient rows. */
async function sanitizePendingAutoTweets(leagueId: string): Promise<void> {
  const pending = await supabase.from("rec_immortality_tweet_queue")
    .select("id,author_handle,author_kind,body,source,created_at")
    .eq("league_id", leagueId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const rows = (pending.data ?? []) as Array<{
    id: string; author_handle: string; author_kind: string | null; body: string; source: string | null;
  }>;
  if (!rows.length) return;

  const userHandles = await userOwnedHandlesForLeague(leagueId);
  const stolenIds = rows
    .filter((row) => looksLikeOfficialContractBody(row.body) && row.source !== "contract_signing")
    .map((row) => String(row.id));
  if (stolenIds.length) {
    await supabase.from("rec_immortality_tweet_queue").update({ status: "cleared" }).in("id", stolenIds);
  }

  const posted = await supabase.from("rec_immortality_tweet_queue")
    .select("id,body")
    .eq("league_id", leagueId)
    .eq("status", "posted");
  const postedBodies = new Set(((posted.data ?? []) as Array<{ body: string }>).map((row) => normalizeTweetBody(row.body)));
  const duplicateIds = rows
    .filter((row) => postedBodies.has(normalizeTweetBody(row.body)))
    .map((row) => String(row.id));
  if (duplicateIds.length) {
    await supabase.from("rec_immortality_tweet_queue").update({ status: "cleared" }).in("id", duplicateIds);
  }

  const seenPendingBodies = new Set<string>();
  const pendingDupes: string[] = [];
  for (const row of rows) {
    if (stolenIds.includes(String(row.id)) || duplicateIds.includes(String(row.id))) continue;
    const body = normalizeTweetBody(row.body);
    if (!body) continue;
    if (seenPendingBodies.has(body)) {
      pendingDupes.push(String(row.id));
      continue;
    }
    seenPendingBodies.add(body);
  }
  if (pendingDupes.length) {
    await supabase.from("rec_immortality_tweet_queue").update({ status: "cleared" }).in("id", pendingDupes);
  }

  const skip = new Set([...stolenIds, ...duplicateIds, ...pendingDupes]);
  for (const row of rows) {
    if (skip.has(String(row.id))) continue;
    if (USER_AUTHORED_TWEET_SOURCES.has(String(row.source ?? ""))) continue;
    if (!userHandles.has(String(row.author_handle).toLowerCase())) continue;
    const author = pickCatalogTweetAuthor(seedFromId(String(row.id)));
    await supabase.from("rec_immortality_tweet_queue").update({
      author_kind: author.authorKind,
      author_handle: author.handle,
      author_display_name: author.displayName,
    }).eq("id", String(row.id)).eq("status", "pending");
  }
}

/** One tweet per signed contract, with the full package (seasons, coins, XP). Always a catalog
 * host/fan account -- never a member's owner or created-player handle. Idempotent on the
 * official body so sign + hub-load repair cannot queue a second post. */
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
  const label = input.contractNumber === 1 ? "rookie contract" : input.contractNumber === 2 ? "second contract" : "final contract";
  const body = `It's official — ${input.teamName} signed ${input.playerName} (${input.position}) to a Seasons ${input.startSeason}–${input.endSeason} ${label}. The package: ${input.coins.toLocaleString("en-US")} REC Coins and ${input.playerXp} Player XP.`;

  const existing = await supabase.from("rec_immortality_tweet_queue")
    .select("id,status,created_at,body,source,author_kind")
    .eq("league_id", input.leagueId)
    .in("status", ["pending", "posted"]);
  const official = (existing.data ?? []).filter((row: any) => looksLikeOfficialContractBody(String(row.body ?? "")) && String(row.body ?? "").includes(`signed ${input.playerName}`));
  if (official.some((row: any) => row.status === "posted")) {
    const extras = official.filter((row: any) => row.status === "pending").map((row: any) => String(row.id));
    if (extras.length) await supabase.from("rec_immortality_tweet_queue").update({ status: "cleared" }).in("id", extras);
    return;
  }
  const pending = official
    .filter((row: any) => row.status === "pending" && (row.source === "contract_signing" || row.author_kind === "generic" || row.author_kind === "host"))
    .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
  const stolen = official.filter((row: any) => row.status === "pending" && !pending.some((keep: any) => keep.id === row.id)).map((row: any) => String(row.id));
  if (stolen.length) await supabase.from("rec_immortality_tweet_queue").update({ status: "cleared" }).in("id", stolen);
  if (pending.length) {
    const keep = pending[0]!;
    const author = pickCatalogTweetAuthor([...input.contractId].reduce((sum, char) => sum + char.charCodeAt(0), 0));
    await supabase.from("rec_immortality_tweet_queue").update({
      body, source: "contract_signing", author_kind: author.authorKind, author_handle: author.handle, author_display_name: author.displayName,
    }).eq("id", String(keep.id));
    const extras = pending.slice(1).map((row: any) => String(row.id));
    if (extras.length) await supabase.from("rec_immortality_tweet_queue").update({ status: "cleared" }).in("id", extras);
    return;
  }

  const author = pickCatalogTweetAuthor([...input.contractId].reduce((sum, char) => sum + char.charCodeAt(0), 0));
  await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    author_kind: author.authorKind,
    author_handle: author.handle,
    author_display_name: author.displayName,
    body,
    status: "pending",
    source: "contract_signing",
  });
}

const MANUAL_GENERIC_PERSONA_KEYS = ["generic1", "generic2", "generic3", "generic4"] as const;

/** Commissioner-authored tweet from the bot's /tweets command (immortality.routes.ts's
 * /v1/immortality/tweets/manual) -- posts immediately rather than joining the drip queue, and
 * logs a "posted" row in the same table (source: "manual") so it shows up alongside the
 * generated feed in any history view. */
export async function postManualImmortalityTweet(input: {
  guildId: string;
  persona: string;
  customHandle?: string;
  customDisplayName?: string;
  tweetText: string;
  mentionContent?: string;
}): Promise<void> {
  const context = await getCurrentLeagueContext(input.guildId);
  const routes = await findServerRoutesForLeague(context.leagueId);
  const channelId = (routes?.routes as any)?.tweets_channel_id as string | null | undefined;
  if (!channelId) throw new ApiError(400, "This server has no tweets channel configured yet.");

  let handle: string;
  let displayName: string;
  let avatarUrl: string | undefined;
  let authorKind: "host" | "generic" | "custom";
  if (input.persona in TWEET_HOSTS) {
    const host = TWEET_HOSTS[input.persona as TweetHostKey];
    handle = host.handle; displayName = host.displayName; avatarUrl = host.avatarUrl; authorKind = "host";
  } else if (input.persona === "custom") {
    const rawHandle = input.customHandle?.trim();
    if (!rawHandle) throw new ApiError(400, "A custom handle is required.");
    handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;
    displayName = input.customDisplayName?.trim() || handle;
    authorKind = "custom";
  } else {
    const index = MANUAL_GENERIC_PERSONA_KEYS.indexOf(input.persona as (typeof MANUAL_GENERIC_PERSONA_KEYS)[number]);
    const account = index === -1 ? null : MANUAL_TWEET_GENERIC_HANDLES[index];
    if (!account) throw new ApiError(400, "Unknown tweet persona.");
    handle = account.handle; displayName = account.displayName; avatarUrl = account.avatarUrl; authorKind = "generic";
  }

  const posted = await postDiscordChannelMessage(channelId, {
    content: input.mentionContent?.trim() || undefined,
    embeds: [{ author: { name: `${displayName} (${handle})`, icon_url: avatarUrl }, description: input.tweetText, color: 0x1d9bf0 }],
  });
  if (!posted) throw new ApiError(502, "Discord rejected the tweet -- check the tweets channel still exists and the bot can post there.");

  const league = await supabase.from("rec_leagues").select("season_number,current_week").eq("id", context.leagueId).maybeSingle();
  await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: context.leagueId,
    season_number: Number(league.data?.season_number ?? 1),
    week_number: Number(league.data?.current_week ?? 1),
    author_kind: authorKind,
    author_handle: handle,
    author_display_name: displayName,
    body: input.tweetText,
    status: "posted",
    posted_at: new Date().toISOString(),
    source: "manual",
  });
}

export type PlayerTwitterPersonaKey = "owner" | "offense" | "defense";

export type PlayerTwitterPersona = {
  key: PlayerTwitterPersonaKey;
  name: string;
  handle: string;
  roleLabel: string;
};

type ResolvedPlayerTwitterPersona = PlayerTwitterPersona & { avatarUrl: string | undefined };

async function resolveOwnedTwitterPersonas(guildId: string, discordId: string): Promise<ResolvedPlayerTwitterPersona[]> {
  const context = await getCurrentLeagueContext(guildId);
  const league = await loadImmortalityLeague(context.leagueId);
  if (!league) return [];
  const userId = await recUserIdFromDiscordId(discordId);
  const [owner, prospects] = await Promise.all([
    supabase.from("rec_immortality_owners")
      .select("first_name,last_name,headshot_url")
      .eq("immortality_league_id", league.id).eq("user_id", userId).maybeSingle(),
    supabase.from("rec_immortality_prospects")
      .select("side,first_name,last_name,headshot_url,position")
      .eq("immortality_league_id", league.id).eq("user_id", userId),
  ]);
  const personas: ResolvedPlayerTwitterPersona[] = [];
  if (owner.data) {
    const { handle, displayName } = twitterHandleForProspect(owner.data);
    if (displayName !== "Prospect") {
      personas.push({
        key: "owner", name: displayName, handle, roleLabel: "Owner",
        avatarUrl: owner.data.headshot_url ? String(owner.data.headshot_url) : undefined,
      });
    }
  }
  for (const side of ["offense", "defense"] as const) {
    const prospect = ((prospects.data ?? []) as Array<{
      side: string; first_name: string | null; last_name: string | null; headshot_url: string | null; position: string | null;
    }>).find((row) => row.side === side);
    if (!prospect) continue;
    const { handle, displayName } = twitterHandleForProspect(prospect);
    if (displayName === "Prospect") continue;
    const position = prospect.position ? ` (${prospect.position})` : "";
    personas.push({
      key: side, name: displayName, handle,
      roleLabel: `${side === "offense" ? "Offense" : "Defense"}${position}`,
      avatarUrl: prospect.headshot_url ? String(prospect.headshot_url) : undefined,
    });
  }
  return personas;
}

/** Autocomplete source for the player /twitter slash command -- at most the caller's owner plus
 * their offensive and defensive cornerstone, never another member's personas. */
export async function listPlayerTwitterPersonas(input: {
  guildId: string;
  discordId: string;
}): Promise<{ personas: PlayerTwitterPersona[] }> {
  const personas = await resolveOwnedTwitterPersonas(input.guildId, input.discordId);
  return { personas: personas.map(({ key, name, handle, roleLabel }) => ({ key, name, handle, roleLabel })) };
}

/** Member-authored tweet from /twitter -- posts immediately as one of the caller's own RTI
 * personas (owner / offense / defense). Persona is re-resolved server-side so a typed value
 * that isn't theirs cannot post as someone else. */
export async function postPlayerTwitterTweet(input: {
  guildId: string;
  discordId: string;
  persona: string;
  tweetText: string;
  mentionContent?: string;
}): Promise<{ postedAs: string }> {
  await requireImmortalityLeague((await getCurrentLeagueContext(input.guildId)).leagueId);
  const personas = await resolveOwnedTwitterPersonas(input.guildId, input.discordId);
  const chosen = personas.find((row) => row.key === input.persona);
  if (!chosen) {
    if (!personas.length) throw new ApiError(400, "Create your owner and players in Origins before posting to Twitter.");
    throw new ApiError(400, `Pick one of your personas: ${personas.map((row) => row.roleLabel).join(", ")}.`);
  }

  const context = await getCurrentLeagueContext(input.guildId);
  const routes = await findServerRoutesForLeague(context.leagueId);
  const channelId = (routes?.routes as any)?.tweets_channel_id as string | null | undefined;
  if (!channelId) throw new ApiError(400, "This server has no tweets channel configured yet.");

  const posted = await postDiscordChannelMessage(channelId, {
    content: input.mentionContent?.trim() || undefined,
    embeds: [{
      author: { name: `${chosen.name} (${chosen.handle})`, icon_url: chosen.avatarUrl },
      description: input.tweetText,
      color: 0x1d9bf0,
    }],
  });
  if (!posted) throw new ApiError(502, "Discord rejected the tweet -- check the tweets channel still exists and the bot can post there.");

  const league = await supabase.from("rec_leagues").select("season_number,current_week").eq("id", context.leagueId).maybeSingle();
  await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: context.leagueId,
    season_number: Number(league.data?.season_number ?? 1),
    week_number: Number(league.data?.current_week ?? 1),
    author_kind: "player",
    author_handle: chosen.handle,
    author_display_name: chosen.name,
    body: input.tweetText,
    status: "posted",
    posted_at: new Date().toISOString(),
    source: "player_twitter",
  });
  return { postedAs: `${chosen.name} (${chosen.handle})` };
}

/** Clears whatever this generator left pending from its previous run and queues a fresh batch of
 * up to 10 tweets for this one. Safe no-op if the league has nothing tweet-worthy this week.
 * Scoped to source: "weekly_recap" only -- this used to clear every pending row for the league
 * regardless of who queued it, which would silently wipe out not-yet-posted contract-signing and
 * Media Day tweets every time this ran. */
async function generateAndQueueImmortalityTweets(leagueId: string, seasonNumber: number, weekNumber: number): Promise<void> {
  await supabase.from("rec_immortality_tweet_queue").update({ status: "cleared" })
    .eq("league_id", leagueId).eq("status", "pending").eq("source", "weekly_recap");

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
      source: "weekly_recap",
    };
  }).filter((row): row is NonNullable<typeof row> => row != null && row.body.length > 0);

  if (!rows.length) return;
  await supabase.from("rec_immortality_tweet_queue").insert(rows);
}

/** Same notable-performance bar buildCandidates uses for the host/generic recap tweets -- a
 * player-chatter tweet should always be grounded in something that actually happened this week. */
function hasNotablePerformance(line: ReturnType<typeof statLine>): boolean {
  const tds = line.passTds + line.rushTds + line.receivingTds;
  return line.passYards >= 250 || line.rushYards >= 100 || line.receivingYards >= 100
    || tds >= 2 || line.tackles >= 10 || line.sacks >= 2
    || line.interceptions >= 1 || line.forcedFumbles >= 1 || line.defensiveTds >= 1;
}

/** The stat line's headline number for a self-mode chatter tweet -- whichever category actually
 * cleared the notable bar, checked in the same priority order buildCandidates' candidates imply
 * (a big passing week is the headline even if the same player also had a modest number elsewhere). */
function primaryStatFor(line: ReturnType<typeof statLine>): { value: number; statLabel: string } {
  if (line.passYards >= 250) return { value: line.passYards, statLabel: "pass yards" };
  if (line.rushYards >= 100) return { value: line.rushYards, statLabel: "rush yards" };
  if (line.receivingYards >= 100) return { value: line.receivingYards, statLabel: "receiving yards" };
  const tds = line.passTds + line.rushTds + line.receivingTds;
  if (tds >= 2) return { value: tds, statLabel: "touchdowns" };
  if (line.tackles >= 10) return { value: line.tackles, statLabel: "tackles" };
  if (line.sacks >= 2) return { value: line.sacks, statLabel: "sacks" };
  if (line.interceptions >= 1) return { value: line.interceptions, statLabel: "interceptions" };
  if (line.forcedFumbles >= 1) return { value: line.forcedFumbles, statLabel: "forced fumbles" };
  return { value: line.defensiveTds, statLabel: "defensive touchdowns" };
}

/** Synthesizes an in-fiction "@FirstLast" handle for ANY rec_players row (real NFL/CPU roster
 * fill, not just RTI custom prospects) -- generalizes immortality.service.ts's prospect-only
 * twitterHandleForProspect to a plain full_name string. */
function handleForPlayerName(fullName: string | null | undefined): { handle: string; displayName: string } {
  const displayName = (fullName ?? "").trim() || "Player";
  const slug = displayName.replace(/[^A-Za-z0-9]/g, "") || "Player";
  return { handle: `@${slug}`, displayName };
}

/** Occasional player-vs-player chatter once real per-week stats land -- real/CPU roster players
 * only. RTI custom prospects are never the AUTHOR of an auto-generated tweet here (they can still
 * be the TARGET of a teammate/rival tweet) -- per direction, a prospect's own tweets only ever
 * come from the user's own Media Day answers, not random auto-generation. 0-2 chatter tweets per
 * league per week, each behind its own random roll so it reads as occasional, not a metronome. */
async function queuePlayerChatterAfterImport(leagueId: string, seasonNumber: number, weekNumber: number): Promise<void> {
  const { weekRows } = await loadWeekAndSeasonStats(leagueId, seasonNumber, weekNumber);
  const authorCandidates = weekRows.filter((row) =>
    !String(row.player.maddenPlayerId ?? "").startsWith(IS_CUSTOM_PROSPECT_PREFIX)
    && hasNotablePerformance(statLine(row.stats as Record<string, unknown>)));
  if (!authorCandidates.length) return;

  const chatterCount = (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.25 ? 1 : 0);
  if (!chatterCount) return;

  const results = await supabase.from("rec_game_results")
    .select("home_team_id,away_team_id").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber);
  const opponentTeamIdByTeamId = new Map<string, string>();
  for (const g of (results.data ?? []) as Array<{ home_team_id: string | null; away_team_id: string | null }>) {
    if (g.home_team_id && g.away_team_id) {
      opponentTeamIdByTeamId.set(String(g.home_team_id), String(g.away_team_id));
      opponentTeamIdByTeamId.set(String(g.away_team_id), String(g.home_team_id));
    }
  }

  for (let i = 0; i < chatterCount; i += 1) {
    await queueOnePlayerChatterTweet(leagueId, seasonNumber, weekNumber, authorCandidates, opponentTeamIdByTeamId).catch((err) =>
      console.error(`[ERROR] Player chatter tweet failed for league ${leagueId} (non-fatal):`, err));
  }
}

async function queueOnePlayerChatterTweet(
  leagueId: string, seasonNumber: number, weekNumber: number,
  authorCandidates: Array<{ player_id: string; stats: unknown; player: PlayerInfo }>,
  opponentTeamIdByTeamId: Map<string, string>,
): Promise<void> {
  const author = authorCandidates[Math.floor(Math.random() * authorCandidates.length)]!;
  const line = statLine(author.stats as Record<string, unknown>);
  const authorTeamId = author.player.team?.id ? String(author.player.team.id) : null;
  // A curated top-5-per-team player gets their persisted voice/tone (player-personas.service.ts)
  // instead of ad-hoc synthesis + a flat random split -- consistent personality across weeks.
  const persona = await playerPersonaFor(leagueId, author.player_id);
  const { handle, displayName } = persona
    ? { handle: persona.handle, displayName: persona.displayName }
    : handleForPlayerName(author.player.fullName);
  const userHandles = await userOwnedHandlesForLeague(leagueId);
  if (userHandles.has(handle.toLowerCase())) return;
  const tonePraiseWeight = persona?.tonePraiseWeight ?? null;
  const authorTeamName = teamLabel(author.player.team);

  const modeRoll = Math.random();
  const mode: "self" | "teammate" | "rival" = modeRoll < 0.35 ? "self" : modeRoll < 0.7 ? "teammate" : "rival";

  let targetPlayer: string | null = null;
  let targetTeamName: string | null = null;
  let tone: "praise" | "instigate" = "praise";

  if (mode === "teammate" && authorTeamId) {
    const rows = await supabase.from("rec_players").select("full_name")
      .eq("league_id", leagueId).eq("team_id", authorTeamId).neq("id", author.player_id);
    const list = ((rows.data ?? []) as Array<{ full_name: string | null }>).filter((r) => r.full_name);
    if (list.length) {
      targetPlayer = list[Math.floor(Math.random() * list.length)]!.full_name;
      tone = Math.random() < (tonePraiseWeight ?? 0.7) ? "praise" : "instigate";
    }
  }
  // Rival mode, or teammate mode that found no eligible teammate (e.g. a solo roster slot) --
  // targets this week's actual opponent roster half the time, any other league player the other
  // half, chosen fresh each tweet rather than a fixed setting either way.
  if ((mode === "rival" || (mode === "teammate" && !targetPlayer)) && authorTeamId) {
    const rivalTeamId = Math.random() < 0.5 ? opponentTeamIdByTeamId.get(authorTeamId) ?? null : null;
    const rows = rivalTeamId
      ? await supabase.from("rec_players").select("full_name,team_id").eq("league_id", leagueId).eq("team_id", rivalTeamId)
      : await supabase.from("rec_players").select("full_name,team_id").eq("league_id", leagueId).neq("team_id", authorTeamId).not("team_id", "is", null);
    const list = ((rows.data ?? []) as Array<{ full_name: string | null; team_id: string | null }>).filter((r) => r.full_name && r.team_id);
    if (list.length) {
      const picked = list[Math.floor(Math.random() * list.length)]!;
      targetPlayer = picked.full_name;
      const teamRow = await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", picked.team_id!).maybeSingle();
      targetTeamName = teamLabel(teamRow.data);
      tone = Math.random() < (tonePraiseWeight != null ? 1 - tonePraiseWeight : 0.6) ? "instigate" : "praise";
    }
  }

  const effectiveMode: "self" | "teammate" | "rival" = targetPlayer ? mode : "self";
  const templates = effectiveMode === "self"
    ? PLAYER_CHATTER_TEMPLATES.filter((tmpl) => tmpl.mode === "self")
    : PLAYER_CHATTER_TEMPLATES.filter((tmpl) => tmpl.mode === effectiveMode && tmpl.tone === tone);
  const template = pick(templates);
  if (!template) return;

  const opponentTeamId = authorTeamId ? opponentTeamIdByTeamId.get(authorTeamId) ?? null : null;
  const opponentTeamRow = opponentTeamId
    ? await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", opponentTeamId).maybeSingle()
    : { data: null };
  const primaryStat = primaryStatFor(line);

  const body = fillTemplate(template.text, {
    player: displayName, team: authorTeamName, opponent: teamLabel(opponentTeamRow.data),
    value: primaryStat.value, statLabel: primaryStat.statLabel,
    targetPlayer: targetPlayer ?? undefined, targetTeam: targetTeamName ?? undefined,
    targetHandle: targetPlayer ? handleForPlayerName(targetPlayer).handle : undefined,
  });
  if (!body) return;

  await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: leagueId, season_number: seasonNumber, week_number: weekNumber,
    author_kind: "player", author_handle: handle, author_display_name: displayName,
    body, status: "pending", source: "player_chatter",
  });
}

/** Called on a plain interval sweep (apps/api/src/index.ts) -- posts at most one pending tweet
 * per league every 4 minutes, oldest-queued first. Cheap when idle: a single filtered query.
 * Was 4 hours, then 20 minutes; Media Day and player /twitter now feed the same queue, so a
 * 20-minute gate left a just-finished interview sitting silent for most of an hour. 4 minutes
 * still reads as a drip, not a dump. */
export async function sweepImmortalityTweetQueue(): Promise<void> {
  const POST_COOLDOWN_MS = 4 * 60 * 1000;

  const leaguesWithPending = await supabase.from("rec_immortality_tweet_queue")
    .select("league_id").eq("status", "pending");
  const leagueIds: string[] = Array.from(new Set((leaguesWithPending.data ?? []).map((row: any) => String(row.league_id))));
  if (!leagueIds.length) return;

  for (const leagueId of leagueIds) {
    try {
      await sanitizePendingAutoTweets(leagueId);
      const lastPosted = await supabase.from("rec_immortality_tweet_queue")
        .select("posted_at").eq("league_id", leagueId).eq("status", "posted")
        .order("posted_at", { ascending: false }).limit(1).maybeSingle();
      // node-postgres hands timestamptz columns back as real Date objects, not ISO strings --
      // comparing one to a string cutoff with `>` silently coerces the string via Number() (which
      // can't parse an ISO date) to NaN, so every comparison was false and this cooldown never
      // actually gated anything. Normalize both sides to epoch ms before comparing.
      const lastPostedAtMs = lastPosted.data?.posted_at ? new Date(lastPosted.data.posted_at as any).getTime() : 0;
      if (lastPostedAtMs > Date.now() - POST_COOLDOWN_MS) continue;

      const next = await supabase.from("rec_immortality_tweet_queue")
        .select("id,author_handle,author_display_name,body,source")
        .eq("league_id", leagueId).eq("status", "pending")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (!next.data) continue;

      const routes = await findServerRoutesForLeague(leagueId).catch(() => null);
      const channelId = (routes?.routes as any)?.tweets_channel_id as string | null | undefined;
      if (!channelId) continue;

      const claimed = await supabase.from("rec_immortality_tweet_queue")
        .update({ status: "posted", posted_at: new Date().toISOString() })
        .eq("id", String(next.data.id)).eq("status", "pending")
        .select("id,author_handle,author_display_name,body,source").maybeSingle();
      if (!claimed.data) continue; // another tick already claimed this row
      try {
        const body = normalizeTweetBody(claimed.data.body);
        if (body && !USER_AUTHORED_TWEET_SOURCES.has(String(claimed.data.source ?? ""))) {
          const postedSame = await supabase.from("rec_immortality_tweet_queue")
            .select("id,body").eq("league_id", leagueId).eq("status", "posted").neq("id", String(claimed.data.id));
          const duplicate = ((postedSame.data ?? []) as Array<{ body: string }>)
            .some((row) => normalizeTweetBody(row.body) === body);
          if (duplicate) {
            await supabase.from("rec_immortality_tweet_queue")
              .update({ status: "cleared", posted_at: null }).eq("id", String(claimed.data.id));
            continue;
          }
        }
        let handle = String(claimed.data.author_handle);
        let displayName = String(claimed.data.author_display_name);
        const source = String(claimed.data.source ?? "");
        if (!USER_AUTHORED_TWEET_SOURCES.has(source)) {
          const userHandles = await userOwnedHandlesForLeague(leagueId);
          if (userHandles.has(handle.toLowerCase())) {
            const author = pickCatalogTweetAuthor(seedFromId(String(claimed.data.id)));
            handle = author.handle;
            displayName = author.displayName;
            await supabase.from("rec_immortality_tweet_queue").update({
              author_kind: author.authorKind, author_handle: handle, author_display_name: displayName,
            }).eq("id", String(claimed.data.id));
          }
        }
        const iconUrl = staticAvatarUrlForHandle(handle)
          ?? await playerPersonaAvatarForHandle(leagueId, handle)
          ?? (USER_AUTHORED_TWEET_SOURCES.has(source) ? await prospectAvatarUrlForHandle(leagueId, handle) : null)
          ?? undefined;
        // Mentions inside the embed description below never actually notify anyone on Discord --
        // any fictional handle in the body that resolves to a real linked member gets a genuine
        // ping in `content` instead, alongside (not replacing) the embed.
        const pingIds = await resolveMentionDiscordIds(leagueId, String(claimed.data.body ?? ""));
        await postDiscordChannelMessage(channelId, {
          content: pingIds.length ? pingIds.map((id) => `<@${id}>`).join(" ") : undefined,
          embeds: [{
            author: { name: `${displayName} (${handle})`, icon_url: iconUrl },
            description: claimed.data.body,
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

  await sweepAmbientFanChatter();
  await sweepTweetConversations();
}

const AMBIENT_CHATTER_COOLDOWN_MS = 90 * 60 * 1000;

/** Fan/hater chatter about a random active prospect that doesn't depend on any game result --
 * reuses the existing "praise"/"taunt" template categories (already written generically enough to
 * not require a real stat line), filtered down to the variants that don't reference a game
 * ({opponent}/{score}/{week}). Gives the feed something happening even between games (a bye week,
 * between imports). Outside gameplaySeasonStages entirely -- true preseason/training camp or the
 * wider offseason pipeline, where literally zero games have been played this season -- falls back
 * to "camp_buzz" instead: praise/taunt's "been good all season" framing presupposes a season
 * already in progress, which reads as nonsense before Week 1. */
async function queueAmbientFanChatterIfDue(recLeagueId: string, immortalityLeagueId: string): Promise<void> {
  const last = await supabase.from("rec_immortality_tweet_queue")
    .select("created_at").eq("league_id", recLeagueId).eq("source", "ambient")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const lastAtMs = last.data?.created_at ? new Date(last.data.created_at as any).getTime() : 0;
  if (lastAtMs > Date.now() - AMBIENT_CHATTER_COOLDOWN_MS) return;
  // Only fires on a fraction of the sweep ticks that clear the cooldown, so it reads as
  // occasional chatter rather than a metronome going off exactly every 90 minutes.
  if (Math.random() > 0.4) return;

  const league = await supabase.from("rec_leagues")
    .select("season_number,current_week,season_stage,game").eq("id", recLeagueId).maybeSingle();
  if (!league.data) return;
  const inGameplayStage = gameplaySeasonStages(league.data.game as LeagueGame).has(String(league.data.season_stage ?? ""));

  const prospects = await supabase.from("rec_immortality_prospects")
    .select("first_name,last_name,player_id").eq("immortality_league_id", immortalityLeagueId).not("player_id", "is", null);
  const rows = (prospects.data ?? []) as Array<{ first_name: string | null; last_name: string | null; player_id: string }>;
  if (!rows.length) return;
  const target = rows[Math.floor(Math.random() * rows.length)]!;
  const playerName = `${target.first_name ?? ""} ${target.last_name ?? ""}`.trim() || "That player";

  const playerRow = await supabase.from("rec_players").select("team_id").eq("id", target.player_id).maybeSingle();
  const team = playerRow.data?.team_id
    ? await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", playerRow.data.team_id).maybeSingle()
    : { data: null };
  const teamName = formatTeamDisplayName(team.data) ?? "their team";

  const category: TweetCategory = inGameplayStage ? (Math.random() < 0.5 ? "praise" : "taunt") : "camp_buzz";
  const templates = TWEET_TEMPLATES.filter((tmpl) => tmpl.category === category
    && !tmpl.text.includes("{opponent}") && !tmpl.text.includes("{score}") && !tmpl.text.includes("{week}") && !tmpl.text.includes("{margin}"));
  const template = pick(templates) as TweetTemplate | null;
  if (!template) return;
  const body = fillTemplate(template.text, { player: playerName, team: teamName });
  if (!body) return;
  const author = resolveAuthor(template.voice);

  await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: recLeagueId,
    season_number: Number(league.data.season_number ?? 1),
    week_number: Number(league.data.current_week ?? 1),
    author_kind: author.authorKind, author_handle: author.handle, author_display_name: author.displayName,
    body, status: "pending", source: "ambient",
  });
}

async function sweepAmbientFanChatter(): Promise<void> {
  const leagues = await supabase.from("rec_immortality_leagues").select("id,league_id");
  for (const row of (leagues.data ?? []) as Array<{ id: string; league_id: string }>) {
    await queueAmbientFanChatterIfDue(row.league_id, row.id).catch((err) =>
      console.error(`[ERROR] Ambient fan chatter failed for league ${row.league_id} (non-fatal):`, err));
  }
}

const MAX_ACTIVE_CONVERSATIONS = 4;
const CONVERSATION_SOURCE_PREFIX = "conversation:";

type FeedAccount = {
  authorKind: "host" | "generic" | "player";
  handle: string;
  displayName: string;
  traits?: string[];
  tonePraiseWeight?: number;
  mentionOnly?: boolean;
};

type ConversationRow = {
  id: string;
  league_id: string;
  participant_handles: string[];
  last_author_handle: string;
  last_target_handle: string;
  last_body: string;
  used_keys: string[];
  turn_count: number;
  max_turns: number;
};

function conversationSource(id: string): string {
  return `${CONVERSATION_SOURCE_PREFIX}${id}`;
}

function snippetOf(body: string): string {
  const cleaned = body.replace(/\s+/g, " ").trim();
  return cleaned.length <= 72 ? cleaned : `${cleaned.slice(0, 72).trim()}…`;
}

async function loadFeedAccounts(leagueId: string): Promise<FeedAccount[]> {
  const [personas, userHandles] = await Promise.all([
    listPlayerPersonasForLeague(leagueId),
    userOwnedHandlesForLeague(leagueId),
  ]);
  return [
    ...personas.map((persona) => ({
      authorKind: "player" as const,
      handle: persona.handle,
      displayName: persona.displayName,
      traits: persona.traits,
      tonePraiseWeight: persona.tonePraiseWeight,
    })),
    ...Object.values(TWEET_HOSTS).map((host) => ({
      authorKind: "host" as const, handle: host.handle, displayName: host.displayName,
    })),
    ...GENERIC_HANDLES.map((account) => ({
      authorKind: "generic" as const, handle: account.handle, displayName: account.displayName,
    })),
  ].filter((account) => !userHandles.has(account.handle.toLowerCase()));
}

function pickFeedAccount(accounts: FeedAccount[], exclude: Set<string>, preferPlayer: boolean): FeedAccount | null {
  const blocked = new Set([...exclude].map((handle) => handle.toLowerCase()));
  const pool = accounts.filter((account) => !account.mentionOnly && !blocked.has(account.handle.toLowerCase()));
  if (!pool.length) return null;
  const players = pool.filter((account) => account.authorKind === "player");
  const source = preferPlayer && players.length && Math.random() < 0.7 ? players : pool;
  return source[Math.floor(Math.random() * source.length)] ?? null;
}

function accountByHandle(accounts: FeedAccount[], handle: string): FeedAccount | null {
  const needle = handle.toLowerCase();
  return accounts.find((account) => account.handle.toLowerCase() === needle) ?? null;
}

function lineForAccount(account: FeedAccount, kind: ConversationKind, usedKeys: Iterable<string>): string | null {
  const catalog = personaForHandle(account.handle);
  const playerVoice = account.authorKind === "player"
    ? playerVoiceFromTraits({ traits: account.traits, tonePraiseWeight: account.tonePraiseWeight })
    : null;
  return selectConversationLine({
    kind,
    family: catalog?.family ?? playerVoice?.family ?? "player_mixed",
    moods: catalog?.moods ?? playerVoice?.moods ?? ["hype", "witty", "trash"],
    vulgar: catalog?.vulgar ?? playerVoice?.vulgar ?? true,
    signatures: catalog?.signatures[kind] ?? [],
    usedKeys,
  });
}

async function recentAuthorUsedKeys(leagueId: string, handle: string): Promise<string[]> {
  const recent = await supabase.from("rec_immortality_tweet_queue")
    .select("body,source").eq("league_id", leagueId).eq("author_handle", handle)
    .order("created_at", { ascending: false }).limit(20);
  return ((recent.data ?? []) as Array<{ body: string; source: string | null }>)
    .filter((row) => String(row.source ?? "").startsWith(CONVERSATION_SOURCE_PREFIX))
    .slice(0, 12)
    .map((row) => conversationTemplateKey(String(row.body ?? "")));
}

const CONVERSATION_QUOTE_CONNECTORS: Array<(snippet: string, reaction: string) => string> = [
  (snippet, reaction) => `"${snippet}" — ${reaction}`,
  (snippet, reaction) => `On "${snippet}": ${reaction}`,
  (snippet, reaction) => `re: "${snippet}" — ${reaction}`,
  (snippet, reaction) => `Saw this — "${snippet}." ${reaction}`,
  (snippet, reaction) => `${reaction} ("${snippet}")`,
  (snippet, reaction) => `Quoting "${snippet}" here: ${reaction}`,
];

async function queueConversationTweet(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  conversationId: string;
  author: FeedAccount;
  target: FeedAccount;
  kind: ConversationKind;
  usedKeys: string[];
  snippet?: string;
}): Promise<{ body: string; key: string } | null> {
  const prior = [...input.usedKeys, ...await recentAuthorUsedKeys(input.leagueId, input.author.handle)];
  const template = lineForAccount(input.author, input.kind, prior);
  if (!template) return null;
  const reaction = fillTemplate(template, {
    toHandle: input.target.handle,
    toName: input.target.displayName,
    fromName: input.author.displayName,
    snippet: input.snippet,
  });
  // The authored line banks are pure reaction text ("I need a second look before I climb on
  // that.") with nothing concrete for the reader to attach to -- none of them actually spend
  // their {snippet} slot even though queueConversationTweet has always threaded a real one
  // through (the tweet being replied to, or literally what the other account just said this
  // turn). Quoting it here grounds the reaction in something real without needing to hand-author
  // a snippet-referencing variant of every one of the ~100 lines in tweet-bank-conversations.ts.
  const body = input.snippet && !template.includes("{snippet}")
    ? CONVERSATION_QUOTE_CONNECTORS[Math.floor(Math.random() * CONVERSATION_QUOTE_CONNECTORS.length)]!(input.snippet, reaction)
    : reaction;
  if (!body) return null;
  const inserted = await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    author_kind: input.author.authorKind,
    author_handle: input.author.handle,
    author_display_name: input.author.displayName,
    body,
    status: "pending",
    source: conversationSource(input.conversationId),
  });
  if (inserted.error) {
    console.error(`[ERROR] Failed to queue conversation tweet for league ${input.leagueId}:`, inserted.error);
    return null;
  }
  return { body, key: conversationTemplateKey(template) };
}

async function concludeConversation(id: string): Promise<void> {
  await supabase.from("rec_immortality_tweet_conversations").delete().eq("id", id);
}

async function continueConversation(
  leagueId: string,
  seasonNumber: number,
  weekNumber: number,
  convo: ConversationRow,
  accounts: FeedAccount[],
): Promise<void> {
  const pending = await supabase.from("rec_immortality_tweet_queue")
    .select("id").eq("league_id", leagueId).eq("status", "pending")
    .eq("source", conversationSource(convo.id)).limit(1).maybeSingle();
  if (pending.data) return;

  const participants = new Set(convo.participant_handles);
  let author = accountByHandle(accounts, convo.last_target_handle)
    ?? pickFeedAccount(accounts, new Set([convo.last_author_handle]), false);
  let target = accountByHandle(accounts, convo.last_author_handle)
    ?? { authorKind: "generic" as const, handle: convo.last_author_handle, displayName: convo.last_author_handle, mentionOnly: true };
  if (author?.mentionOnly) {
    author = pickFeedAccount(accounts, new Set([convo.last_author_handle, convo.last_target_handle]), false);
  }
  if (participants.size < 3 && Math.random() < 0.18) {
    const interloper = pickFeedAccount(accounts, new Set([convo.last_author_handle, convo.last_target_handle]), true);
    if (interloper) {
      author = interloper;
      target = accountByHandle(accounts, convo.last_author_handle) ?? target;
    }
  }
  if (!author || author.mentionOnly || !target || author.handle.toLowerCase() === target.handle.toLowerCase()) return;

  const kind: ConversationKind = convo.turn_count >= convo.max_turns - 1
    ? "clapback"
    : (Math.random() < 0.65 ? "reply" : "clapback");
  const queued = await queueConversationTweet({
    leagueId, seasonNumber, weekNumber, conversationId: convo.id,
    author, target, kind, usedKeys: convo.used_keys, snippet: snippetOf(convo.last_body),
  });
  if (!queued) return;

  const nextTurn = convo.turn_count + 1;
  if (nextTurn >= convo.max_turns) {
    await concludeConversation(convo.id);
    return;
  }
  await supabase.from("rec_immortality_tweet_conversations").update({
    participant_handles: Array.from(new Set([...convo.participant_handles, author.handle, target.handle])),
    last_author_handle: author.handle,
    last_target_handle: target.handle,
    last_body: queued.body,
    used_keys: [...convo.used_keys, queued.key],
    turn_count: nextTurn,
    updated_at: new Date().toISOString(),
  }).eq("id", convo.id);
}

async function startConversation(
  leagueId: string,
  seasonNumber: number,
  weekNumber: number,
  accounts: FeedAccount[],
): Promise<void> {
  const recent = await supabase.from("rec_immortality_tweet_queue")
    .select("author_handle,author_display_name,body,source")
    .eq("league_id", leagueId).eq("status", "posted")
    .order("posted_at", { ascending: false }).limit(16);
  const recentRows = (recent.data ?? []) as Array<{ author_handle: string; author_display_name: string; body: string; source: string | null }>;
  const recentPairs = new Set(
    recentRows
      .filter((row) => String(row.source ?? "").startsWith(CONVERSATION_SOURCE_PREFIX))
      .map((row) => `${String(row.author_handle).toLowerCase()}|${conversationTemplateKey(String(row.body ?? ""))}`),
  );

  let author: FeedAccount | null = null;
  let target: FeedAccount | null = null;
  let kind: ConversationKind = "mention";
  let snippet: string | undefined;
  const replyable = recentRows.filter((row) => !String(row.source ?? "").startsWith(CONVERSATION_SOURCE_PREFIX));
  if (replyable.length && Math.random() < 0.7) {
    const original = replyable[Math.floor(Math.random() * replyable.length)]!;
    author = pickFeedAccount(accounts, new Set([original.author_handle]), true);
    target = accountByHandle(accounts, original.author_handle) ?? {
      authorKind: "generic", handle: original.author_handle, displayName: original.author_display_name,
      mentionOnly: true,
    };
    kind = "reply";
    snippet = snippetOf(original.body);
  } else {
    author = pickFeedAccount(accounts, new Set(), true);
    target = author ? pickFeedAccount(accounts, new Set([author.handle]), true) : null;
    kind = "mention";
  }
  if (!author || author.mentionOnly || !target) return;
  const pairKey = `${author.handle.toLowerCase()}|${target.handle.toLowerCase()}`;
  if (recentPairs.has(pairKey)) return;

  const maxTurns = 3 + Math.floor(Math.random() * 3);
  const created = await supabase.from("rec_immortality_tweet_conversations").insert({
    league_id: leagueId,
    participant_handles: [author.handle, target.handle],
    last_author_handle: author.handle,
    last_target_handle: target.handle,
    last_body: "",
    used_keys: [],
    turn_count: 0,
    max_turns: maxTurns,
  }).select("id").maybeSingle();
  if (created.error || !created.data) {
    console.error(`[ERROR] Failed to start tweet conversation for league ${leagueId}:`, created.error);
    return;
  }

  const queued = await queueConversationTweet({
    leagueId, seasonNumber, weekNumber, conversationId: String(created.data.id),
    author, target, kind, usedKeys: [], snippet,
  });
  if (!queued) {
    await concludeConversation(String(created.data.id));
    return;
  }
  await supabase.from("rec_immortality_tweet_conversations").update({
    last_body: queued.body,
    used_keys: [queued.key],
    turn_count: 1,
    updated_at: new Date().toISOString(),
  }).eq("id", String(created.data.id));
}

async function queueConversationsForLeague(leagueId: string): Promise<void> {
  const existing = await supabase.from("rec_immortality_player_personas")
    .select("player_id", { count: "exact", head: true }).eq("league_id", leagueId);
  if ((existing.count ?? 0) < 8) {
    await ensurePlayerPersonasForLeague(leagueId).catch((err) =>
      console.error(`[ERROR] Player persona generation failed for league ${leagueId} (non-fatal):`, err));
  }

  const league = await supabase.from("rec_leagues")
    .select("season_number,current_week").eq("id", leagueId).maybeSingle();
  if (!league.data) return;
  const seasonNumber = Number(league.data.season_number ?? 1);
  const weekNumber = Number(league.data.current_week ?? 1);
  const accounts = await loadFeedAccounts(leagueId);
  if (accounts.length < 2) return;

  const active = await supabase.from("rec_immortality_tweet_conversations")
    .select("id,league_id,participant_handles,last_author_handle,last_target_handle,last_body,used_keys,turn_count,max_turns")
    .eq("league_id", leagueId)
    .order("updated_at", { ascending: true });
  if (active.error) {
    console.error(`[ERROR] Failed to load tweet conversations for league ${leagueId}:`, active.error);
    return;
  }
  const rows = (active.data ?? []) as ConversationRow[];
  for (const convo of rows) {
    if (Math.random() < 0.8) {
      await continueConversation(leagueId, seasonNumber, weekNumber, convo, accounts);
    }
  }

  const remaining = MAX_ACTIVE_CONVERSATIONS - ((await supabase.from("rec_immortality_tweet_conversations")
    .select("id", { count: "exact", head: true }).eq("league_id", leagueId)).count ?? rows.length);
  if (remaining > 0 && Math.random() < 0.55) {
    await startConversation(leagueId, seasonNumber, weekNumber, accounts);
  }
}

async function sweepTweetConversations(): Promise<void> {
  const leagues = await supabase.from("rec_immortality_leagues").select("league_id");
  for (const row of (leagues.data ?? []) as Array<{ league_id: string }>) {
    await queueConversationsForLeague(row.league_id).catch((err) =>
      console.error(`[ERROR] Tweet conversations failed for league ${row.league_id} (non-fatal):`, err));
  }
}

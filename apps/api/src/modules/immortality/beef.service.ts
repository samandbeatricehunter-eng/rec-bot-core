// Twitter beef bridge -- see docs/handoff's SOCIAL_SYSTEM_ARCHITECTURE.md "Story arcs" section
// and the rti_pair_story/rti_owner_receipt event types + rti_beef storyline type, which existed
// fully built (playbooks, storyline mapping, a scoring consumer in unified-weekly-challenge.
// service.ts) but were never connected to a real trigger before this file. Despite the "rti_"
// naming, nothing about these event types or their playbooks is actually RTI-specific --
// subjectKey is generically "player:<id>"/"team:<id>" -- so this runs for every league, RTI or
// not; it just also has an RTI-specific instigator-scoring path where a real prospect signal
// exists (rtiProspectToneWeight) instead of the non-RTI random-pick persona.
//
// Two entry points:
//  - reactToTargetedTweet: called after a user-composed, opponent-targeted tweet publishes
//    (publishUserSubmittedTweet). Opens/continues a beef storyline for whoever got targeted; if
//    the tweet's OWN author turns out to already be an open beef's subject (i.e. they're
//    replying to being called out), reacts to the reply's tone instead of starting a new arc.
//  - queueAutonomousBeefTweets: called from the advance flow (mirrors queuePregameHypeTweets).
//    For each qualifying just-completed game (rivalry / division / playoff / clutch), picks an
//    instigate-leaning player on one side and an inverse-position player (or the team itself) on
//    the other, and queues a claim-grounded callout.
import {
  classifyReplyTone, moveForReplyTone, regularSeasonWeeks, type LeagueGame, type SocialEventType,
} from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { loadGameRivalries } from "../rivalries/rivalries.service.js";
import { buildClaimGroundedPostBody, pickReactivePersona, reactivePersonaAuthor } from "./social-claim-engine.js";
import { findOpenStorylineForSubject, touchOrOpenStoryline } from "./media-storylines.service.js";
import { rtiProspectToneWeight } from "./player-personas.service.js";
import type { TweetTarget } from "./tweet-generation.service.js";

/** One-score-or-closer final margin counts as a "clutch" qualifying game. */
const CLUTCH_MARGIN = 7;

/** A single fixed lookup event type for "does an open beef storyline exist for this subject" --
 *  rti_pair_story and rti_owner_receipt both map to the same rti_beef storyline_type (see
 *  STORYLINE_TYPE_BY_EVENT), so either works identically for a read-only existence check. */
const BEEF_LOOKUP_EVENT: SocialEventType = "rti_owner_receipt";

function eventTypeForSubject(hasPlayerId: boolean): SocialEventType {
  return hasPlayerId ? "rti_pair_story" : "rti_owner_receipt";
}

async function queueBeefTweet(input: {
  leagueId: string; seasonNumber: number; weekNumber: number;
  author: { authorKind: "host"; handle: string; displayName: string };
  body: string;
  parentTweetId?: string | null;
  target: TweetTarget;
}): Promise<void> {
  await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: input.leagueId, season_number: input.seasonNumber, week_number: input.weekNumber,
    author_kind: input.author.authorKind, author_handle: input.author.handle, author_display_name: input.author.displayName,
    body: input.body, status: "pending", source: "beef",
  });
  await supabase.from("rec_tweets").insert({
    league_id: input.leagueId,
    author_key: `host:${input.author.handle}`,
    body: input.body,
    status: "posted",
    posted_at: new Date().toISOString(),
    parent_tweet_id: input.parentTweetId ?? null,
    root_tweet_id: input.parentTweetId ?? null,
    target_kind: input.target.kind,
    target_team_id: input.target.teamId ?? null,
    target_user_id: input.target.userId ?? null,
    target_player_id: input.target.playerId ?? null,
    target_label: input.target.label,
  });
}

// ── Reacting to a manually targeted tweet ──

/** Called (best-effort, fire-and-forget) after publishUserSubmittedTweet posts a tweet that
 *  named a target. If the AUTHOR is themselves the subject of an already-open beef (someone
 *  targeted them earlier and this is their reply), classifies this reply's tone and posts a
 *  reactive-persona follow-up threaded onto it. Otherwise this is a fresh callout: opens/
 *  continues a beef storyline for the TARGET so a later reply from them is recognized -- no
 *  auto-reply fires just from being called out, only an actual reply does. */
export async function reactToTargetedTweet(input: {
  leagueId: string; seasonNumber: number; weekNumber: number;
  tweetId: string | null;
  authorTeamId: string | null;
  authorUserId: string | null;
  /** The RTI persona's own underlying rec_players.id (offense/defense personas only) -- checked
   *  first, more specific than team/user, since a "player"-kind beef storyline is stored with
   *  teamId/userId both null and only playerId set. Without this, a called-out RTI prospect's
   *  reply (posted as their own offense/defense persona) was never recognized as a reply -- only
   *  team- or owner-targeted beefs ever triggered the tone-aware reaction. */
  authorPlayerId?: string | null;
  authorLabel: string;
  body: string;
  target: TweetTarget;
}): Promise<void> {
  const authorStoryline = input.authorPlayerId
    ? await findOpenStorylineForSubject({ leagueId: input.leagueId, eventType: BEEF_LOOKUP_EVENT, playerId: input.authorPlayerId }).catch(() => null)
    : input.authorTeamId
      ? await findOpenStorylineForSubject({ leagueId: input.leagueId, eventType: BEEF_LOOKUP_EVENT, teamId: input.authorTeamId }).catch(() => null)
      : input.authorUserId
        ? await findOpenStorylineForSubject({ leagueId: input.leagueId, eventType: BEEF_LOOKUP_EVENT, userId: input.authorUserId }).catch(() => null)
        : null;

  if (authorStoryline) {
    const tone = classifyReplyTone(input.body);
    const move = moveForReplyTone(tone);
    const persona = pickReactivePersona({});
    const factLine = `${input.authorLabel} responded: "${input.body.slice(0, 240)}"`;
    const subjectKey = input.authorPlayerId
      ? `player:${input.authorPlayerId}`
      : input.authorTeamId ? `team:${input.authorTeamId}` : `owner:${input.authorUserId}`;
    const body = await buildClaimGroundedPostBody({
      leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber,
      eventType: eventTypeForSubject(Boolean(input.authorPlayerId)), persona, subjectKey, factLine, preferredMove: move,
      teamId: input.authorPlayerId ? null : input.authorTeamId,
      userId: input.authorPlayerId ? null : input.authorUserId,
      playerId: input.authorPlayerId ?? null,
      storylineTitle: authorStoryline.title,
    }).catch((error) => {
      console.error("[ERROR] buildClaimGroundedPostBody failed for beef reply reaction (non-fatal):", error);
      return null;
    });
    if (!body) return;

    const author = reactivePersonaAuthor(persona);
    await queueBeefTweet({
      leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber,
      author, body, parentTweetId: input.tweetId,
      target: input.authorPlayerId
        ? { kind: "player", playerId: input.authorPlayerId, teamId: input.authorTeamId, label: input.authorLabel }
        : input.authorTeamId
          ? { kind: "team", teamId: input.authorTeamId, label: input.authorLabel }
          : { kind: "owner", userId: input.authorUserId, label: input.authorLabel },
    });
    return;
  }

  await touchOrOpenStoryline({
    leagueId: input.leagueId, eventType: eventTypeForSubject(input.target.kind === "player"),
    teamId: input.target.kind === "team" ? input.target.teamId ?? null : null,
    userId: input.target.kind === "owner" ? input.target.userId ?? null : null,
    playerId: input.target.kind === "player" ? input.target.playerId ?? null : null,
    title: `${input.authorLabel} vs. ${input.target.label}`,
    evidenceLine: `${input.authorLabel}: "${input.body.slice(0, 240)}"`,
  }).catch((error) => console.error("[ERROR] touchOrOpenStoryline for targeted tweet failed (non-fatal):", error));
}

// ── Autonomous instigation ──

export type QualifyingReason = "rivalry" | "division" | "playoff" | "clutch";
type QualifyingGame = { gameId: string; homeTeamId: string; awayTeamId: string; reason: QualifyingReason };

/** Pure classification, split out from findQualifyingGames below for direct unit testing.
 *  Priority order when a game qualifies more than one way: rivalry > playoff > division > clutch
 *  -- rivalry/playoff carry more built-in narrative weight than a plain close game. */
export function classifyQualifyingReason(input: {
  isRivalry: boolean; isPlayoff: boolean; homeDivision: string | null; awayDivision: string | null;
  homeScore: number | null; awayScore: number | null; clutchMargin?: number;
}): QualifyingReason | null {
  const margin = input.homeScore != null && input.awayScore != null ? Math.abs(input.homeScore - input.awayScore) : null;
  const isDivision = Boolean(input.homeDivision) && input.homeDivision === input.awayDivision;
  const isClutch = margin != null && margin > 0 && margin <= (input.clutchMargin ?? CLUTCH_MARGIN);
  if (input.isRivalry) return "rivalry";
  if (input.isPlayoff) return "playoff";
  if (isDivision) return "division";
  if (isClutch) return "clutch";
  return null;
}

async function findQualifyingGames(leagueId: string, weekNumber: number, game: LeagueGame): Promise<QualifyingGame[]> {
  const rows = await supabase.from("rec_games")
    .select("id,home_team_id,away_team_id,home_score,away_score,phase,status,rivalry_id,home_team:rec_teams!rec_games_home_team_id_fkey(division),away_team:rec_teams!rec_games_away_team_id_fkey(division)")
    .eq("league_id", leagueId).eq("week_number", weekNumber).eq("status", "completed");
  if (rows.error || !rows.data?.length) return [];

  const gameIds = (rows.data as any[]).map((row) => String(row.id));
  const rivalryByGame = await loadGameRivalries(gameIds);
  const isPlayoffWeek = weekNumber > regularSeasonWeeks(game);

  const out: QualifyingGame[] = [];
  for (const row of rows.data as any[]) {
    const homeTeamId = String(row.home_team_id);
    const awayTeamId = String(row.away_team_id);
    const reason = classifyQualifyingReason({
      isRivalry: Boolean(rivalryByGame.get(String(row.id))?.enabled),
      isPlayoff: row.phase === "playoffs" || isPlayoffWeek,
      homeDivision: row.home_team?.division ?? null,
      awayDivision: row.away_team?.division ?? null,
      homeScore: row.home_score == null ? null : Number(row.home_score),
      awayScore: row.away_score == null ? null : Number(row.away_score),
    });
    if (reason) out.push({ gameId: String(row.id), homeTeamId, awayTeamId, reason });
  }
  return out;
}

function reasonLine(reason: QualifyingReason): string {
  switch (reason) {
    case "rivalry": return "a rivalry matchup";
    case "division": return "a division matchup";
    case "playoff": return "a playoff matchup";
    case "clutch": return "a one-score finish";
  }
}

export type InstigatorCandidate = { playerId: string; playerName: string; position: string | null; toneWeight: number };

/** Candidate instigators on one team: the pre-generated top-5 non-RTI player personas (see
 *  player-personas.service.ts) plus any real RTI prospects on the roster, scored the same way
 *  (toneWeightFromTraitNames) either from their stored random-pick traits or their real answered
 *  persona-DNA. Lower toneWeight = more instigate-leaning. */
async function instigatingCandidatesForTeam(leagueId: string, teamId: string): Promise<InstigatorCandidate[]> {
  const roster = await supabase.from("rec_players").select("id,full_name,position").eq("league_id", leagueId).eq("team_id", teamId);
  const rosterRows = (roster.data ?? []) as Array<{ id: string; full_name: string | null; position: string | null }>;
  const playerIds = rosterRows.map((row) => String(row.id));
  if (!playerIds.length) return [];
  const metaById = new Map(rosterRows.map((row) => [String(row.id), { name: row.full_name ?? "Player", position: row.position }]));

  const [personas, prospects] = await Promise.all([
    supabase.from("rec_immortality_player_personas").select("player_id,tone_praise_weight").eq("league_id", leagueId).in("player_id", playerIds),
    supabase.from("rec_immortality_prospects").select("id,player_id").in("player_id", playerIds),
  ]);

  const candidates: InstigatorCandidate[] = [];
  for (const row of (personas.data ?? []) as Array<{ player_id: string; tone_praise_weight: number | null }>) {
    const meta = metaById.get(String(row.player_id));
    if (!meta) continue;
    candidates.push({ playerId: String(row.player_id), playerName: meta.name, position: meta.position, toneWeight: Number(row.tone_praise_weight ?? 0.5) });
  }
  for (const row of (prospects.data ?? []) as Array<{ id: string; player_id: string }>) {
    const playerId = String(row.player_id);
    if (candidates.some((c) => c.playerId === playerId)) continue;
    const meta = metaById.get(playerId);
    if (!meta) continue;
    const toneWeight = await rtiProspectToneWeight(String(row.id));
    candidates.push({ playerId, playerName: meta.name, position: meta.position, toneWeight });
  }
  return candidates;
}

/** Below-neutral (< 0.5) tonePraiseWeight leans instigate; picks the single most instigate-
 *  leaning candidate, or null if nobody on this roster leans that way this week. */
export function pickMostInstigating(candidates: InstigatorCandidate[]): InstigatorCandidate | null {
  const eligible = candidates.filter((c) => c.toneWeight < 0.5).sort((a, b) => a.toneWeight - b.toneWeight);
  return eligible[0] ?? null;
}

/** Small, hand-authored inverse-position map -- who on the OTHER side of the ball is the natural
 *  target for a callout from this position. Falls back to the opposing roster's highest-OVR
 *  player when the instigator's position isn't covered (kickers/punters, unusual positions) or
 *  nobody on the opposing roster plays a mapped position. */
export const INVERSE_POSITIONS: Partial<Record<string, string[]>> = {
  QB: ["LEDGE", "REDGE", "DT"],
  HB: ["MIKE", "WILL", "SAM", "DT"],
  FB: ["MIKE", "WILL", "SAM"],
  WR: ["CB", "FS", "SS"],
  TE: ["SS", "MIKE", "WILL"],
  LT: ["REDGE"], RT: ["LEDGE"], LG: ["DT"], RG: ["DT"], C: ["DT"],
  LEDGE: ["LT", "RT"], REDGE: ["LT", "RT"],
  DT: ["C", "LG", "RG"],
  MIKE: ["HB", "FB"], WILL: ["WR", "TE"], SAM: ["WR", "TE"],
  CB: ["WR"], FS: ["WR", "TE"], SS: ["TE", "HB"],
};

async function pickTargetPlayer(leagueId: string, teamId: string, instigatorPosition: string | null): Promise<{ playerId: string; playerName: string } | null> {
  const roster = await supabase.from("rec_players").select("id,full_name,position,overall_rating").eq("league_id", leagueId).eq("team_id", teamId);
  const rows = (roster.data ?? []) as Array<{ id: string; full_name: string | null; position: string | null; overall_rating: number | null }>;
  if (!rows.length) return null;
  const candidatePositions = instigatorPosition ? INVERSE_POSITIONS[instigatorPosition] ?? [] : [];
  const pool = candidatePositions.length ? rows.filter((row) => candidatePositions.includes(String(row.position ?? ""))) : [];
  const chosen = [...(pool.length ? pool : rows)].sort((a, b) => Number(b.overall_rating ?? 0) - Number(a.overall_rating ?? 0))[0];
  if (!chosen) return null;
  return { playerId: String(chosen.id), playerName: chosen.full_name ?? "Player" };
}

async function teamDisplayNames(teamIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(teamIds)];
  if (!unique.length) return new Map();
  const rows = await supabase.from("rec_teams").select("id,name,display_city,display_nick,is_relocated").in("id", unique);
  const map = new Map<string, string>();
  for (const row of (rows.data ?? []) as any[]) {
    map.set(String(row.id), formatTeamDisplayName(row) ?? String(row.name ?? "Team"));
  }
  return map;
}

async function teamActiveOwnerUserId(leagueId: string, teamId: string): Promise<string | null> {
  const row = await supabase.from("rec_team_assignments").select("user_id")
    .eq("league_id", leagueId).eq("team_id", teamId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  return row.data?.user_id ? String(row.data.user_id) : null;
}

/**
 * Called from the advance flow (mirrors queuePregameHypeTweets' call site in
 * advance-results.service.ts) for the week that just completed. For each qualifying game --
 * rivalry, division, playoff, or a one-score finish -- rolls whether either side has an
 * instigate-leaning player this week and, if so, has them call out an inverse-position player (or
 * the team itself, if no clean position match exists) on the other side. Runs for every league,
 * RTI or not -- unlike queuePregameHypeTweets, this is not RTI-gated.
 */
export async function queueAutonomousBeefTweets(input: {
  leagueId: string; seasonNumber: number; weekNumber: number; game: LeagueGame;
}): Promise<void> {
  const qualifying = await findQualifyingGames(input.leagueId, input.weekNumber, input.game);
  if (!qualifying.length) return;

  const names = await teamDisplayNames(qualifying.flatMap((row) => [row.homeTeamId, row.awayTeamId]));

  for (const game of qualifying) {
    const [homeCandidates, awayCandidates] = await Promise.all([
      instigatingCandidatesForTeam(input.leagueId, game.homeTeamId),
      instigatingCandidatesForTeam(input.leagueId, game.awayTeamId),
    ]);
    const homeInstigator = pickMostInstigating(homeCandidates);
    const awayInstigator = pickMostInstigating(awayCandidates);
    if (!homeInstigator && !awayInstigator) continue;

    const instigatorIsHome = Boolean(homeInstigator) && (!awayInstigator || homeInstigator!.toneWeight <= awayInstigator.toneWeight);
    const instigator = (instigatorIsHome ? homeInstigator : awayInstigator)!;
    const instigatorTeamId = instigatorIsHome ? game.homeTeamId : game.awayTeamId;
    const opponentTeamId = instigatorIsHome ? game.awayTeamId : game.homeTeamId;

    const targetPlayer = await pickTargetPlayer(input.leagueId, opponentTeamId, instigator.position).catch(() => null);
    const targetLabel = targetPlayer?.playerName ?? names.get(opponentTeamId) ?? "their opponent";
    const instigatorTeamName = names.get(instigatorTeamId) ?? "This team";
    const opponentTeamName = names.get(opponentTeamId) ?? "their opponent";

    const factLine = `${instigator.playerName} (${instigatorTeamName}) called out ${targetLabel} ahead of ${reasonLine(game.reason)} against ${opponentTeamName}.`;
    const persona = pickReactivePersona({});
    const targetOwnerUserId = targetPlayer ? null : await teamActiveOwnerUserId(input.leagueId, opponentTeamId);

    const body = await buildClaimGroundedPostBody({
      leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber,
      eventType: eventTypeForSubject(Boolean(targetPlayer)),
      persona, subjectKey: targetPlayer ? `player:${targetPlayer.playerId}` : `team:${opponentTeamId}`,
      factLine, storylineTitle: `${instigator.playerName} vs. ${targetLabel}`,
      teamId: targetPlayer ? null : opponentTeamId, userId: targetPlayer ? null : targetOwnerUserId, playerId: targetPlayer?.playerId ?? null,
      gameId: game.gameId, importanceScore: 30,
    }).catch((error) => {
      console.error(`[ERROR] buildClaimGroundedPostBody failed for autonomous beef (game ${game.gameId}, non-fatal):`, error);
      return null;
    });
    if (!body) continue;

    const author = reactivePersonaAuthor(persona);
    await queueBeefTweet({
      leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, author, body,
      target: targetPlayer
        ? { kind: "player", playerId: targetPlayer.playerId, teamId: opponentTeamId, label: targetLabel }
        : { kind: "team", teamId: opponentTeamId, label: targetLabel },
    }).catch((error) => console.error(`[ERROR] queueBeefTweet failed for autonomous beef (game ${game.gameId}, non-fatal):`, error));
  }
}

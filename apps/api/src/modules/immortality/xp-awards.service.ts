import {
  characteristicCatalog,
  combinedModifiers,
  evaluateChallengeCondition,
  FORMULA_VERSIONS,
  gameplaySeasonStages,
  pointsForCareerTier,
  pointsForSeasonTier,
  pointsForWeeklyTier,
  pointsToXp,
  pointsTowardNextLevel,
  positionGroupFor,
  RECORD_SET_BONUS_POINTS,
  WEEKLY_SWEEP_BONUS_PCT,
  XP_POINTS_PER_LEVEL,
  type CharacteristicModifiers,
  type ImmortalityDevTrait,
  type ImmortalityPosition,
  type IssuedChallenge,
  type LeagueGame,
} from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { loadImmortalityLeague } from "./immortality.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { leagueWeekGamesQuery } from "../league-context/league-games.query.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";

function numericStats(stats: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats ?? {})) {
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function sumStats(rows: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) out[key] = (out[key] ?? 0) + value;
  }
  const attempts = out.pass_attempts ?? 0;
  if (attempts > 0 && out.pass_completions != null) out.completion_pct = (out.pass_completions / attempts) * 100;
  return out;
}

async function modifiersForProspect(prospect: { id: string; position: string }): Promise<CharacteristicModifiers> {
  const traits = await supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id);
  const catalog = characteristicCatalog(positionGroupFor(prospect.position as ImmortalityPosition));
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  return combinedModifiers(selected);
}

export async function grantAbilitySlot(input: {
  prospectId: string;
  eventType: string;
  sourceId: string;
}): Promise<{ granted: boolean }> {
  const inserted = await supabase.from("rec_immortality_ability_grants").insert({
    prospect_id: input.prospectId,
    event_type: input.eventType,
    source_id: input.sourceId,
    slots: 1,
  }).select("id").maybeSingle();
  if (inserted.error) {
    if (inserted.error.code === "23505") return { granted: false };
    console.error(`[ERROR] Could not grant ability slot for prospect ${input.prospectId}:`, inserted.error);
    return { granted: false };
  }
  return { granted: Boolean(inserted.data) };
}

export async function creditXpPoints(input: {
  prospectId: string;
  eventType: string;
  sourceId: string;
  points: number;
  season?: number;
  week?: number;
  modifiers: CharacteristicModifiers;
}): Promise<{ duplicate: boolean; xpGranted: number }> {
  const awarded = Math.max(0, Math.round(input.points * (1 + input.modifiers.xpEarnBonus)));
  const prospect = await supabase.from("rec_immortality_prospects").select("xp_points_balance").eq("id", input.prospectId).maybeSingle();
  if (!prospect.data) return { duplicate: true, xpGranted: 0 };
  const start = Number(prospect.data.xp_points_balance ?? 0);
  const total = start + awarded;
  const xpGranted = pointsToXp(total);
  const remainder = pointsTowardNextLevel(total);
  const inserted = await supabase.from("rec_immortality_xp_ledger").insert({
    prospect_id: input.prospectId,
    season: input.season ?? null,
    week: input.week ?? null,
    event_type: input.eventType,
    source_id: input.sourceId,
    player_xp_delta: xpGranted,
    team_xp_delta: 0,
    formula_version: FORMULA_VERSIONS.xp,
  }).select("id").maybeSingle();
  if (inserted.error) {
    if (inserted.error.code === "23505") return { duplicate: true, xpGranted: 0 };
    console.error(`[ERROR] Could not credit XP points for prospect ${input.prospectId}:`, inserted.error);
    return { duplicate: true, xpGranted: 0 };
  }
  await supabase.from("rec_immortality_prospects").update({
    xp_points_balance: remainder,
    updated_at: new Date().toISOString(),
  }).eq("id", input.prospectId);
  return { duplicate: false, xpGranted };
}

export async function awardRecordBreakPoints(prospectId: string, sourceId: string): Promise<void> {
  const prospect = await supabase.from("rec_immortality_prospects").select("id,position").eq("id", prospectId).maybeSingle();
  if (!prospect.data) return;
  const modifiers = await modifiersForProspect(prospect.data);
  await creditXpPoints({
    prospectId,
    eventType: "nfl_record_broken",
    sourceId,
    points: RECORD_SET_BONUS_POINTS,
    modifiers,
  });
}

async function weeklyStatsForPlayer(input: {
  leagueId: string;
  playerId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<Record<string, number>> {
  const rows = await supabase.from("rec_player_weekly_stats")
    .select("stats")
    .eq("league_id", input.leagueId)
    .eq("season_number", input.seasonNumber)
    .eq("week_number", input.weekNumber)
    .eq("player_id", input.playerId);
  return sumStats((rows.data ?? []).map((row) => numericStats(row.stats as Record<string, unknown>)));
}

async function rangeStatsForPlayer(input: {
  leagueId: string;
  playerId: string;
  fromSeason?: number;
  toSeason?: number;
  seasonNumber?: number;
}): Promise<Record<string, number>> {
  let query = supabase.from("rec_player_weekly_stats").select("stats,season_number").eq("league_id", input.leagueId).eq("player_id", input.playerId);
  if (input.seasonNumber != null) query = query.eq("season_number", input.seasonNumber);
  const rows = await query;
  const filtered = (rows.data ?? []).filter((row) => {
    const season = Number(row.season_number ?? 0);
    if (input.fromSeason != null && season < input.fromSeason) return false;
    if (input.toSeason != null && season > input.toSeason) return false;
    return true;
  });
  return sumStats(filtered.map((row) => numericStats(row.stats as Record<string, unknown>)));
}

export type WeeklyChallengeView = {
  prospectId: string;
  side: string;
  name: string;
  position: string;
  challenges: IssuedChallenge[];
};

export async function weeklyChallengesForUser(input: {
  leagueId: string;
  userId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<WeeklyChallengeView[]> {
  const immortality = await loadImmortalityLeague(input.leagueId);
  if (!immortality) return [];
  const prospects = await supabase.from("rec_immortality_prospects")
    .select("id,side,position,first_name,last_name,player_id")
    .eq("immortality_league_id", immortality.id)
    .eq("user_id", input.userId);
  const views: WeeklyChallengeView[] = [];
  for (const prospect of prospects.data ?? []) {
    const stats = prospect.player_id
      ? await weeklyStatsForPlayer({
        leagueId: input.leagueId,
        playerId: String(prospect.player_id),
        seasonNumber: input.seasonNumber,
        weekNumber: input.weekNumber,
      })
      : {};
    const seed = `${immortality.id}:${input.seasonNumber}:${input.weekNumber}:${prospect.id}`;
    // Resolves through the same frozen-issuance path gradeProspectForWeek grades against, so the
    // display view here and the eventual grading pass always agree on which challenge was shown.
    const { resolveIssuedWeeklyChallenges } = await import("./challenge-issuance.service.js");
    const challenges = await resolveIssuedWeeklyChallenges({
      prospectId: String(prospect.id), position: String(prospect.position), seed,
      seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, stats,
    });
    views.push({
      prospectId: String(prospect.id),
      side: String(prospect.side),
      name: `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Player",
      position: String(prospect.position),
      challenges,
    });
  }
  return views;
}

// Rivalries: +25% flat on top of a rivalry game's weekly-challenge XP, plus up to another +50%
// (+10%/season) the longer the SAME rival has been kept without being changed -- see
// rec_immortality_rivals.unchanged_since_season, which setImmortalityRival resets on any actual
// change. Challenge thresholds are "elevated" for a rivalry week by evaluating completion against
// a scaled-down copy of the real stats (so the same authored label pool requires genuinely more
// production to clear, without needing a whole second set of harder milestone content).
const RIVALRY_BASE_BONUS_PCT = 0.25;
const RIVALRY_STREAK_BONUS_PER_SEASON_PCT = 0.10;
const RIVALRY_STREAK_BONUS_CAP_PCT = 0.50;
const RIVALRY_CHALLENGE_ELEVATION = 1.15;
const RIVALRY_WIN_BONUS_COINS = 500;
// Season Trend promotion opportunities (see createSeasonTrendPromotion in progression.service.ts):
// a much steeper version of the same stat-elevation trick above, applied to that week's
// already-issued Gold weekly challenge rather than authoring bespoke "elevated" content. First-
// pass number, same as every other unreleased threshold in this system -- Pass 11's simulation
// work is where this actually gets calibrated against real data.
const PROMOTION_OPPORTUNITY_ELEVATION = 1.5;

function rivalryMultiplier(streakSeasons: number): number {
  const streakBonus = Math.min(RIVALRY_STREAK_BONUS_PER_SEASON_PCT * Math.max(0, streakSeasons - 1), RIVALRY_STREAK_BONUS_CAP_PCT);
  return 1 + RIVALRY_BASE_BONUS_PCT + streakBonus;
}

function elevateStatsForRivalry(stats: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) out[key] = value / RIVALRY_CHALLENGE_ELEVATION;
  return out;
}

type RivalryContext = { isRivalryGame: boolean; multiplier: number; streakSeasons: number; won: boolean };

async function rivalryContextForProspect(input: {
  immortalityLeagueId: string; recLeagueId: string; userId: string; side: "offense" | "defense";
  myTeamId: string | null; seasonNumber: number; weekNumber: number;
}): Promise<RivalryContext> {
  const none: RivalryContext = { isRivalryGame: false, multiplier: 1, streakSeasons: 0, won: false };
  if (!input.myTeamId) return none;
  const rivals = await supabase.from("rec_immortality_rivals")
    .select("rival_team_id,unchanged_since_season")
    .eq("immortality_league_id", input.immortalityLeagueId).eq("user_id", input.userId).eq("side", input.side);
  if (!(rivals.data ?? []).length) return none;

  const seasonId = await resolveSeasonId(input.recLeagueId, input.seasonNumber);
  const game = await leagueWeekGamesQuery(supabase, { leagueId: input.recLeagueId, seasonId, weekNumber: input.weekNumber }, "home_team_id,away_team_id,home_score,away_score,status")
    .or(`home_team_id.eq.${input.myTeamId},away_team_id.eq.${input.myTeamId}`).maybeSingle();
  if (!game.data) return none;
  const iAmHome = String(game.data.home_team_id) === input.myTeamId;
  const opponentTeamId = iAmHome ? game.data.away_team_id : game.data.home_team_id;
  if (!opponentTeamId) return none;

  const match = (rivals.data ?? []).find((row: any) => String(row.rival_team_id) === String(opponentTeamId));
  if (!match) return none;

  const streakSeasons = Math.max(1, input.seasonNumber - Number(match.unchanged_since_season) + 1);
  const won = game.data.status === "final" && game.data.home_score != null && game.data.away_score != null
    && (iAmHome ? Number(game.data.home_score) > Number(game.data.away_score) : Number(game.data.away_score) > Number(game.data.home_score));
  return { isRivalryGame: true, multiplier: rivalryMultiplier(streakSeasons), streakSeasons, won };
}

/** "Extra game day promotion" for a rivalry matchup -- a Discord headline story, the same
 * elevated-hype treatment the existing GOTW nomination flow gives its own marquee games, rather
 * than building a second parallel promotion system. Idempotent per (prospect, season, week) via
 * the generated headline as the dedup key, same pattern ensureSignedContractAnnouncement uses. */
async function postRivalryPromotionIfDue(input: { leagueId: string; seasonNumber: number; weekNumber: number; prospectId: string }): Promise<void> {
  const prospect = await supabase.from("rec_immortality_prospects").select("first_name,last_name").eq("id", input.prospectId).maybeSingle();
  if (!prospect.data) return;
  const name = `${prospect.data.first_name ?? ""} ${prospect.data.last_name ?? ""}`.trim() || "This prospect";
  const headline = `Rivalry Week: ${name} Takes the Field Against a Rival`;
  const existing = await supabase.from("rec_game_stories").select("id")
    .eq("league_id", input.leagueId).eq("primary_angle", "rti_rivalry_promotion").eq("headline", headline)
    .eq("season", input.seasonNumber).eq("week", input.weekNumber).limit(1);
  if ((existing.data ?? []).length) return;
  const routes = await findServerRoutesForLeague(input.leagueId);
  if (!routes?.guildId) return;
  const { publishTransitionStory } = await import("../hub/story-publishing.js");
  await publishTransitionStory({
    guildId: routes.guildId, primaryAngle: "rti_rivalry_promotion", headline,
    body: `This week's game is personal. ${name} and this franchise are settling a rivalry on the field this week — extra stakes, extra stat lines, extra bragging rights on the line.`,
  });
}

/** Same award pass, triggered directly off an EA import instead of waiting for a commissioner to
 * click Advance -- mirrors queueImmortalityTweetsAfterImport in tweet-generation.service.ts.
 * Safe to call redundantly alongside the Advance-triggered path: creditXpPoints/creditOrBacklog
 * are both idempotent per (prospect, sourceId), so a week already awarded via one path is a
 * no-op via the other. */
export async function awardImmortalityChallengesAfterImport(leagueId: string): Promise<void> {
  const league = await supabase.from("rec_leagues")
    .select("season_number,current_week,season_stage,game").eq("id", leagueId).maybeSingle();
  if (!league.data) return;
  await awardImmortalityChallengesAfterAdvance({
    leagueId,
    seasonNumber: Number(league.data.season_number ?? 1),
    weekNumber: Number(league.data.current_week ?? 1),
    seasonStage: String(league.data.season_stage ?? ""),
    game: league.data.game as LeagueGame,
  });
}

export async function awardImmortalityChallengesAfterAdvance(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  seasonStage: string;
  game: LeagueGame;
}): Promise<void> {
  if (!gameplaySeasonStages(input.game).has(input.seasonStage)) return;
  const immortality = await loadImmortalityLeague(input.leagueId);
  if (!immortality) return;
  // Runs before grading so a just-adopted or just-gone-stale identity is reflected the same
  // pass -- both the import path and the Advance-button path route through this one function,
  // so hooking it here (rather than at each of the 3 call sites) covers all of them at once.
  const { reconcileRtiProspectIdentities } = await import("./player-identity.service.js");
  await reconcileRtiProspectIdentities(input.leagueId).catch((error) => {
    console.error(`[ERROR] RTI identity reconciliation failed for league ${input.leagueId} (non-fatal):`, error);
  });
  const prospects = await supabase.from("rec_immortality_prospects")
    .select("id,position,player_id,user_id,side,identity_status")
    .eq("immortality_league_id", immortality.id);
  for (const prospect of prospects.data ?? []) {
    if (!prospect.player_id) continue;
    await gradeProspectForWeek(prospect, {
      leagueId: input.leagueId,
      immortalityLeagueId: String(immortality.id),
      seasonNumber: input.seasonNumber,
      weekNumber: input.weekNumber,
    });
  }
  const { evaluateSeasonTrendPromotionsAfterAdvance } = await import("./progression.service.js");
  await evaluateSeasonTrendPromotionsAfterAdvance({
    leagueId: input.leagueId,
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
  });

  const { awardOwnerXpForWeek } = await import("./owner-progression.service.js");
  await awardOwnerXpForWeek({
    leagueId: input.leagueId,
    immortalityLeagueId: String(immortality.id),
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
  }).catch((error) => {
    console.error(`[ERROR] Owner XP award failed for league ${input.leagueId} (non-fatal):`, error);
  });
}

/** Grades one prospect's weekly/season/career challenges for one advance and credits any XP
 * earned. Extracted from awardImmortalityChallengesAfterAdvance's per-prospect loop body so
 * player-identity.service.ts's regradeProspectHistory can re-run the exact same grading for a
 * single prospect across past weeks after a manual identity fix -- every credit below is
 * idempotent via its sourceId, so re-running an already-graded week is always a safe no-op. */
export async function gradeProspectForWeek(
  prospect: { id: string; position: string; player_id: string; user_id: string; side: string; identity_status?: string | null },
  input: { leagueId: string; immortalityLeagueId: string; seasonNumber: number; weekNumber: number },
): Promise<void> {
  // No fallback stats: a prospect whose real Madden identity isn't confirmed (or has gone stale)
  // never gets XP credited off whatever stat line happens to be sitting at player_id today --
  // see player-identity.service.ts for how this gets resolved and regraded once fixed.
  if (prospect.identity_status && ["missing", "ambiguous", "stale", "matched_pending_apply"].includes(prospect.identity_status)) {
    return;
  }
  const modifiers = await modifiersForProspect({ id: String(prospect.id), position: String(prospect.position) });
  const weekStats = await weeklyStatsForPlayer({
    leagueId: input.leagueId,
    playerId: String(prospect.player_id),
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
  });

  const playerTeam = await supabase.from("rec_players").select("team_id").eq("id", prospect.player_id).maybeSingle();
  const rivalry = await rivalryContextForProspect({
    immortalityLeagueId: input.immortalityLeagueId, recLeagueId: input.leagueId,
    userId: String(prospect.user_id), side: prospect.side as "offense" | "defense",
    myTeamId: playerTeam.data?.team_id ? String(playerTeam.data.team_id) : null,
    seasonNumber: input.seasonNumber, weekNumber: input.weekNumber,
  }).catch((error) => {
    console.error(`[ERROR] Rivalry context lookup failed for prospect ${prospect.id} (non-fatal):`, error);
    return { isRivalryGame: false, multiplier: 1, streakSeasons: 0, won: false } as RivalryContext;
  });

  const seed = `${input.immortalityLeagueId}:${input.seasonNumber}:${input.weekNumber}:${prospect.id}`;
  const challengeStats = rivalry.isRivalryGame ? elevateStatsForRivalry(weekStats) : weekStats;
  const { resolveIssuedWeeklyChallenges, resolveIssuedSeasonChallenges, resolveIssuedCareerChallenges } = await import("./challenge-issuance.service.js");
  const weekly = await resolveIssuedWeeklyChallenges({
    prospectId: String(prospect.id), position: String(prospect.position), seed,
    seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, stats: challengeStats,
  });
  // Gold weekly challenges no longer grant an ability slot -- ability access is meant to come
  // from progression ownership, dev trait, and Madden eligibility, not challenge completion.
  let weeklyPointsAwarded = 0;
  const completedWeekly = weekly.filter((row) => row.complete);
  for (const challenge of completedWeekly) {
    const points = Math.round(pointsForWeeklyTier(challenge.tier as "bronze" | "silver" | "gold") * rivalry.multiplier);
    weeklyPointsAwarded += points;
    await creditXpPoints({
      prospectId: String(prospect.id),
      eventType: `weekly_${challenge.tier}`,
      sourceId: `${input.seasonNumber}:${input.weekNumber}:${challenge.tier}`,
      points,
      season: input.seasonNumber,
      week: input.weekNumber,
      modifiers,
    });
  }
  if (rivalry.isRivalryGame && rivalry.won) {
    const { creditOrBacklog } = await import("../economy/economy-backlog.js");
    await creditOrBacklog({
      leagueId: input.leagueId,
      seasonNumber: input.seasonNumber,
      userId: String(prospect.user_id),
      amount: Math.round(RIVALRY_WIN_BONUS_COINS * rivalry.multiplier),
      description: `Rise to Immortality rivalry win bonus — Week ${input.weekNumber} (${Math.round((rivalry.multiplier - 1) * 100)}% bonus)`,
      transactionType: "immortality_rivalry_win",
      source: "rivalry",
      sourceReference: { prospectId: prospect.id, week: input.weekNumber, season: input.seasonNumber, streakSeasons: rivalry.streakSeasons },
    }).catch((error) => console.error(`[ERROR] Rivalry win coin bonus failed for prospect ${prospect.id} (non-fatal):`, error));
  }
  if (rivalry.isRivalryGame) {
    await postRivalryPromotionIfDue({
      leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, prospectId: String(prospect.id),
    }).catch((error) => console.error(`[ERROR] Rivalry promotion post failed for prospect ${prospect.id} (non-fatal):`, error));
  }
  // Universal Weekly Sweep (all 3 tiers complete -> +30%) and Competitive Drive (2+ of 3
  // complete -> +5%) both apply as a single additive percentage on top of the completed
  // challenges' own points -- never compounded, and never gated behind owning a specific
  // characteristic for the Sweep bonus. Both conditions can apply the same week.
  const sweptAll = weekly.length === 3 && completedWeekly.length === 3;
  const competitiveDriveEligible = completedWeekly.length >= 2 && modifiers.competitiveDriveBonusPct > 0;
  const weeklyBonusPct = (sweptAll ? WEEKLY_SWEEP_BONUS_PCT : 0) + (competitiveDriveEligible ? modifiers.competitiveDriveBonusPct : 0);
  if (weeklyBonusPct > 0 && weeklyPointsAwarded > 0) {
    await creditXpPoints({
      prospectId: String(prospect.id),
      eventType: "weekly_bonus",
      sourceId: `${input.seasonNumber}:${input.weekNumber}:bonus`,
      points: Math.round(weeklyPointsAwarded * weeklyBonusPct),
      season: input.seasonNumber,
      week: input.weekNumber,
      modifiers,
    });
  }

  // Season Trend promotion-opportunity resolution: if a prior advance granted this prospect an
  // opportunity targeting exactly this (season, week) -- see createSeasonTrendPromotion's doc
  // comment in progression.service.ts -- check it now against this week's already-issued Gold
  // weekly challenge, evaluated against elevated stats. No new content authored; this reuses the
  // same challenge every other player at this position saw this week, just at a steeper bar.
  const opportunity = await supabase.from("rec_immortality_promotion_opportunities")
    .select("id,from_trait,to_trait")
    .eq("prospect_id", prospect.id)
    .eq("status", "pending")
    .eq("target_season_number", input.seasonNumber)
    .eq("target_week_number", input.weekNumber)
    .maybeSingle();
  if (!opportunity.error && opportunity.data) {
    const goldChallenge = weekly.find((row) => row.tier === "gold");
    const elevatedStats: Record<string, number> = {};
    for (const [key, value] of Object.entries(challengeStats)) elevatedStats[key] = value / PROMOTION_OPPORTUNITY_ELEVATION;
    const met = Boolean(goldChallenge?.label && evaluateChallengeCondition(goldChallenge.condition, elevatedStats));
    await supabase.from("rec_immortality_promotion_opportunities")
      .update({ status: met ? "met" : "missed", resolved_at: new Date().toISOString() })
      .eq("id", opportunity.data.id);
    if (met) {
      const name = await supabase.from("rec_immortality_prospects").select("first_name,last_name").eq("id", prospect.id).maybeSingle();
      const { createSeasonTrendPromotion } = await import("./progression.service.js");
      await createSeasonTrendPromotion({
        leagueId: input.leagueId,
        immortalityLeagueId: input.immortalityLeagueId,
        prospect: {
          id: String(prospect.id), user_id: String(prospect.user_id), position: String(prospect.position),
          first_name: name.data?.first_name ?? null, last_name: name.data?.last_name ?? null,
          player_id: String(prospect.player_id), side: String(prospect.side),
        },
        fromTrait: opportunity.data.from_trait as ImmortalityDevTrait,
        toTrait: opportunity.data.to_trait as ImmortalityDevTrait,
        seasonNumber: input.seasonNumber,
        reason: `Delivered an elevated Week ${input.weekNumber} performance to convert their promotion opportunity.`,
      }).catch((error) => console.error(`[ERROR] Could not record earned season-trend promotion for ${prospect.id} (non-fatal):`, error));
    }
  }

  const seasonStats = await rangeStatsForPlayer({
    leagueId: input.leagueId,
    playerId: String(prospect.player_id),
    seasonNumber: input.seasonNumber,
  });
  const seasonSeed = `${input.immortalityLeagueId}:${input.seasonNumber}:${prospect.id}:season`;
  const seasonChallenges = await resolveIssuedSeasonChallenges({
    prospectId: String(prospect.id), position: String(prospect.position), seed: seasonSeed,
    seasonNumber: input.seasonNumber, stats: seasonStats,
  });
  for (const challenge of seasonChallenges) {
    if (!challenge.complete) continue;
    const tier = (challenge.tier === "tier2" || challenge.tier === "tier3" ? challenge.tier : "tier1") as "tier1" | "tier2" | "tier3";
    await creditXpPoints({
      prospectId: String(prospect.id),
      eventType: `season_${tier}`,
      sourceId: `${input.seasonNumber}:${challenge.id}`,
      points: pointsForSeasonTier(tier),
      season: input.seasonNumber,
      modifiers,
    });
    await grantAbilitySlot({
      prospectId: String(prospect.id),
      eventType: `season_${tier}`,
      sourceId: `${input.seasonNumber}:${challenge.id}`,
    });
  }

  const careerStats = await rangeStatsForPlayer({
    leagueId: input.leagueId,
    playerId: String(prospect.player_id),
  });
  const careerSeed = `${input.immortalityLeagueId}:${prospect.id}:career`;
  const careerChallenges = await resolveIssuedCareerChallenges({
    prospectId: String(prospect.id), position: String(prospect.position), seed: careerSeed, stats: careerStats,
  });
  for (const challenge of careerChallenges) {
    if (!challenge.complete) continue;
    const tier = (challenge.tier === "tier2" || challenge.tier === "tier3" ? challenge.tier : "tier1") as "tier1" | "tier2" | "tier3";
    await creditXpPoints({
      prospectId: String(prospect.id),
      eventType: `career_${tier}`,
      sourceId: challenge.id,
      points: pointsForCareerTier(tier),
      modifiers,
    });
    await grantAbilitySlot({
      prospectId: String(prospect.id),
      eventType: `career_${tier}`,
      sourceId: challenge.id,
    });
  }
}

export async function grantAbilitySlotForPlayerOfWeek(playerId: string, sourceId: string): Promise<void> {
  const player = await supabase.from("rec_players").select("madden_player_id").eq("id", playerId).maybeSingle();
  const maddenId = player.data?.madden_player_id ? String(player.data.madden_player_id) : "";
  let prospectId: string | null = maddenId.startsWith("rti:") ? maddenId.slice("rti:".length) : null;
  if (!prospectId) {
    const prospect = await supabase.from("rec_immortality_prospects").select("id").eq("player_id", playerId).maybeSingle();
    prospectId = prospect.data?.id ? String(prospect.data.id) : null;
  }
  if (!prospectId) return;
  await grantAbilitySlot({ prospectId, eventType: "player_of_week", sourceId });
}

export async function loadRtiMemberGates(input: {
  leagueId: string;
  userId: string | null;
  seasonStage: string;
  game: LeagueGame;
}): Promise<{
  rostersUnlocked: boolean;
  tradesUnlocked: boolean;
  storeUnlocked: boolean;
  teammateDevUnlocked: boolean;
  weeklyChallenges: WeeklyChallengeView[];
  playerSnapshots: Array<{
    playerId: string; playerName: string; position: string | null; side: string; headshotUrl: string | null;
    teamName: string; teamAbbr: string | null; teamLogoUrl: string | null;
    seasonLines: string[]; positionRank: number | null; positionCount: number | null; hofProgress: number;
    xpProgressPct: number;
    playerXpTotal: number;
  }>;
  playerXpTotal: number;
  teamXpTotal: number;
  pendingContracts: number;
  owner: { name: string; headshotUrl: string | null } | null;
}> {
  const storeUnlocked = gameplaySeasonStages(input.game).has(input.seasonStage);
  const imported = await supabase.from("rec_players")
    .select("id", { count: "exact", head: true })
    .eq("league_id", input.leagueId)
    .not("madden_player_id", "like", "rti:%");
  // RTI's roster fill method isn't literally a "fantasy draft" (see setup.service.ts's comment
  // on fantasy_draft_status) -- no RTI code path ever transitions that column to "concluded", so
  // gating on it here permanently locked rosters for every RTI league regardless of how much
  // progress they'd actually made. Confirmed live in M27 RTI (2026-09-08): real EA-imported
  // players existed on every roster, but this AND'd condition kept rostersUnlocked false. The
  // real signal RTI needs is just "has a real (non-placeholder) roster been imported at all,"
  // which the exists-check below already captures on its own.
  const rostersUnlocked = Number(imported.count ?? 0) > 0;
  const empty = {
    rostersUnlocked,
    tradesUnlocked: false,
    storeUnlocked,
    teammateDevUnlocked: false,
    weeklyChallenges: [] as WeeklyChallengeView[],
    playerSnapshots: [],
    playerXpTotal: 0,
    teamXpTotal: 0,
    pendingContracts: 0,
    owner: null,
  };
  if (!input.userId) return empty;
  const immortality = await loadImmortalityLeague(input.leagueId);
  if (!immortality) return empty;
  const ownerRow = await supabase.from("rec_immortality_owners")
    .select("first_name,last_name,headshot_url")
    .eq("immortality_league_id", immortality.id).eq("user_id", input.userId).maybeSingle();
  const owner = ownerRow.data
    ? { name: `${ownerRow.data.first_name ?? ""} ${ownerRow.data.last_name ?? ""}`.trim() || "Owner", headshotUrl: ownerRow.data.headshot_url ?? null }
    : null;
  const prospects = await supabase.from("rec_immortality_prospects")
    .select("id,side,position,player_id,headshot_url,xp_points_balance")
    .eq("immortality_league_id", immortality.id)
    .eq("user_id", input.userId);
  // This ran one prospect at a time (await inside the loop) -- an owner's full roster of
  // prospects each cost a separate sequential rec_immortality_prospect_characteristics round
  // trip, and this whole function sits on getHub's critical path (loadHub awaits it directly
  // for every RTI hub view), so a ~20-prospect roster alone added multiple seconds to every
  // hub load. Each prospect's modifiers are independent, so fetch them concurrently instead.
  const allModifiers = await Promise.all(
    (prospects.data ?? []).map((prospect) => modifiersForProspect({ id: String(prospect.id), position: String(prospect.position) })),
  );
  let tradesUnlocked = false;
  let teammateDevUnlocked = false;
  for (const modifiers of allModifiers) {
    tradesUnlocked = tradesUnlocked || modifiers.tradeAccess;
    teammateDevUnlocked = teammateDevUnlocked || modifiers.teammateDevPurchaseUnlocked;
  }
  const prospectIds = (prospects.data ?? []).map((row) => String(row.id));
  const pending = prospectIds.length
    ? await supabase.from("rec_immortality_contracts").select("id", { count: "exact", head: true }).in("prospect_id", prospectIds).eq("offer_status", "offered")
    : { count: 0 };
  const league = await supabase.from("rec_leagues").select("season_number,current_week").eq("id", input.leagueId).maybeSingle();
  const seasonNumber = Number(league.data?.season_number ?? 1);
  const weekNumber = Number(league.data?.current_week ?? 1);
  // Sorted offense-then-defense so playerSnapshots (built from this order below) always lines up
  // with the Media Day card's fixed offense-left/defense-right layout -- the prospects query has
  // no natural ordering guarantee otherwise.
  const playerIds = (prospects.data ?? []).slice()
    .sort((a: any, b: any) => (a.side === "offense" ? 0 : 1) - (b.side === "offense" ? 0 : 1))
    .map((row: any) => row.player_id).filter(Boolean).map(String);
  const playerTeams = playerIds.length
    ? await supabase.from("rec_players").select("id,team_id").in("id", playerIds)
    : { data: [] };
  const teamIds = new Set((playerTeams.data ?? []).map((row: any) => String(row.team_id ?? "")).filter(Boolean));
  const games = gameplaySeasonStages(input.game).has(input.seasonStage)
    ? await supabase.from("rec_games").select("home_team_id,away_team_id")
      .eq("league_id", input.leagueId).eq("week_number", weekNumber)
    : { data: [] };
  const hasGameThisWeek = gameplaySeasonStages(input.game).has(input.seasonStage)
    && (games.data ?? []).some((game: any) => teamIds.has(String(game.home_team_id)) || teamIds.has(String(game.away_team_id)));
  const weeklyChallenges = hasGameThisWeek ? await weeklyChallengesForUser({
    leagueId: input.leagueId, userId: input.userId, seasonNumber, weekNumber,
  }) : [];
  const prospectByPlayer = new Map<string, any>((prospects.data ?? []).filter((row: any) => row.player_id)
    .map((row: any) => [String(row.player_id), row]));
  const careerScores = prospectIds.length
    ? await supabase.from("rec_immortality_career_scores").select("prospect_id,career_score").in("prospect_id", prospectIds)
    : { data: [] };
  const scoreByProspect = new Map<string, number>((careerScores.data ?? []).map((row: any) => [String(row.prospect_id), Number(row.career_score ?? 0)]));
  // rec_immortality_prospects.xp_points_balance only holds the remainder toward the *next*
  // Player XP point (see creditXpPoints) -- there's no running total column, so the career total
  // shown on the card is summed from every ledger entry's already-granted whole points.
  const xpLedger = prospectIds.length
    ? await supabase.from("rec_immortality_xp_ledger").select("prospect_id,player_xp_delta,team_xp_delta").in("prospect_id", prospectIds)
    : { data: [] };
  const xpTotalByProspect = new Map<string, number>();
  let teamXpTotal = 0;
  for (const row of (xpLedger.data ?? []) as Array<{ prospect_id: string; player_xp_delta: number | null; team_xp_delta: number | null }>) {
    const key = String(row.prospect_id);
    xpTotalByProspect.set(key, (xpTotalByProspect.get(key) ?? 0) + Number(row.player_xp_delta ?? 0));
    teamXpTotal += Number(row.team_xp_delta ?? 0);
  }
  const playerSnapshots = await Promise.all(playerIds.map((playerId) => import("../league-week/pro-tracker.service.js")
    .then(({ computePlayerLine }) => computePlayerLine({ leagueId: input.leagueId, playerId, seasonNumber, weekNumber }))
    .then((snapshot) => snapshot ? ({
      ...snapshot,
      side: String(prospectByPlayer.get(playerId)?.side ?? ""),
      headshotUrl: prospectByPlayer.get(playerId)?.headshot_url ?? snapshot.headshotUrl ?? null,
      hofProgress: Math.max(0, Math.min(100, scoreByProspect.get(String(prospectByPlayer.get(playerId)?.id)) ?? 0)),
      playerXpTotal: xpTotalByProspect.get(String(prospectByPlayer.get(playerId)?.id)) ?? 0,
      // xp_points_balance already holds the remainder toward the next Player XP point (see
      // creditXpPoints -- it stores pointsTowardNextLevel, not the raw running total).
      xpProgressPct: Math.max(0, Math.min(100, (Number(prospectByPlayer.get(playerId)?.xp_points_balance ?? 0) / XP_POINTS_PER_LEVEL) * 100)),
    }) : null)));
  return {
    rostersUnlocked,
    tradesUnlocked,
    storeUnlocked,
    teammateDevUnlocked,
    weeklyChallenges,
    playerSnapshots: playerSnapshots.filter((row): row is NonNullable<typeof row> => Boolean(row)),
    playerXpTotal: [...xpTotalByProspect.values()].reduce((total, value) => total + value, 0),
    teamXpTotal,
    pendingContracts: Number(pending.count ?? 0),
    owner,
  };
}

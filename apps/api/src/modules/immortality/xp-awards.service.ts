import {
  characteristicCatalog,
  combinedModifiers,
  FORMULA_VERSIONS,
  gameplaySeasonStages,
  issuedCareerChallenges,
  issuedSeasonChallenges,
  issuedWeeklyChallenges,
  pointsForCareerTier,
  pointsForSeasonTier,
  pointsForWeeklyTier,
  pointsToXp,
  pointsTowardNextLevel,
  positionGroupFor,
  RECORD_SET_BONUS_POINTS,
  XP_POINTS_PER_LEVEL,
  type CharacteristicModifiers,
  type ImmortalityPosition,
  type IssuedChallenge,
  type LeagueGame,
} from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { loadImmortalityLeague } from "./immortality.service.js";

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
    views.push({
      prospectId: String(prospect.id),
      side: String(prospect.side),
      name: `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Player",
      position: String(prospect.position),
      challenges: issuedWeeklyChallenges({ position: String(prospect.position), seed, stats }),
    });
  }
  return views;
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
  const prospects = await supabase.from("rec_immortality_prospects")
    .select("id,position,player_id,user_id")
    .eq("immortality_league_id", immortality.id);
  for (const prospect of prospects.data ?? []) {
    if (!prospect.player_id) continue;
    const modifiers = await modifiersForProspect({ id: String(prospect.id), position: String(prospect.position) });
    const weekStats = await weeklyStatsForPlayer({
      leagueId: input.leagueId,
      playerId: String(prospect.player_id),
      seasonNumber: input.seasonNumber,
      weekNumber: input.weekNumber,
    });
    const seed = `${immortality.id}:${input.seasonNumber}:${input.weekNumber}:${prospect.id}`;
    const weekly = issuedWeeklyChallenges({ position: String(prospect.position), seed, stats: weekStats });
    for (const challenge of weekly) {
      if (!challenge.complete) continue;
      const points = pointsForWeeklyTier(challenge.tier as "bronze" | "silver" | "gold");
      await creditXpPoints({
        prospectId: String(prospect.id),
        eventType: `weekly_${challenge.tier}`,
        sourceId: `${input.seasonNumber}:${input.weekNumber}:${challenge.tier}`,
        points,
        season: input.seasonNumber,
        week: input.weekNumber,
        modifiers,
      });
      if (challenge.tier === "gold") {
        await grantAbilitySlot({
          prospectId: String(prospect.id),
          eventType: "weekly_gold",
          sourceId: `${input.seasonNumber}:${input.weekNumber}`,
        });
      }
    }
    if (weekly.length === 3 && weekly.every((row) => row.complete) && modifiers.weeklySweepBonusXp > 0) {
      await creditXpPoints({
        prospectId: String(prospect.id),
        eventType: "weekly_sweep_bonus",
        sourceId: `${input.seasonNumber}:${input.weekNumber}:sweep`,
        points: modifiers.weeklySweepBonusXp * XP_POINTS_PER_LEVEL,
        season: input.seasonNumber,
        week: input.weekNumber,
        modifiers,
      });
    }

    const seasonStats = await rangeStatsForPlayer({
      leagueId: input.leagueId,
      playerId: String(prospect.player_id),
      seasonNumber: input.seasonNumber,
    });
    const seasonSeed = `${immortality.id}:${input.seasonNumber}:${prospect.id}:season`;
    for (const challenge of issuedSeasonChallenges(String(prospect.position), seasonStats, seasonSeed)) {
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
    const careerSeed = `${immortality.id}:${prospect.id}:career`;
    for (const challenge of issuedCareerChallenges(String(prospect.position), careerStats, careerSeed)) {
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
  const { evaluateSeasonTrendPromotionsAfterAdvance } = await import("./progression.service.js");
  await evaluateSeasonTrendPromotionsAfterAdvance({
    leagueId: input.leagueId,
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
  });
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
  fantasyDraftStatus: string;
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
  }>;
  pendingContracts: number;
}> {
  const storeUnlocked = gameplaySeasonStages(input.game).has(input.seasonStage);
  const imported = await supabase.from("rec_players")
    .select("id", { count: "exact", head: true })
    .eq("league_id", input.leagueId)
    .not("madden_player_id", "like", "rti:%");
  const rostersUnlocked = input.fantasyDraftStatus === "concluded" && Number(imported.count ?? 0) > 0;
  const empty = {
    rostersUnlocked,
    tradesUnlocked: false,
    storeUnlocked,
    teammateDevUnlocked: false,
    weeklyChallenges: [] as WeeklyChallengeView[],
    playerSnapshots: [],
    pendingContracts: 0,
  };
  if (!input.userId) return empty;
  const immortality = await loadImmortalityLeague(input.leagueId);
  if (!immortality) return empty;
  const prospects = await supabase.from("rec_immortality_prospects")
    .select("id,side,position,player_id,headshot_url,xp_points_balance")
    .eq("immortality_league_id", immortality.id)
    .eq("user_id", input.userId);
  let tradesUnlocked = false;
  let teammateDevUnlocked = false;
  for (const prospect of prospects.data ?? []) {
    const modifiers = await modifiersForProspect({ id: String(prospect.id), position: String(prospect.position) });
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
    ? await supabase.from("rec_immortality_xp_ledger").select("prospect_id,player_xp_delta").in("prospect_id", prospectIds)
    : { data: [] };
  const xpTotalByProspect = new Map<string, number>();
  for (const row of (xpLedger.data ?? []) as Array<{ prospect_id: string; player_xp_delta: number | null }>) {
    const key = String(row.prospect_id);
    xpTotalByProspect.set(key, (xpTotalByProspect.get(key) ?? 0) + Number(row.player_xp_delta ?? 0));
  }
  const playerSnapshots = await Promise.all(playerIds.map((playerId) => import("../league-week/pro-tracker.service.js")
    .then(({ computePlayerLine }) => computePlayerLine({ leagueId: input.leagueId, playerId, seasonNumber, weekNumber }))
    .then((snapshot) => snapshot ? ({
      ...snapshot,
      side: String(prospectByPlayer.get(playerId)?.side ?? ""),
      headshotUrl: snapshot.headshotUrl ?? prospectByPlayer.get(playerId)?.headshot_url ?? null,
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
    pendingContracts: Number(pending.count ?? 0),
  };
}

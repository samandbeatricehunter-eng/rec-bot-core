import {
  evaluateUnifiedPlayerChallenge,
  evaluateUnifiedTeamChallenge,
  highestCompleteTier,
  pickUnifiedPlayerChallenge,
  pickUnifiedTeamChallenge,
  pointsForWeeklyFranchiseTier,
  UNIFIED_CHALLENGE_CATALOG_VERSION,
  unifiedChallengeById,
  type UnifiedPlayerChallenge,
  type UnifiedTeamChallenge,
  type UnifiedTierResult,
} from "@rec/shared";
import type { ChallengeCondition, IssuedChallenge } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { buildWeeklyChallengeContext } from "./weekly-challenge-context.service.js";

type AssignmentRow = {
  id: string;
  assignment_class: "TEAM" | "PLAYER";
  subject_key: string;
  subject_label: string | null;
  team_id: string | null;
  target_player_id: string | null;
  target_prospect_id: string | null;
  challenge_id: string;
  challenge_version: number;
  challenge_name: string;
  challenge_family: string;
  challenge_side: string | null;
  challenge_pool: string | null;
  challenge_volatility: string | null;
  bronze: unknown[];
  silver_adds: unknown[];
  gold_adds: unknown[];
  reason_codes: string[];
  context_snapshot: Record<string, unknown>;
  status: string;
  graded_tier: "bronze" | "silver" | "gold" | null;
  credited_tier: "bronze" | "silver" | "gold" | null;
};

type PlayerStatsBundle = {
  stats: Record<string, number>;
  hasStats: boolean;
  recent: Record<string, number>;
};

type RtiProspect = {
  id: string;
  position: string;
  player_id: string | null;
  user_id: string;
  side: string;
  identity_status?: string | null;
};

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
  const rushAttempts = out.rush_attempts ?? 0;
  const receptions = out.receptions ?? 0;
  const passAttempts = out.pass_attempts ?? 0;
  if (rushAttempts > 0 && out.rush_yards != null) out.ypc = out.rush_yards / rushAttempts;
  if (receptions > 0 && out.receiving_yards != null) out.ypr = out.receiving_yards / receptions;
  if (passAttempts > 0 && out.pass_completions != null) out.completion_pct = (out.pass_completions / passAttempts) * 100;
  out.scrimmage_yards = (out.rush_yards ?? 0) + (out.receiving_yards ?? 0);
  out.total_tds = (out.pass_tds ?? 0) + (out.rush_tds ?? 0) + (out.receiving_tds ?? 0) + (out.defensive_tds ?? 0);
  out.takeaways = (out.interceptions ?? 0) + (out.forced_fumbles ?? 0) + (out.fumble_recoveries ?? 0);
  out.turnovers = (out.interceptions_thrown ?? 0) + (out.rushing_fumbles ?? 0);
  return out;
}

async function weeklyStatsForPlayer(input: {
  leagueId: string;
  playerId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<{ stats: Record<string, number>; hasStats: boolean }> {
  const rows = await supabase.from("rec_player_weekly_stats")
    .select("stats")
    .eq("league_id", input.leagueId)
    .eq("season_number", input.seasonNumber)
    .eq("week_number", input.weekNumber)
    .eq("player_id", input.playerId);
  const raw = (rows.data ?? []).map((row) => numericStats(row.stats as Record<string, unknown>));
  return { stats: sumStats(raw), hasStats: raw.length > 0 };
}

async function recentPlayerUsage(input: {
  leagueId: string;
  playerId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<Record<string, number>> {
  const fromWeek = Math.max(1, input.weekNumber - 3);
  const rows = await supabase.from("rec_player_weekly_stats")
    .select("stats")
    .eq("league_id", input.leagueId)
    .eq("season_number", input.seasonNumber)
    .eq("player_id", input.playerId)
    .gte("week_number", fromWeek)
    .lt("week_number", input.weekNumber);
  const raw = (rows.data ?? []).map((row) => sumStats([numericStats(row.stats as Record<string, unknown>)]));
  const games = Math.max(1, raw.length);
  const totals = sumStats(raw);
  return {
    qbRushAttemptsPerGame: (totals.rush_attempts ?? 0) / games,
    rushAttemptsPerGame: (totals.rush_attempts ?? 0) / games,
    receptionsPerGame: (totals.receptions ?? 0) / games,
    touchesPerGame: ((totals.rush_attempts ?? 0) + (totals.receptions ?? 0)) / games,
  };
}

async function playerStatsBundle(input: {
  leagueId: string;
  playerId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<PlayerStatsBundle> {
  const [week, recent] = await Promise.all([
    weeklyStatsForPlayer(input),
    recentPlayerUsage(input),
  ]);
  return { stats: week.stats, hasStats: week.hasStats, recent };
}

export async function playerStatsBundleForPlayer(input: {
  leagueId: string;
  playerId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<PlayerStatsBundle> {
  return playerStatsBundle(input);
}

async function playerMeta(playerId: string): Promise<{ teamId: string | null; position: string; archetype: string | null; name: string; overall: number | null }> {
  const row = await supabase.from("rec_players")
    .select("team_id,position,archetype,full_name,overall_rating")
    .eq("id", playerId)
    .maybeSingle();
  return {
    teamId: row.data?.team_id ? String(row.data.team_id) : null,
    position: String(row.data?.position ?? ""),
    archetype: row.data?.archetype ? String(row.data.archetype) : null,
    name: String(row.data?.full_name ?? "Player"),
    overall: row.data?.overall_rating == null ? null : Number(row.data.overall_rating),
  };
}

async function rtiProspectArchetype(prospectId: string, fallback: string | null): Promise<string | null> {
  const [branching, flat] = await Promise.all([
    supabase.from("rec_immortality_branching_playstyle_results").select("primary_archetype").eq("prospect_id", prospectId).maybeSingle(),
    supabase.from("rec_immortality_playstyle_results").select("primary_archetype").eq("prospect_id", prospectId).maybeSingle(),
  ]);
  return branching.data?.primary_archetype ? String(branching.data.primary_archetype)
    : flat.data?.primary_archetype ? String(flat.data.primary_archetype)
      : fallback;
}

async function gameForTeam(input: { leagueId: string; seasonNumber: number; weekNumber: number; teamId: string | null }) {
  if (!input.teamId) return { gameId: null, opponentTeamId: null };
  const { resolveSeasonId } = await import("../league-context/season.service.js");
  const { leagueWeekGamesQuery } = await import("../league-context/league-games.query.js");
  const seasonId = await resolveSeasonId(input.leagueId, input.seasonNumber);
  const row = await leagueWeekGamesQuery(supabase, { leagueId: input.leagueId, seasonId, weekNumber: input.weekNumber }, "id,home_team_id,away_team_id")
    .or(`home_team_id.eq.${input.teamId},away_team_id.eq.${input.teamId}`)
    .maybeSingle();
  if (!row.data) return { gameId: null, opponentTeamId: null };
  const opponentTeamId = String(row.data.home_team_id) === input.teamId ? row.data.away_team_id : row.data.home_team_id;
  return { gameId: String(row.data.id), opponentTeamId: opponentTeamId ? String(opponentTeamId) : null };
}

async function fatigueFor(input: {
  leagueId: string;
  userId: string;
  targetPlayerId?: string | null;
  seasonNumber: number;
  weekNumber: number;
}) {
  const fromWeek = Math.max(1, input.weekNumber - 6);
  let query = supabase.from("rec_weekly_challenge_assignments")
    .select("challenge_id,challenge_family,challenge_volatility,week_number,reason_codes")
    .eq("league_id", input.leagueId)
    .eq("user_id", input.userId)
    .eq("season_number", input.seasonNumber)
    .gte("week_number", fromWeek)
    .lt("week_number", input.weekNumber);
  if (input.targetPlayerId) query = query.eq("target_player_id", input.targetPlayerId);
  const rows = (await query).data ?? [];
  const exactBlocked = rows
    .filter((row: any) => Number(row.week_number) >= input.weekNumber - 3)
    .map((row: any) => String(row.challenge_id));
  const familyPenalty = rows
    .filter((row: any) => Number(row.week_number) >= input.weekNumber - 2)
    .map((row: any) => String(row.challenge_family));
  const previousHighVariance = rows.some((row: any) => Number(row.week_number) === input.weekNumber - 1 && row.challenge_volatility === "high");
  return { exactBlocked, familyPenalty, previousHighVariance };
}

function rowToPlayerChallenge(row: AssignmentRow): UnifiedPlayerChallenge {
  return {
    id: row.challenge_id,
    version: row.challenge_version,
    assignmentClass: "PLAYER",
    positions: [],
    name: row.challenge_name,
    family: row.challenge_family,
    archetypes: ["*"],
    minimumUsage: {},
    volatility: (row.challenge_volatility ?? "stable") as UnifiedPlayerChallenge["volatility"],
    selectionWeight: 1,
    preferredContexts: [],
    bronze: row.bronze as UnifiedPlayerChallenge["bronze"],
    silverAdds: row.silver_adds as UnifiedPlayerChallenge["silverAdds"],
    goldAdds: row.gold_adds as UnifiedPlayerChallenge["goldAdds"],
    notes: "",
  };
}

function rowToTeamChallenge(row: AssignmentRow): UnifiedTeamChallenge {
  return {
    id: row.challenge_id,
    version: row.challenge_version,
    assignmentClass: "TEAM",
    side: (row.challenge_side ?? "team") as UnifiedTeamChallenge["side"],
    name: row.challenge_name,
    family: row.challenge_family,
    pool: (row.challenge_pool ?? "standard") as UnifiedTeamChallenge["pool"],
    volatility: (row.challenge_volatility ?? "stable") as UnifiedTeamChallenge["volatility"],
    selectionWeight: 1,
    contextTags: [],
    eligibility: {},
    bronze: row.bronze as UnifiedTeamChallenge["bronze"],
    silverAdds: row.silver_adds as UnifiedTeamChallenge["silverAdds"],
    goldAdds: row.gold_adds as UnifiedTeamChallenge["goldAdds"],
    notes: "",
  };
}

function tierConditionForPlayer(entry: UnifiedPlayerChallenge, tier: "bronze" | "silver" | "gold"): ChallengeCondition {
  const conditions = tier === "bronze" ? entry.bronze : tier === "silver" ? [...entry.bronze, ...entry.silverAdds] : [...entry.bronze, ...entry.silverAdds, ...entry.goldAdds];
  return conditions.length === 1 ? conditions[0] as ChallengeCondition : { all: conditions as ChallengeCondition[] };
}

function tierViews(row: AssignmentRow, tiers: UnifiedTierResult[], entry: UnifiedPlayerChallenge): IssuedChallenge[] {
  return tiers.map((tier) => ({
    id: `${row.id}:${tier.tier}`,
    scope: "weekly",
    tier: tier.tier,
    label: `${row.challenge_name}: ${tier.lines.join("; ")}`,
    condition: tierConditionForPlayer(entry, tier.tier),
    complete: tier.complete,
  }));
}

async function loadAssignment(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  userId: string;
  subjectKey: string;
}): Promise<AssignmentRow | null> {
  const existing = await supabase.from("rec_weekly_challenge_assignments")
    .select("*")
    .eq("league_id", input.leagueId)
    .eq("season_number", input.seasonNumber)
    .eq("week_number", input.weekNumber)
    .eq("user_id", input.userId)
    .eq("subject_key", input.subjectKey)
    .maybeSingle();
  return existing.data as AssignmentRow | null;
}

async function insertAssignment(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  leagueMode: "STANDARD" | "RTI";
  assignmentClass: "TEAM" | "PLAYER";
  subjectKey: string;
  subjectLabel: string;
  userId: string;
  teamId: string | null;
  gameId: string | null;
  opponentTeamId: string | null;
  targetPlayerId: string | null;
  targetProspectId: string | null;
  challenge: UnifiedTeamChallenge | UnifiedPlayerChallenge;
  reasonCodes: string[];
  contextSnapshot: Record<string, unknown>;
}): Promise<AssignmentRow | null> {
  const challenge = input.challenge;
  await supabase.from("rec_weekly_challenge_assignments").upsert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    league_mode: input.leagueMode,
    assignment_class: input.assignmentClass,
    subject_key: input.subjectKey,
    subject_label: input.subjectLabel,
    user_id: input.userId,
    team_id: input.teamId,
    game_id: input.gameId,
    opponent_team_id: input.opponentTeamId,
    target_player_id: input.targetPlayerId,
    target_prospect_id: input.targetProspectId,
    challenge_id: challenge.id,
    challenge_version: challenge.version,
    challenge_name: challenge.name,
    challenge_family: challenge.family,
    challenge_side: "side" in challenge ? challenge.side : null,
    challenge_pool: "pool" in challenge ? challenge.pool : null,
    challenge_volatility: challenge.volatility,
    bronze: challenge.bronze,
    silver_adds: challenge.silverAdds,
    gold_adds: challenge.goldAdds,
    reason_codes: input.reasonCodes,
    context_snapshot: input.contextSnapshot,
    formula_version: UNIFIED_CHALLENGE_CATALOG_VERSION,
  }, { onConflict: "league_id,season_number,week_number,user_id,subject_key", ignoreDuplicates: true });
  return loadAssignment({
    leagueId: input.leagueId,
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
    userId: input.userId,
    subjectKey: input.subjectKey,
  });
}

export async function resolveRtiProspectWeeklyAssignment(input: {
  leagueId: string;
  immortalityLeagueId: string;
  prospect: RtiProspect;
  seasonNumber: number;
  weekNumber: number;
  grade?: boolean;
}): Promise<{ row: AssignmentRow; tiers: UnifiedTierResult[]; view: IssuedChallenge[] } | null> {
  if (!input.prospect.player_id) return null;
  if (input.prospect.identity_status && ["missing", "ambiguous", "stale", "matched_pending_apply"].includes(input.prospect.identity_status)) return null;

  const meta = await playerMeta(String(input.prospect.player_id));
  const archetype = await rtiProspectArchetype(String(input.prospect.id), meta.archetype);
  const game = await gameForTeam({ leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, teamId: meta.teamId });
  const subjectKey = `rti:${input.prospect.side}:${input.prospect.id}`;
  const existing = await loadAssignment({
    leagueId: input.leagueId,
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
    userId: String(input.prospect.user_id),
    subjectKey,
  });
  let row = existing;
  let entry = existing ? rowToPlayerChallenge(existing) : null;

  if (!row) {
    const fatigue = await fatigueFor({
      leagueId: input.leagueId,
      userId: String(input.prospect.user_id),
      targetPlayerId: String(input.prospect.player_id),
      seasonNumber: input.seasonNumber,
      weekNumber: input.weekNumber,
    });
    const contexts = [`rti_${input.prospect.side}`, "rti_prospect"];
    const picked = pickUnifiedPlayerChallenge({
      seed: `${input.immortalityLeagueId}:${input.seasonNumber}:${input.weekNumber}:${input.prospect.id}`,
      position: input.prospect.position || meta.position,
      archetype,
      contexts,
      excludeIds: fatigue.exactBlocked,
      sameFamilyPenalty: fatigue.familyPenalty,
    }) ?? pickUnifiedPlayerChallenge({
      seed: `${input.immortalityLeagueId}:${input.seasonNumber}:${input.weekNumber}:${input.prospect.id}:fallback`,
      position: input.prospect.position || meta.position,
      archetype: null,
      contexts,
      excludeIds: fatigue.exactBlocked,
      sameFamilyPenalty: fatigue.familyPenalty,
    });
    if (!picked) return null;
    entry = picked;
    row = await insertAssignment({
      leagueId: input.leagueId,
      seasonNumber: input.seasonNumber,
      weekNumber: input.weekNumber,
      leagueMode: "RTI",
      assignmentClass: "PLAYER",
      subjectKey,
      subjectLabel: meta.name,
      userId: String(input.prospect.user_id),
      teamId: meta.teamId,
      gameId: game.gameId,
      opponentTeamId: game.opponentTeamId,
      targetPlayerId: String(input.prospect.player_id),
      targetProspectId: String(input.prospect.id),
      challenge: picked,
      reasonCodes: ["rti_required_prospect"],
      contextSnapshot: {
        position: input.prospect.position || meta.position,
        archetype,
        side: input.prospect.side,
        ovr: meta.overall,
        contexts,
        fatigue,
      },
    });
  }
  if (!row || !entry) return null;

  const stats = await playerStatsBundle({
    leagueId: input.leagueId,
    playerId: String(input.prospect.player_id),
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
  });
  const tiers = evaluateUnifiedPlayerChallenge(entry, {
    stats: stats.stats,
    recent: stats.recent,
    position: input.prospect.position || meta.position,
    archetype,
  });
  if (input.grade) {
    const gradedTier = stats.hasStats ? highestCompleteTier(tiers) : null;
    const patch = stats.hasStats
      ? { status: "graded", graded_tier: gradedTier, void_reason: null, graded_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: "void", graded_tier: null, void_reason: "no_player_weekly_stats", graded_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    await supabase.from("rec_weekly_challenge_assignments").update(patch).eq("id", row.id);
    row = { ...row, ...patch } as AssignmentRow;
  }
  return { row, tiers, view: tierViews(row, tiers, entry) };
}

export function issuedChallengesForPlayerAssignment(row: AssignmentRow, ctx: {
  stats: Record<string, number>;
  recent: Record<string, number>;
  position: string;
  archetype?: string | null;
}): IssuedChallenge[] {
  const entry = rowToPlayerChallenge(row);
  return tierViews(row, evaluateUnifiedPlayerChallenge(entry, ctx), entry);
}

export async function markUnifiedAssignmentCredited(input: { assignmentId: string; creditedTier: "bronze" | "silver" | "gold" | null }): Promise<void> {
  await supabase.from("rec_weekly_challenge_assignments").update({
    status: input.creditedTier ? "credited" : "graded",
    credited_tier: input.creditedTier,
    credited_at: input.creditedTier ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", input.assignmentId);
}

export async function issueStandardOwnerAssignment(input: {
  leagueId: string;
  userId: string;
  teamId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<AssignmentRow | null> {
  const existing = await loadAssignment({
    leagueId: input.leagueId,
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
    userId: input.userId,
    subjectKey: "owner",
  });
  if (existing) return existing;

  const { loadImmortalityLeague } = await import("../immortality/immortality.service.js");
  const immortality = await loadImmortalityLeague(input.leagueId);
  const leagueMode: "STANDARD" | "RTI" = immortality ? "RTI" : "STANDARD";

  const game = await gameForTeam({ leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, teamId: input.teamId });
  const fatigue = await fatigueFor({
    leagueId: input.leagueId,
    userId: input.userId,
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
  });
  // RTI owner assignments are always TEAM. Standard leagues may take a contextual PLAYER
  // assignment when a real storyline/event trigger scores high enough.
  const playerTarget = leagueMode === "STANDARD"
    ? await pickStandardPlayerTarget({
      leagueId: input.leagueId,
      userId: input.userId,
      teamId: input.teamId,
      seasonNumber: input.seasonNumber,
      weekNumber: input.weekNumber,
    })
    : null;
  if (playerTarget) {
    const meta = await playerMeta(playerTarget.playerId);
    const picked = pickUnifiedPlayerChallenge({
      seed: `${input.leagueId}:${input.userId}:${input.seasonNumber}:${input.weekNumber}:player`,
      position: meta.position,
      archetype: meta.archetype,
      contexts: playerTarget.reasonCodes,
      excludeIds: fatigue.exactBlocked,
      sameFamilyPenalty: fatigue.familyPenalty,
    });
    if (picked) {
      return insertAssignment({
        leagueId: input.leagueId,
        seasonNumber: input.seasonNumber,
        weekNumber: input.weekNumber,
        leagueMode,
        assignmentClass: "PLAYER",
        subjectKey: "owner",
        subjectLabel: meta.name,
        userId: input.userId,
        teamId: input.teamId,
        gameId: game.gameId,
        opponentTeamId: game.opponentTeamId,
        targetPlayerId: playerTarget.playerId,
        targetProspectId: null,
        challenge: picked,
        reasonCodes: playerTarget.reasonCodes,
        contextSnapshot: { score: playerTarget.score, archetype: meta.archetype, position: meta.position },
      });
    }
  }

  const pickedTeam = pickUnifiedTeamChallenge({
    seed: `${input.leagueId}:${input.userId}:${input.seasonNumber}:${input.weekNumber}:team`,
    pool: leagueMode === "RTI" ? "standard" : "standard",
    excludeIds: fatigue.exactBlocked,
  });
  if (!pickedTeam) return null;
  return insertAssignment({
    leagueId: input.leagueId,
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
    leagueMode,
    assignmentClass: "TEAM",
    subjectKey: "owner",
    subjectLabel: "Owner",
    userId: input.userId,
    teamId: input.teamId,
    gameId: game.gameId,
    opponentTeamId: game.opponentTeamId,
    targetPlayerId: null,
    targetProspectId: null,
    challenge: pickedTeam,
    reasonCodes: leagueMode === "RTI" ? ["rti_required_owner_team"] : ["standard_team_default"],
    contextSnapshot: {},
  });
}

async function pickStandardPlayerTarget(input: {
  leagueId: string;
  userId: string;
  teamId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<{ playerId: string; score: number; reasonCodes: string[] } | null> {
  const roster = await supabase.from("rec_players")
    .select("id,position,overall_rating,roster_status")
    .eq("league_id", input.leagueId)
    .eq("team_id", input.teamId)
    .not("overall_rating", "is", null)
    .order("overall_rating", { ascending: false })
    .limit(20);
  const playerIds = (roster.data ?? []).map((row: any) => String(row.id));
  if (!playerIds.length) return null;
  const [storylines, events] = await Promise.all([
    supabase.from("rec_media_storylines").select("player_id,storyline_type,priority")
      .eq("league_id", input.leagueId).eq("status", "open").in("player_id", playerIds),
    supabase.from("rec_media_events").select("player_id,event_type,importance_score")
      .eq("league_id", input.leagueId).in("player_id", playerIds)
      .gte("created_at", new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString()),
  ]);
  let best: { playerId: string; score: number; reasonCodes: string[] } | null = null;
  for (const player of roster.data ?? []) {
    const id = String((player as any).id);
    const reasonCodes: string[] = [];
    let score = 0;
    for (const row of storylines.data ?? []) {
      if (String((row as any).player_id) !== id) continue;
      score += 35 + Math.min(20, Number((row as any).priority ?? 0) * 5);
      reasonCodes.push(String((row as any).storyline_type));
    }
    for (const row of events.data ?? []) {
      if (String((row as any).player_id) !== id) continue;
      const eventType = String((row as any).event_type);
      if (eventType === "record_watch") score += 70;
      else if (eventType.includes("hot")) score += 45;
      else if (eventType.includes("cold")) score += 45;
      else if (eventType.includes("media")) score += 35;
      reasonCodes.push(eventType);
    }
    if (score >= 60 && (!best || score > best.score)) best = { playerId: id, score, reasonCodes: [...new Set(reasonCodes)] };
  }
  return best;
}

export async function issueAndGradeStandardOwnerAssignment(input: {
  leagueId: string;
  userId: string;
  teamId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<{ row: AssignmentRow; tiers: UnifiedTierResult[] } | null> {
  const row = await issueStandardOwnerAssignment(input);
  if (!row) return null;
  if (row.assignment_class === "TEAM") {
    const context = await buildWeeklyChallengeContext({ leagueId: input.leagueId, teamId: input.teamId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber });
    if (!context) {
      await supabase.from("rec_weekly_challenge_assignments").update({
        status: "void", void_reason: "no_team_game_stats", graded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      return { row: { ...row, status: "void", void_reason: "no_team_game_stats" } as AssignmentRow, tiers: [] };
    }
    const entry = rowToTeamChallenge(row);
    const tiers = evaluateUnifiedTeamChallenge(entry, context);
    await supabase.from("rec_weekly_challenge_assignments").update({
      status: "graded", graded_tier: highestCompleteTier(tiers), graded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    return { row, tiers };
  }
  if (!row.target_player_id) return { row, tiers: [] };
  const meta = await playerMeta(row.target_player_id);
  const stats = await playerStatsBundle({ leagueId: input.leagueId, playerId: row.target_player_id, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber });
  const entry = rowToPlayerChallenge(row);
  const tiers = evaluateUnifiedPlayerChallenge(entry, { stats: stats.stats, recent: stats.recent, position: meta.position, archetype: meta.archetype });
  await supabase.from("rec_weekly_challenge_assignments").update({
    status: stats.hasStats ? "graded" : "void",
    void_reason: stats.hasStats ? null : "no_player_weekly_stats",
    graded_tier: stats.hasStats ? highestCompleteTier(tiers) : null,
    graded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  return { row, tiers };
}

export function ownerXpForTier(tier: "bronze" | "silver" | "gold"): number {
  return pointsForWeeklyFranchiseTier(tier);
}

export function loadUnifiedChallengeDefinition(id: string) {
  return unifiedChallengeById(id);
}

/** Credit V2 owner assignments (TEAM or contextual PLAYER) at advance. Legacy 3-side team
 * challenges still credit through creditGradedWeeklyChallengesForLeagueAtAdvance; this pays the
 * single unified owner assignment without double-paying the old sides. */
export async function creditUnifiedOwnerAssignmentsForLeagueAtAdvance(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<Array<{ teamId: string | null; challengeName: string; tier: "bronze" | "silver" | "gold"; franchiseAwardedFpp: number; playerAwardedXp: number }>> {
  const { creditFranchiseXp } = await import("../franchise-xp/franchise-xp-ledger.service.js");
  const { creditPlayerXp } = await import("../player-xp/player-xp-ledger.service.js");
  const { pointsForWeeklyTeamTier } = await import("@rec/shared");

  const rows = await supabase.from("rec_weekly_challenge_assignments")
    .select("id,team_id,user_id,target_player_id,challenge_id,challenge_name,assignment_class,graded_tier,credited_tier,status")
    .eq("league_id", input.leagueId)
    .eq("season_number", input.seasonNumber)
    .eq("week_number", input.weekNumber)
    .eq("subject_key", "owner")
    .in("status", ["graded", "credited"])
    .not("graded_tier", "is", null);

  const credited: Array<{ teamId: string | null; challengeName: string; tier: "bronze" | "silver" | "gold"; franchiseAwardedFpp: number; playerAwardedXp: number }> = [];
  const tierRank = { bronze: 1, silver: 2, gold: 3 } as const;

  for (const row of rows.data ?? []) {
    const graded = row.graded_tier as "bronze" | "silver" | "gold" | null;
    const already = row.credited_tier as "bronze" | "silver" | "gold" | null;
    if (!graded) continue;
    if (already && tierRank[graded] <= tierRank[already]) continue;
    if (!row.user_id) continue;

    const previousFpp = already ? pointsForWeeklyFranchiseTier(already) : 0;
    const nextFpp = pointsForWeeklyFranchiseTier(graded);
    const sourceId = `weekly_challenge_v2:${row.id}:${graded}`;
    let franchiseAwardedFpp = 0;
    const fpp = await creditFranchiseXp({
      leagueId: input.leagueId,
      userId: String(row.user_id),
      teamId: row.team_id ? String(row.team_id) : null,
      seasonNumber: input.seasonNumber,
      weekNumber: input.weekNumber,
      eventType: "weekly_challenge",
      sourceId,
      rawFpp: nextFpp - previousFpp,
      metadata: { challengeId: row.challenge_id, name: row.challenge_name, assignmentClass: row.assignment_class, tier: graded, previousTier: already },
    }).catch((error) => {
      console.error(`[ERROR] creditFranchiseXp failed for unified assignment ${row.id} (non-fatal):`, error);
      return { credited: false, awardedFpp: 0 };
    });
    franchiseAwardedFpp = fpp.awardedFpp;

    let playerAwardedXp = 0;
    if (row.assignment_class === "PLAYER" && row.target_player_id) {
      const previousXp = already ? pointsForWeeklyTeamTier(already) : 0;
      const nextXp = pointsForWeeklyTeamTier(graded);
      const xp = await creditPlayerXp({
        leagueId: input.leagueId,
        playerId: String(row.target_player_id),
        creditedToUserId: String(row.user_id),
        seasonNumber: input.seasonNumber,
        weekNumber: input.weekNumber,
        eventType: "weekly_challenge",
        sourceId,
        rawXp: nextXp - previousXp,
        metadata: { challengeId: row.challenge_id, name: row.challenge_name, assignmentClass: row.assignment_class, tier: graded, previousTier: already },
      }).catch((error) => {
        console.error(`[ERROR] creditPlayerXp failed for unified assignment ${row.id} (non-fatal):`, error);
        return { credited: false, awardedXp: 0 };
      });
      playerAwardedXp = xp.awardedXp;
    }

    await markUnifiedAssignmentCredited({ assignmentId: String(row.id), creditedTier: graded });
    credited.push({
      teamId: row.team_id ? String(row.team_id) : null,
      challengeName: String(row.challenge_name),
      tier: graded,
      franchiseAwardedFpp,
      playerAwardedXp,
    });
  }
  return credited;
}

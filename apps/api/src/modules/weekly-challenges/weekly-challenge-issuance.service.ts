// Non-RTI weekly TEAM challenges -- frozen-issuance pattern mirroring
// immortality/challenge-issuance.service.ts: the first grading pass for a (team, season, week,
// side) issues one entry from @rec/shared's weeklyChallengeCatalog and freezes its conditions in
// rec_weekly_team_challenges_issued, so a later catalog edit can never reshuffle a week that
// already paid out Player XP. Every later pass re-evaluates the SAME frozen conditions against
// fresh stats.
//
// Reward-attribution note (a real design call, not an oversight -- flagged in the Phase 3
// handoff): Player XP is documented as strictly per-player, never pooled across a roster
// (PLAYER_XP_REWARDS.md). A team-level challenge has no single obvious "who earned this" unless
// its own conditions name a role (leading receiver, featured HB, a specific defender...). When
// they do, the actual player(s) who satisfied that role are credited. When a completed tier is
// pure team/aggregate conditions with no named role (e.g. "30+ points", "Win"), credit falls to
// an "anchor" player for that side -- offense's most-used passer (or rusher if no passer),
// defense's leading tackler, special teams' busier of kicker/punter -- so the reward still lands
// on a real, identifiable individual instead of splitting into meaningless fractions across 50+
// roster spots.
import {
  evaluateWeeklyChallengeTiers, pickWeeklyChallenge, pointsForWeeklyTeamTier, pointsForWeeklyFranchiseTier,
  type WeeklyChallengeCondition, type WeeklyChallengeEntry, type WeeklyChallengeGameContext,
  type WeeklyChallengeSide, type WeeklyChallengeTier,
} from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { loadImmortalityLeague } from "../immortality/immortality.service.js";
import { buildWeeklyChallengeContext } from "./weekly-challenge-context.service.js";
import { creditPlayerXp } from "../player-xp/player-xp-ledger.service.js";
import { creditFranchiseXp } from "../franchise-xp/franchise-xp-ledger.service.js";

const SIDES: WeeklyChallengeSide[] = ["offense", "defense", "special_teams"];

type IssuedRow = { challenge_id: string; name: string; bronze: WeeklyChallengeCondition[]; silver_adds: WeeklyChallengeCondition[]; gold_adds: WeeklyChallengeCondition[]; credited_tier: WeeklyChallengeTier | null };

const TIER_RANK: Record<WeeklyChallengeTier, number> = { bronze: 1, silver: 2, gold: 3 };

async function resolveIssuedEntry(input: {
  leagueId: string; teamId: string; seasonNumber: number; weekNumber: number; side: WeeklyChallengeSide;
}): Promise<{ entry: WeeklyChallengeEntry; creditedTier: WeeklyChallengeTier | null } | null> {
  const existing = await supabase.from("rec_weekly_team_challenges_issued")
    .select("challenge_id,name,bronze,silver_adds,gold_adds,credited_tier")
    .eq("league_id", input.leagueId).eq("team_id", input.teamId)
    .eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber).eq("side", input.side)
    .maybeSingle();
  if (existing.data) {
    const row = existing.data as IssuedRow;
    return {
      entry: { id: row.challenge_id, side: input.side, name: row.name, bronze: row.bronze, silverAdds: row.silver_adds, goldAdds: row.gold_adds },
      creditedTier: row.credited_tier ?? null,
    };
  }

  const fresh = pickWeeklyChallenge(input.side, `${input.teamId}:${input.seasonNumber}:${input.weekNumber}`);
  if (!fresh) return null;
  await supabase.from("rec_weekly_team_challenges_issued").upsert({
    league_id: input.leagueId, team_id: input.teamId, season_number: input.seasonNumber, week_number: input.weekNumber,
    side: input.side, challenge_id: fresh.id, name: fresh.name,
    bronze: fresh.bronze, silver_adds: fresh.silverAdds, gold_adds: fresh.goldAdds,
  }, { onConflict: "league_id,team_id,season_number,week_number,side", ignoreDuplicates: true });
  return { entry: fresh, creditedTier: null };
}

/** Every condition contributing to `tier` (bronze alone / bronze+silver / bronze+silver+gold, per
 * the catalog's stacking rule). */
function cumulativeConditions(entry: WeeklyChallengeEntry, tier: WeeklyChallengeTier): WeeklyChallengeCondition[] {
  if (tier === "bronze") return entry.bronze;
  if (tier === "silver") return [...entry.bronze, ...entry.silverAdds];
  return [...entry.bronze, ...entry.silverAdds, ...entry.goldAdds];
}

function flattenConditions(conditions: WeeklyChallengeCondition[]): WeeklyChallengeCondition[] {
  return conditions.flatMap((c) => (c.kind === "all" ? flattenConditions(c.parts) : [c]));
}

/** Finds the real player row(s) a "role" condition resolved against, for XP attribution -- same
 * matching rules as evaluateWeeklyChallengeCondition's role branch, but returning the player(s)
 * instead of a boolean. */
function findRoleBeneficiaries(condition: Extract<WeeklyChallengeCondition, { kind: "role" }>, ctx: WeeklyChallengeGameContext): string[] {
  if (condition.side !== "self") return [];
  const pool = ctx.selfPlayers.filter((player) => {
    const position = String(player.position ?? "").toUpperCase();
    switch (condition.position) {
      case "QB": return position === "QB";
      case "HB": return position === "HB" || position === "FB";
      case "TE": return position === "TE";
      case "RECEIVER": return position === "WR" || position === "TE";
      case "RUSHER": return position === "HB" || position === "FB" || position === "QB";
      case "DEFENDER": return ["LEDGE", "REDGE", "DT", "WILL", "MIKE", "SAM", "CB", "FS", "SS"].includes(position);
      case "OFFENSE_ANY": return ["QB", "HB", "FB", "WR", "TE"].includes(position);
      default: return true;
    }
  });
  const matching = pool.filter((player) => {
    const value = player[condition.stat];
    if (typeof value !== "number") return false;
    if (condition.op === "gte") return value >= condition.value;
    if (condition.op === "lte") return value <= condition.value;
    return value < condition.value;
  });
  if (condition.mode === "count") return matching.map((p) => String(p.playerId));
  if (condition.mode === "any") return matching.slice(0, 1).map((p) => String(p.playerId));
  // "max": whichever single player actually posted the best value (not just "any qualifier").
  let best: Record<string, number | string> | null = null;
  for (const player of pool) {
    const value = player[condition.stat];
    if (typeof value !== "number") continue;
    if (!best || value > (best[condition.stat] as number)) best = player;
  }
  return best ? [String(best.playerId)] : [];
}

async function resolveAnchorPlayerId(leagueId: string, seasonNumber: number, weekNumber: number, teamId: string, side: WeeklyChallengeSide): Promise<string | null> {
  const players = await supabase.from("rec_players").select("id,position").eq("team_id", teamId);
  const positionById = new Map<string, string>((players.data ?? []).map((p) => [String(p.id), String(p.position ?? "").toUpperCase()]));
  const statsRows = await supabase.from("rec_player_weekly_stats").select("player_id,stats")
    .eq("league_id", leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber)
    .in("player_id", [...positionById.keys()]);
  const rows = (statsRows.data ?? []) as Array<{ player_id: string; stats: Record<string, unknown> }>;

  const pickBest = (predicate: (position: string) => boolean, volumeKey: string): string | null => {
    let bestId: string | null = null; let bestVolume = -1;
    for (const row of rows) {
      const position = positionById.get(String(row.player_id)) ?? "";
      if (!predicate(position)) continue;
      const volume = Number(row.stats?.[volumeKey] ?? 0) || 0;
      if (volume > bestVolume) { bestVolume = volume; bestId = String(row.player_id); }
    }
    return bestVolume > 0 ? bestId : null;
  };

  if (side === "offense") {
    return pickBest((p) => p === "QB", "pass_attempts") ?? pickBest((p) => p === "HB" || p === "FB", "rush_attempts");
  }
  if (side === "defense") {
    return pickBest((p) => ["LEDGE", "REDGE", "DT", "WILL", "MIKE", "SAM", "CB", "FS", "SS"].includes(p), "tackles");
  }
  return pickBest((p) => p === "K", "fg_attempts") ?? pickBest((p) => p === "P", "punts");
}

export type WeeklyChallengeCreditResult = { beneficiaryPlayerIds: string[]; perPlayerAwardedXp: number; franchiseAwardedFpp: number };

/** Credits only the DELTA between `previousTier` (the highest tier already paid for this issued
 * challenge, if any) and `tier` (the new highest complete tier) -- so a team that jumps straight
 * to gold is paid gold once, and a team that clears bronze this pass then gold on a later re-grade
 * (e.g. a corrected box score) is paid bronze, then only the gold-minus-bronze remainder, never
 * bronze+silver+gold stacked. Caller is responsible for persisting the new credited_tier after
 * this resolves. */
async function creditTierXp(input: {
  leagueId: string; seasonNumber: number; weekNumber: number; teamId: string; side: WeeklyChallengeSide;
  entry: WeeklyChallengeEntry; tier: WeeklyChallengeTier; previousTier: WeeklyChallengeTier | null;
  ctx: WeeklyChallengeGameContext; creditedToUserId: string | null;
}): Promise<WeeklyChallengeCreditResult> {
  const none: WeeklyChallengeCreditResult = { beneficiaryPlayerIds: [], perPlayerAwardedXp: 0, franchiseAwardedFpp: 0 };
  const conditions = flattenConditions(cumulativeConditions(input.entry, input.tier));
  const roleConditions = conditions.filter((c): c is Extract<WeeklyChallengeCondition, { kind: "role" }> => c.kind === "role" && c.side === "self");
  const beneficiaries = new Set<string>();
  for (const condition of roleConditions) {
    for (const playerId of findRoleBeneficiaries(condition, input.ctx)) beneficiaries.add(playerId);
  }
  if (!beneficiaries.size) {
    const anchor = await resolveAnchorPlayerId(input.leagueId, input.seasonNumber, input.weekNumber, input.teamId, input.side);
    if (anchor) beneficiaries.add(anchor);
  }
  if (!beneficiaries.size) return none;

  const previousTeamXp = input.previousTier ? pointsForWeeklyTeamTier(input.previousTier) : 0;
  const rawXp = pointsForWeeklyTeamTier(input.tier) - previousTeamXp;
  const sourceId = `weekly_challenge:${input.teamId}:${input.seasonNumber}:${input.weekNumber}:${input.side}:${input.tier}`;
  let perPlayerAwardedXp = 0;
  for (const playerId of beneficiaries) {
    const result = await creditPlayerXp({
      leagueId: input.leagueId, playerId, creditedToUserId: input.creditedToUserId,
      seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, eventType: "weekly_challenge",
      sourceId, rawXp, metadata: { challengeId: input.entry.id, name: input.entry.name, side: input.side, tier: input.tier, previousTier: input.previousTier },
    }).catch((error) => { console.error(`[ERROR] creditPlayerXp failed for weekly challenge ${sourceId} (non-fatal):`, error); return { credited: false, awardedXp: 0 }; });
    perPlayerAwardedXp = Math.max(perPlayerAwardedXp, result.awardedXp);
  }

  // Franchise XP: same event, paid once to the team's owning user (not per player-beneficiary --
  // FPP is a team-owner-level currency, distinct from the per-player credit above).
  let franchiseAwardedFpp = 0;
  if (input.creditedToUserId) {
    const previousFpp = input.previousTier ? pointsForWeeklyFranchiseTier(input.previousTier) : 0;
    const result = await creditFranchiseXp({
      leagueId: input.leagueId, userId: input.creditedToUserId, teamId: input.teamId,
      seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, eventType: "weekly_challenge",
      sourceId, rawFpp: pointsForWeeklyFranchiseTier(input.tier) - previousFpp,
      metadata: { challengeId: input.entry.id, name: input.entry.name, side: input.side, tier: input.tier, previousTier: input.previousTier },
    }).catch((error) => { console.error(`[ERROR] creditFranchiseXp failed for weekly challenge ${sourceId} (non-fatal):`, error); return { credited: false, awardedFpp: 0 }; });
    franchiseAwardedFpp = result.awardedFpp;
  }

  return { beneficiaryPlayerIds: [...beneficiaries], perPlayerAwardedXp, franchiseAwardedFpp };
}

export type GradedWeeklyChallenge = {
  side: WeeklyChallengeSide; id: string; name: string;
  tiers: Array<{ tier: WeeklyChallengeTier; complete: boolean }>;
};

/** Issues (if needed) and grades all 3 sides' weekly challenges for one team's one week --
 * evaluation only, no XP/FPP crediting. Grading runs the moment a clean import gives us box-score
 * data (safe to call repeatedly/redundantly as corrections come in -- it just overwrites
 * graded_tier with the current truth, up or down); crediting is a deliberate, separate step tied
 * to the advance the commissioner actually runs (see creditGradedWeeklyChallengesForLeagueAtAdvance
 * below), which is also what the Rewards Recap presentation is built from. No-ops entirely for RTI
 * leagues, which have their own separate weekly challenge system (challenge-issuance.service.ts). */
export async function issueAndGradeWeeklyTeamChallenges(input: {
  leagueId: string; teamId: string; seasonNumber: number; weekNumber: number;
}): Promise<GradedWeeklyChallenge[]> {
  const immortalityLeague = await loadImmortalityLeague(input.leagueId);
  if (immortalityLeague) return [];

  const ctx = await buildWeeklyChallengeContext(input);
  if (!ctx) return [];

  const results: GradedWeeklyChallenge[] = [];
  for (const side of SIDES) {
    const resolved = await resolveIssuedEntry({ leagueId: input.leagueId, teamId: input.teamId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, side });
    if (!resolved) continue;
    const { entry } = resolved;
    const tiers = evaluateWeeklyChallengeTiers(entry, ctx);
    // Conditions are cumulative (silver includes bronze's, gold includes both), so more than one
    // tier can show complete at once -- graded_tier records only the single highest complete tier
    // (or null if none), reflecting the box score's current truth until it's credited at advance.
    const highestComplete = [...tiers].reverse().find((t) => t.complete)?.tier ?? null;
    await supabase.from("rec_weekly_team_challenges_issued").update({ graded_tier: highestComplete })
      .eq("league_id", input.leagueId).eq("team_id", input.teamId)
      .eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber).eq("side", side);
    results.push({ side, id: entry.id, name: entry.name, tiers });
  }
  return results;
}

/** Grades both teams in a game -- the natural call site is right after rec_team_game_stats rows
 * exist for a game (same trigger processGameIntelligence uses; see box-score-intelligence/
 * persistence.ts's callers in ea-connections.service.ts and manual-scores.service.ts). */
export async function issueAndGradeWeeklyTeamChallengesForGame(input: {
  leagueId: string; seasonNumber: number; weekNumber: number; gameId: string;
}): Promise<void> {
  const rows = await supabase.from("rec_team_game_stats").select("team_id")
    .eq("league_id", input.leagueId).eq("game_id", input.gameId);
  const teamIdSet = new Set<string>((rows.data ?? []).map((row) => String(row.team_id)));
  const teamIds: string[] = [...teamIdSet].filter((id) => id.length > 0);
  for (const teamId of teamIds) {
    await issueAndGradeWeeklyTeamChallenges({ leagueId: input.leagueId, teamId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber })
      .catch((error) => console.error(`[ERROR] issueAndGradeWeeklyTeamChallenges failed for team ${teamId} (non-fatal):`, error));
  }
}

export type CreditedWeeklyChallenge = {
  teamId: string; side: WeeklyChallengeSide; challengeName: string; tier: WeeklyChallengeTier;
  beneficiaryPlayerIds: string[]; perPlayerAwardedXp: number; franchiseAwardedFpp: number; creditedToUserId: string | null;
};

/** Credits Player XP + Franchise XP for every issued challenge in this league/week whose
 * graded_tier has moved past what's already been credited. Called once per advance (never at
 * import) so a mid-week box-score correction can freely move graded_tier around without paying
 * out early. Returns exactly what got credited this call, for the Rewards Recap to present. */
export async function creditGradedWeeklyChallengesForLeagueAtAdvance(input: {
  leagueId: string; seasonNumber: number; weekNumber: number;
}): Promise<CreditedWeeklyChallenge[]> {
  const immortalityLeague = await loadImmortalityLeague(input.leagueId);
  if (immortalityLeague) return [];

  const rows = await supabase.from("rec_weekly_team_challenges_issued")
    .select("team_id,side,challenge_id,name,bronze,silver_adds,gold_adds,graded_tier,credited_tier")
    .eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber)
    .not("graded_tier", "is", null);

  const credited: CreditedWeeklyChallenge[] = [];
  for (const row of (rows.data ?? []) as Array<{ team_id: string; side: WeeklyChallengeSide; challenge_id: string; name: string; bronze: WeeklyChallengeCondition[]; silver_adds: WeeklyChallengeCondition[]; gold_adds: WeeklyChallengeCondition[]; graded_tier: WeeklyChallengeTier | null; credited_tier: WeeklyChallengeTier | null }>) {
    const gradedTier = row.graded_tier;
    const creditedTier = row.credited_tier ?? null;
    if (!gradedTier || (creditedTier && TIER_RANK[gradedTier] <= TIER_RANK[creditedTier])) continue;

    const ctx = await buildWeeklyChallengeContext({ leagueId: input.leagueId, teamId: row.team_id, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber });
    if (!ctx) continue;
    const assignment = await supabase.from("rec_team_assignments").select("user_id")
      .eq("league_id", input.leagueId).eq("team_id", row.team_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
    const creditedToUserId = assignment.data?.user_id ? String(assignment.data.user_id) : null;
    const entry: WeeklyChallengeEntry = { id: row.challenge_id, side: row.side, name: row.name, bronze: row.bronze, silverAdds: row.silver_adds, goldAdds: row.gold_adds };

    const result = await creditTierXp({
      leagueId: input.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber, teamId: row.team_id,
      side: row.side, entry, tier: gradedTier, previousTier: creditedTier, ctx, creditedToUserId,
    });
    await supabase.from("rec_weekly_team_challenges_issued").update({ credited_tier: gradedTier })
      .eq("league_id", input.leagueId).eq("team_id", row.team_id)
      .eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber).eq("side", row.side);
    if (result.beneficiaryPlayerIds.length) {
      credited.push({
        teamId: row.team_id, side: row.side, challengeName: row.name, tier: gradedTier,
        beneficiaryPlayerIds: result.beneficiaryPlayerIds, perPlayerAwardedXp: result.perPlayerAwardedXp,
        franchiseAwardedFpp: result.franchiseAwardedFpp, creditedToUserId,
      });
    }
  }
  return credited;
}

/** Read-only view for the hub UI -- current issued challenges + tier completion for one team's
 * week, without re-issuing (issuance only happens from the grading call above). Returns [] if
 * nothing has been issued yet (box score not in for this week). */
export async function viewWeeklyTeamChallenges(input: {
  leagueId: string; teamId: string; seasonNumber: number; weekNumber: number;
}): Promise<GradedWeeklyChallenge[]> {
  const issued = await supabase.from("rec_weekly_team_challenges_issued")
    .select("side,challenge_id,name,bronze,silver_adds,gold_adds")
    .eq("league_id", input.leagueId).eq("team_id", input.teamId)
    .eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber);
  if (!issued.data?.length) return [];
  const ctx = await buildWeeklyChallengeContext(input);
  return (issued.data as Array<IssuedRow & { side: WeeklyChallengeSide }>).map((row) => {
    const entry: WeeklyChallengeEntry = { id: row.challenge_id, side: row.side, name: row.name, bronze: row.bronze, silverAdds: row.silver_adds, goldAdds: row.gold_adds };
    const tiers = ctx ? evaluateWeeklyChallengeTiers(entry, ctx) : (["bronze", "silver", "gold"] as const).map((tier) => ({ tier, complete: false }));
    return { side: row.side, id: entry.id, name: entry.name, tiers };
  });
}

/** Resolves the caller's own active team and current week, then returns that team's weekly
 * challenges -- the shape the hub UI actually calls (member-facing, no team_id/week to pass). */
export async function getMyWeeklyTeamChallenges(input: { guildId: string; discordId: string }): Promise<{
  teamId: string | null; seasonNumber: number; weekNumber: number; challenges: GradedWeeklyChallenge[];
}> {
  const { getCurrentLeagueContext } = await import("../league-context/league-context.service.js");
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const userId = account.data?.user_id ? String(account.data.user_id) : null;
  if (!userId) return { teamId: null, seasonNumber, weekNumber, challenges: [] };

  const assignment = await supabase.from("rec_team_assignments").select("team_id")
    .eq("league_id", context.leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  const teamId = assignment.data?.team_id ? String(assignment.data.team_id) : null;
  if (!teamId) return { teamId: null, seasonNumber, weekNumber, challenges: [] };

  const challenges = await viewWeeklyTeamChallenges({ leagueId: context.leagueId, teamId, seasonNumber, weekNumber });
  return { teamId, seasonNumber, weekNumber, challenges };
}

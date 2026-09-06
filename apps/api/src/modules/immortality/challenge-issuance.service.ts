/**
 * Rise to Immortality Pass 3 (Structured Challenges): freezes which challenge was actually
 * issued to a prospect for a given scope/period in rec_immortality_issued_challenges, so a later
 * catalog edit (a rebalance, a TFL-style removal, a bug fix) never reshuffles an already-graded
 * week/season/career out from under XP that was already credited -- see
 * player-identity.service.ts's regradeProspectHistory (Pass 2), which depends on this to stay
 * safe. First call for a given (prospect, scope, period) issues from the current @rec/shared
 * catalog and persists it; every later call for that same period re-evaluates the SAME frozen
 * condition against fresh stats instead of re-deriving from the catalog.
 */
import {
  derivedChallengeStats,
  evaluateChallengeCondition,
  issuedCareerChallenges,
  issuedSeasonChallenges,
  issuedWeeklyChallenges,
  type ChallengeCondition,
  type IssuedChallenge,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

type Scope = "weekly" | "season" | "career";

async function resolveIssued(input: {
  prospectId: string;
  scope: Scope;
  seasonNumber: number;
  weekNumber: number;
  stats: Record<string, number>;
  issueFresh: () => IssuedChallenge[];
}): Promise<IssuedChallenge[]> {
  const existing = await supabase.from("rec_immortality_issued_challenges")
    .select("tier,label,condition")
    .eq("prospect_id", input.prospectId)
    .eq("scope", input.scope)
    .eq("season_number", input.seasonNumber)
    .eq("week_number", input.weekNumber);
  if (existing.error) throw new ApiError(500, "Failed to load issued challenges.", existing.error);

  const derived = derivedChallengeStats(input.stats);
  if ((existing.data ?? []).length) {
    return (existing.data as Array<{ tier: string; label: string; condition: ChallengeCondition }>).map((row) => ({
      id: `${input.scope}:${row.tier}`,
      scope: input.scope,
      tier: row.tier as IssuedChallenge["tier"],
      label: row.label,
      condition: row.condition,
      complete: row.label ? evaluateChallengeCondition(row.condition, derived) : false,
    }));
  }

  const fresh = input.issueFresh();
  if (fresh.length) {
    const rows = fresh.map((challenge) => ({
      prospect_id: input.prospectId,
      scope: input.scope,
      season_number: input.seasonNumber,
      week_number: input.weekNumber,
      tier: challenge.tier,
      label: challenge.label,
      condition: challenge.condition,
    }));
    // Plain (non-partial) unique constraint on (prospect_id, scope, tier, season_number,
    // week_number) -- unlike rec_commissioners_inbox's partial index, .upsert() with
    // ignoreDuplicates works fine here; a concurrent first-issuance race just no-ops on the
    // loser, and the next read of this same period picks up whichever row won.
    const written = await supabase.from("rec_immortality_issued_challenges")
      .upsert(rows, { onConflict: "prospect_id,scope,tier,season_number,week_number", ignoreDuplicates: true });
    if (written.error) throw new ApiError(500, "Failed to persist issued challenges.", written.error);
  }
  return fresh;
}

export async function resolveIssuedWeeklyChallenges(input: {
  prospectId: string;
  position: string;
  seed: string;
  seasonNumber: number;
  weekNumber: number;
  stats: Record<string, number>;
}): Promise<IssuedChallenge[]> {
  return resolveIssued({
    prospectId: input.prospectId,
    scope: "weekly",
    seasonNumber: input.seasonNumber,
    weekNumber: input.weekNumber,
    stats: input.stats,
    issueFresh: () => issuedWeeklyChallenges({ position: input.position, seed: input.seed, stats: input.stats }),
  });
}

export async function resolveIssuedSeasonChallenges(input: {
  prospectId: string;
  position: string;
  seed: string;
  seasonNumber: number;
  stats: Record<string, number>;
}): Promise<IssuedChallenge[]> {
  return resolveIssued({
    prospectId: input.prospectId,
    scope: "season",
    seasonNumber: input.seasonNumber,
    weekNumber: 0,
    stats: input.stats,
    issueFresh: () => issuedSeasonChallenges(input.position, input.stats, input.seed),
  });
}

export async function resolveIssuedCareerChallenges(input: {
  prospectId: string;
  position: string;
  seed: string;
  stats: Record<string, number>;
}): Promise<IssuedChallenge[]> {
  return resolveIssued({
    prospectId: input.prospectId,
    scope: "career",
    seasonNumber: 0,
    weekNumber: 0,
    stats: input.stats,
    issueFresh: () => issuedCareerChallenges(input.position, input.stats, input.seed),
  });
}

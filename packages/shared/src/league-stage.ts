// Season-stage machine for NFL leagues (madden_26/madden_27): 18 regular-season weeks, then a
// 4-round single-elimination bracket (wild_card/divisional/conference_championship/super_bowl)
// at weeks 19-22, then the franchise offseason pipeline (coach_hiring/final_resigning/
// free_agency/draft) before looping back to Preseason Training Camp -> Week 1.

export type LeagueGame = "madden_26" | "madden_27" | string | null | undefined;

/** Every offseason-pipeline stage name, single source of truth for "is this stage part of
 *  the offseason" -- see nextLeagueStage below for the authoritative sequencing these names
 *  come from. */
export const OFFSEASON_PIPELINE_STAGES: ReadonlySet<string> = new Set([
  "offseason", "completed",
  "coach_hiring", "final_resigning", "free_agency", "draft",
]);

export function isOffseasonPipelineStage(seasonStage: string): boolean {
  return OFFSEASON_PIPELINE_STAGES.has(String(seasonStage ?? "").trim().toLowerCase());
}

/** The regular-season week the site starts showing a live projected NFL playoff bracket
 *  ("if the season ended today"), well before the real postseason boundary (week 19,
 *  wild_card). Purely a display threshold -- does not affect the actual regular season / wild
 *  card boundary above. */
export const NFL_PLAYOFF_PICTURE_START_WEEK = 12;

/** Last week number of the regular season. */
export function regularSeasonWeeks(_game?: LeagueGame): number {
  return 18;
}

// Regular-season weeks is NOT the same as regular-season games — bye weeks are never persisted
// anywhere (a bye and a not-yet-entered week look identical: no rec_games row for that
// team+week), so "confirmed weeks / weeks in season" can never reach 1.0 for a real schedule.
// Use this fixed per-team game count as the completion denominator instead: 17 games across
// 18 weeks (1 bye), matching the real-NFL schedule this is modeled on.
export function regularSeasonGamesPerTeam(_game?: LeagueGame): number {
  return 17;
}

/** Last week number of the whole season (regular season + postseason). */
export function maxSeasonWeek(_game?: LeagueGame): number {
  return 22;
}

/** Stages where the league plays scheduled games that may need commissioner advance input. */
export function gameplaySeasonStages(_game?: LeagueGame): Set<string> {
  return new Set(["regular_season", "wild_card", "divisional", "conference_championship", "super_bowl"]);
}

/** Postseason stages eligible for EOS payouts/awards. */
export function postseasonPayoutStages(_game?: LeagueGame): Set<string> {
  return new Set(["wild_card", "divisional", "conference_championship", "super_bowl"]);
}

/** Madden-only: whether the hub/API should surface the *current* season's NFL playoff picture
 *  (live projection or settled postseason bracket) instead of falling back to a prior-season
 *  snapshot. True from Week 12 of the regular season through the full postseason and
 *  offseason pipeline; false once the league enters preseason / training camp, and during
 *  early regular-season weeks of the next year before Week 12. */
export function nflPlayoffPictureLive(input: {
  weekNumber: number;
  seasonStage: string;
  game?: LeagueGame;
}): boolean {
  const stage = String(input.seasonStage ?? "").trim().toLowerCase();
  if (stage === "preseason" || stage === "preseason_training_camp") return false;
  if (isOffseasonPipelineStage(stage)) return true;
  if (postseasonPayoutStages(input.game ?? "madden_27").has(stage)) return true;
  return stage === "regular_season"
    && Number(input.weekNumber ?? 0) >= NFL_PLAYOFF_PICTURE_START_WEEK;
}

export function stageHasScheduledGames(seasonStage: string, game: LeagueGame): boolean {
  return gameplaySeasonStages(game).has(String(seasonStage ?? ""));
}

export function isEosPayoutEligibleStage(seasonStage: string, game: LeagueGame): boolean {
  return postseasonPayoutStages(game).has(String(seasonStage ?? ""));
}

export function nextLeagueStage(weekNumber: number, seasonStage: string, _game?: LeagueGame) {
  const stage = String(seasonStage ?? "regular_season");
  if (stage === "preseason_training_camp" || stage === "preseason") {
    return { weekNumber: 1, seasonStage: "regular_season" };
  }
  const lastRegularWeek = regularSeasonWeeks();
  if (stage === "regular_season" && weekNumber < lastRegularWeek) return { weekNumber: weekNumber + 1, seasonStage: "regular_season" };
  if (stage === "regular_season" && weekNumber >= lastRegularWeek) return { weekNumber: 19, seasonStage: "wild_card" };
  if (stage === "wild_card") return { weekNumber: 20, seasonStage: "divisional" };
  if (stage === "divisional") return { weekNumber: 21, seasonStage: "conference_championship" };
  if (stage === "conference_championship") return { weekNumber: 22, seasonStage: "super_bowl" };
  if (stage === "super_bowl" || stage === "offseason") return { weekNumber: 1, seasonStage: "coach_hiring" };
  if (stage === "coach_hiring") return { weekNumber: 1, seasonStage: "final_resigning" };
  if (stage === "final_resigning") return { weekNumber: 1, seasonStage: "free_agency" };
  if (stage === "free_agency") return { weekNumber: 1, seasonStage: "draft" };
  if (stage === "draft") return { weekNumber: 1, seasonStage: "preseason_training_camp" };
  return { weekNumber: Math.max(1, weekNumber + 1), seasonStage: stage };
}

export function stageLabel(stage: string, week: number, _game?: LeagueGame): string {
  if (stage === "preseason_training_camp") return "Preseason Training Camp";
  if (stage === "preseason") return "Preseason";
  if (stage === "regular_season") return `Week ${week}`;
  if (stage === "wild_card") return "Wild Card";
  if (stage === "divisional") return "Divisional";
  if (stage === "conference_championship") return "Conference Championship";
  if (stage === "super_bowl") return "Super Bowl";
  if (stage === "coach_hiring") return "Coach Hiring";
  if (stage === "final_resigning") return "Final Re-Signing";
  if (stage === "free_agency") return "Free Agency";
  if (stage === "draft") return "Draft";
  if (stage === "offseason") return "Offseason";
  return stage.replace(/_/g, " ");
}

/** True if weekNumber falls within the regular season (vs. postseason). */
export function isRegularSeasonWeek(weekNumber: number, _game?: LeagueGame): boolean {
  return weekNumber <= regularSeasonWeeks();
}

/** The final season_stage before the offseason pipeline begins. */
export function terminalSeasonStage(_game?: LeagueGame): string {
  return "super_bowl";
}

/** The first offseason stage entered right after the terminal (championship) stage. This is
 *  the boundary EOS payouts/awards automation fires on. */
export function firstOffseasonStage(_game?: LeagueGame): string {
  return "coach_hiring";
}

/** True if this season_stage is the terminal (championship) stage. */
export function isTerminalSeasonStage(seasonStage: string, game?: LeagueGame): boolean {
  return String(seasonStage ?? "") === terminalSeasonStage(game);
}

/** True if weekNumber is the championship week (last week of the whole season). */
export function isChampionshipWeek(weekNumber: number | null | undefined, game?: LeagueGame): boolean {
  return Number(weekNumber ?? 0) >= maxSeasonWeek(game);
}

/**
 * Result-payout multiplier for a game result based purely on the week it was played --
 * regular season games pay the base amount, other playoff rounds pay 1.5x, and the
 * championship game (Super Bowl) pays 2x. Derived from the week number rather than the
 * league's live season_stage so it stays correct even if payouts are issued out of order
 * (a late-approved box score, a re-run import) relative to where the league has since
 * advanced to.
 */
export function postseasonResultMultiplier(weekNumber: number, game?: LeagueGame): number {
  const stage = stageForWeek(weekNumber, game);
  if (isTerminalSeasonStage(stage, game)) return 2;
  if (postseasonPayoutStages(game).has(stage)) return 1.5;
  return 1;
}

export function stageForWeek(weekNumber: number, game?: LeagueGame): string {
  if (isRegularSeasonWeek(weekNumber, game)) return "regular_season";
  if (weekNumber === 19) return "wild_card";
  if (weekNumber === 20) return "divisional";
  if (weekNumber === 21) return "conference_championship";
  return "super_bowl";
}

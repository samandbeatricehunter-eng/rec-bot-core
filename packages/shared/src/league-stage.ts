// Game-aware season-stage machine. NFL (madden_26/madden_27): 18 regular-season weeks,
// then a 4-round single-elimination bracket (wild_card/divisional/conference_championship/
// super_bowl) at weeks 19-22. CFB (cfb_27): a hard-locked 12-game regular season, then a
// fixed 5-week postseason at weeks 13-17 (CFP first round, quarterfinals, semifinals, a
// scheduled bye week with zero games, then the national championship).

export type LeagueGame = "madden_26" | "madden_27" | "cfb_27" | string | null | undefined;

function isCfb(game: LeagueGame) {
  return game === "cfb_27";
}

/** Last week number of the regular season for this game. */
export function regularSeasonWeeks(game: LeagueGame): number {
  return isCfb(game) ? 12 : 18;
}

/** Stages where the league plays scheduled games that may need commissioner advance input. */
export function gameplaySeasonStages(game: LeagueGame): Set<string> {
  return isCfb(game)
    ? new Set(["regular_season", "cfp_first_round", "cfp_quarterfinals", "cfp_semifinals", "national_championship"])
    : new Set(["regular_season", "wild_card", "divisional", "conference_championship", "super_bowl"]);
}

/** Postseason stages eligible for EOS payouts/awards — includes the CFB bye week (no games, but still in-window). */
export function postseasonPayoutStages(game: LeagueGame): Set<string> {
  return isCfb(game)
    ? new Set(["cfp_first_round", "cfp_quarterfinals", "cfp_semifinals", "cfp_bye_week", "national_championship"])
    : new Set(["wild_card", "divisional", "conference_championship", "super_bowl"]);
}

export function stageHasScheduledGames(seasonStage: string, game: LeagueGame): boolean {
  return gameplaySeasonStages(game).has(String(seasonStage ?? ""));
}

export function isEosPayoutEligibleStage(seasonStage: string, game: LeagueGame): boolean {
  return postseasonPayoutStages(game).has(String(seasonStage ?? ""));
}

export function nextLeagueStage(weekNumber: number, seasonStage: string, game: LeagueGame) {
  const stage = String(seasonStage ?? "regular_season");
  if (stage === "preseason_training_camp" || stage === "preseason") {
    return { weekNumber: 1, seasonStage: "regular_season" };
  }
  const lastRegularWeek = regularSeasonWeeks(game);
  if (isCfb(game)) {
    if (stage === "regular_season" && weekNumber < lastRegularWeek) return { weekNumber: weekNumber + 1, seasonStage: "regular_season" };
    if (stage === "regular_season" && weekNumber >= lastRegularWeek) return { weekNumber: 13, seasonStage: "cfp_first_round" };
    if (stage === "cfp_first_round") return { weekNumber: 14, seasonStage: "cfp_quarterfinals" };
    if (stage === "cfp_quarterfinals") return { weekNumber: 15, seasonStage: "cfp_semifinals" };
    if (stage === "cfp_semifinals") return { weekNumber: 16, seasonStage: "cfp_bye_week" };
    if (stage === "cfp_bye_week") return { weekNumber: 17, seasonStage: "national_championship" };
    if (stage === "national_championship" || stage === "offseason") return { weekNumber: 1, seasonStage: "coach_hiring" };
  } else {
    if (stage === "regular_season" && weekNumber < lastRegularWeek) return { weekNumber: weekNumber + 1, seasonStage: "regular_season" };
    if (stage === "regular_season" && weekNumber >= lastRegularWeek) return { weekNumber: 19, seasonStage: "wild_card" };
    if (stage === "wild_card") return { weekNumber: 20, seasonStage: "divisional" };
    if (stage === "divisional") return { weekNumber: 21, seasonStage: "conference_championship" };
    if (stage === "conference_championship") return { weekNumber: 22, seasonStage: "super_bowl" };
    if (stage === "super_bowl" || stage === "offseason") return { weekNumber: 1, seasonStage: "coach_hiring" };
  }
  // Offseason pipeline is shared across games.
  if (stage === "coach_hiring") return { weekNumber: 1, seasonStage: "final_resigning" };
  if (stage === "final_resigning") return { weekNumber: 1, seasonStage: "free_agency" };
  if (stage === "free_agency") return { weekNumber: 1, seasonStage: "draft" };
  if (stage === "draft") return { weekNumber: 1, seasonStage: "preseason_training_camp" };
  return { weekNumber: Math.max(1, weekNumber + 1), seasonStage: stage };
}

export function stageLabel(stage: string, week: number, game: LeagueGame = null): string {
  if (stage === "preseason_training_camp") return "Preseason Training Camp";
  if (stage === "preseason") return "Preseason";
  if (stage === "regular_season") return `Week ${week}`;
  if (isCfb(game)) {
    if (stage === "cfp_first_round") return "CFP First Round";
    if (stage === "cfp_quarterfinals") return "CFP Quarterfinals";
    if (stage === "cfp_semifinals") return "CFP Semifinals";
    if (stage === "cfp_bye_week") return "Bye Week";
    if (stage === "national_championship") return "National Championship";
  } else {
    if (stage === "wild_card") return "Wild Card";
    if (stage === "divisional") return "Divisional";
    if (stage === "conference_championship") return "Conference Championship";
    if (stage === "super_bowl") return "Super Bowl";
  }
  if (stage === "coach_hiring") return "Coach Hiring";
  if (stage === "final_resigning") return "Final Re-Signing";
  if (stage === "free_agency") return "Free Agency";
  if (stage === "draft") return "Draft";
  if (stage === "offseason") return "Offseason";
  return stage.replace(/_/g, " ");
}

/** True if weekNumber falls within the regular season for this game (vs. postseason). */
export function isRegularSeasonWeek(weekNumber: number, game: LeagueGame): boolean {
  return weekNumber <= regularSeasonWeeks(game);
}

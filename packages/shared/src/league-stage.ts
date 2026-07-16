// Game-aware season-stage machine. NFL (madden_26/madden_27): 18 regular-season weeks,
// then a 4-round single-elimination bracket (wild_card/divisional/conference_championship/
// super_bowl) at weeks 19-22. CFB (cfb_27): a 12-game regular season with per-team bye weeks
// scattered across Week 0 through Week 14 (real CFB has a "Week 0" slate the last week of
// August, and — unlike a lockstep schedule — not every team plays every numbered week; a team
// simply has no game logged for its bye weeks, same as the NFL model above), then Conference
// Championship at week 15, then a 4-week "Bowl Week" bracket at weeks 16-19 (CFP First Round,
// Quarterfinals, Semifinals, National Championship — no scheduled bye week between rounds).
//
// After the National Championship, CFB abandons "Weeks" entirely for a 4-stage dynasty
// offseason before looping back to Preseason -> Week 0: Players Leaving (roster
// retention/graduation/draft declarations) -> Transfer Portal -> National Signing Day
// (recruiting class signs + position changes) -> Training Results (progression + roster
// cuts to reach the cap). This does not reuse Madden's franchise-mode offseason names
// (coach_hiring/final_resigning/free_agency/draft), which are NFL-only.
//
// Source: community-aggregated CFP bowl-week structure (Reddit r/NCAAFBseries + EA's own
// site), corroborated 2026-07-16. Superseded the prior provisional numbering, which was
// extrapolated from a single non-playoff team's schedule screenshot and included an
// unconfirmed bye week between semifinals and the championship.

export type LeagueGame = "madden_26" | "madden_27" | "cfb_27" | string | null | undefined;

export function isCfb(game: LeagueGame) {
  return game === "cfb_27";
}

/** Last week number of the regular season for this game. CFB is 0-indexed (Week 0-14, 15 weeks, byes scattered per team). */
export function regularSeasonWeeks(game: LeagueGame): number {
  return isCfb(game) ? 14 : 18;
}

// Regular-season weeks is NOT the same as regular-season games — both games have bye weeks
// that are never persisted anywhere (a bye and a not-yet-entered week look identical: no
// rec_games row for that team+week), so "confirmed weeks / weeks in season" can never reach
// 1.0 for a real schedule. Use this fixed per-team game count as the completion denominator
// instead. CFB: 12 games across 15 regular-season weeks. Madden: 17 games across 18 weeks
// (1 bye), matching the real-NFL schedule this is modeled on.
export function regularSeasonGamesPerTeam(game: LeagueGame): number {
  return isCfb(game) ? 12 : 17;
}

/** Last week number of the whole season (regular season + postseason) for this game. */
export function maxSeasonWeek(game: LeagueGame): number {
  return isCfb(game) ? 19 : 22;
}

/** Stages where the league plays scheduled games that may need commissioner advance input. */
export function gameplaySeasonStages(game: LeagueGame): Set<string> {
  return isCfb(game)
    ? new Set(["regular_season", "conference_championship", "cfp_first_round", "cfp_quarterfinals", "cfp_semifinals", "national_championship"])
    : new Set(["regular_season", "wild_card", "divisional", "conference_championship", "super_bowl"]);
}

/** Postseason stages eligible for EOS payouts/awards. */
export function postseasonPayoutStages(game: LeagueGame): Set<string> {
  return isCfb(game)
    ? new Set(["conference_championship", "cfp_first_round", "cfp_quarterfinals", "cfp_semifinals", "national_championship"])
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
    // CFB's regular season starts at Week 0; Madden's starts at Week 1.
    return { weekNumber: isCfb(game) ? 0 : 1, seasonStage: "regular_season" };
  }
  const lastRegularWeek = regularSeasonWeeks(game);
  if (isCfb(game)) {
    if (stage === "regular_season" && weekNumber < lastRegularWeek) return { weekNumber: weekNumber + 1, seasonStage: "regular_season" };
    if (stage === "regular_season" && weekNumber >= lastRegularWeek) return { weekNumber: 15, seasonStage: "conference_championship" };
    if (stage === "conference_championship") return { weekNumber: 16, seasonStage: "cfp_first_round" };
    if (stage === "cfp_first_round") return { weekNumber: 17, seasonStage: "cfp_quarterfinals" };
    if (stage === "cfp_quarterfinals") return { weekNumber: 18, seasonStage: "cfp_semifinals" };
    if (stage === "cfp_semifinals") return { weekNumber: 19, seasonStage: "national_championship" };
    // Dynasty offseason: no week numbers, just a 4-stage pipeline back to Preseason -> Week 0.
    if (stage === "national_championship" || stage === "offseason") return { weekNumber: 1, seasonStage: "players_leaving" };
    if (stage === "players_leaving") return { weekNumber: 1, seasonStage: "transfer_portal" };
    if (stage === "transfer_portal") return { weekNumber: 1, seasonStage: "signing_day" };
    if (stage === "signing_day") return { weekNumber: 1, seasonStage: "training_results" };
    if (stage === "training_results") return { weekNumber: 1, seasonStage: "preseason" };
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
    if (stage === "conference_championship") return "Conference Championship";
    if (stage === "cfp_first_round") return "CFP First Round";
    if (stage === "cfp_quarterfinals") return "CFP Quarterfinals";
    if (stage === "cfp_semifinals") return "CFP Semifinals";
    if (stage === "national_championship") return "National Championship";
    if (stage === "players_leaving") return "Players Leaving";
    if (stage === "transfer_portal") return "Transfer Portal";
    if (stage === "signing_day") return "National Signing Day";
    if (stage === "training_results") return "Training Results";
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

/** The final season_stage before the offseason pipeline begins — "super_bowl" for NFL, "national_championship" for CFB. */
export function terminalSeasonStage(game: LeagueGame): string {
  return isCfb(game) ? "national_championship" : "super_bowl";
}

/** The first offseason stage entered right after the terminal (championship) stage — "coach_hiring" for NFL, "players_leaving" for CFB. */
export function firstOffseasonStage(game: LeagueGame): string {
  return isCfb(game) ? "players_leaving" : "coach_hiring";
}

/** True if this season_stage is the terminal (championship) stage for this game. */
export function isTerminalSeasonStage(seasonStage: string, game: LeagueGame): boolean {
  return String(seasonStage ?? "") === terminalSeasonStage(game);
}

/** True if weekNumber is the championship week (last week of the whole season) for this game. */
export function isChampionshipWeek(weekNumber: number | null | undefined, game: LeagueGame): boolean {
  return Number(weekNumber ?? 0) >= maxSeasonWeek(game);
}

/**
 * The canonical season_stage for a given week number, inferred purely from the week/game
 * (the week<->stage mapping is fixed for postseason weeks). Useful for display code that
 * only has a week number on hand (e.g. schedule views), not the live rec_leagues.season_stage.
 */
export function stageForWeek(weekNumber: number, game: LeagueGame): string {
  if (isRegularSeasonWeek(weekNumber, game)) return "regular_season";
  if (isCfb(game)) {
    if (weekNumber === 15) return "conference_championship";
    if (weekNumber === 16) return "cfp_first_round";
    if (weekNumber === 17) return "cfp_quarterfinals";
    if (weekNumber === 18) return "cfp_semifinals";
    return "national_championship";
  }
  if (weekNumber === 19) return "wild_card";
  if (weekNumber === 20) return "divisional";
  if (weekNumber === 21) return "conference_championship";
  return "super_bowl";
}

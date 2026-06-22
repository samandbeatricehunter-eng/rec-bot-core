/** Stages where REC leagues play scheduled games that may need commissioner advance input. */
export const GAMEPLAY_SEASON_STAGES = new Set([
  "regular_season",
  "wild_card",
  "divisional",
  "conference_championship",
  "super_bowl",
]);

export function stageHasScheduledGames(seasonStage: string) {
  return GAMEPLAY_SEASON_STAGES.has(String(seasonStage ?? ""));
}

export function nextLeagueStage(weekNumber: number, seasonStage: string) {
  const stage = String(seasonStage ?? "regular_season");
  if (stage === "preseason_training_camp" || stage === "preseason") {
    return { weekNumber: 1, seasonStage: "regular_season" };
  }
  if (stage === "regular_season" && weekNumber < 18) {
    return { weekNumber: weekNumber + 1, seasonStage: "regular_season" };
  }
  if (stage === "regular_season" && weekNumber >= 18) {
    return { weekNumber: 19, seasonStage: "wild_card" };
  }
  if (stage === "wild_card") return { weekNumber: 20, seasonStage: "divisional" };
  if (stage === "divisional") return { weekNumber: 21, seasonStage: "conference_championship" };
  if (stage === "conference_championship") return { weekNumber: 22, seasonStage: "super_bowl" };
  if (stage === "super_bowl" || stage === "offseason") {
    return { weekNumber: 1, seasonStage: "coach_hiring" };
  }
  if (stage === "coach_hiring") return { weekNumber: 1, seasonStage: "final_resigning" };
  if (stage === "final_resigning") return { weekNumber: 1, seasonStage: "free_agency" };
  if (stage === "free_agency") return { weekNumber: 1, seasonStage: "draft" };
  if (stage === "draft") return { weekNumber: 1, seasonStage: "preseason_training_camp" };
  return { weekNumber: Math.max(1, weekNumber + 1), seasonStage: stage };
}

export function stageLabel(stage: string, week: number) {
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

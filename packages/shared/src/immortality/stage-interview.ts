import { seededRandom, type MatchupInterviewContentTrigger, type MatchupInterviewOption } from "./matchup-interview.js";
import { FORMULA_VERSIONS, type PersonaDimension } from "./types.js";

// Media Day's matchup-interview flow (3 slots/week, opponent context, bonus claims) assumes a
// real scheduled game -- there's no matchup, no opponent, no "week" during preseason/training
// camp or any offseason stage (draft, free agency, transfer portal, etc.). This is a separate,
// single-question-per-advance system for exactly those stages, gated the opposite way from Media
// Day: !gameplaySeasonStages(game).has(seasonStage) in league-stage.ts.

export type StageInterviewGroup =
  | "training_camp" | "roster_building" | "leadership_change" | "season_reflection" | "offseason_general";

export type StageInterviewQuestion = {
  id: number;
  group: StageInterviewGroup;
  question: string;
  options: MatchupInterviewOption[];
};

/** Maps every literal non-gameplay season_stage string (across both games -- see the stage
 * machine in league-stage.ts) to one of the 5 content buckets above. Authoring 13 fully bespoke
 * question sets isn't tractable, so history still records the exact stage (stored alongside the
 * answer) while content selection draws from a bounded, semantically-grouped bucket. A stage
 * missing from this map is a bug -- selectStageInterviewQuestion returns null rather than
 * silently picking from the wrong bucket. */
export const STAGE_TO_GROUP: Record<string, StageInterviewGroup> = {
  // Madden offseason pipeline (coach_hiring -> final_resigning -> free_agency -> draft ->
  // preseason_training_camp -> preseason -> Week 1)
  coach_hiring: "leadership_change",
  final_resigning: "roster_building",
  free_agency: "roster_building",
  draft: "roster_building",
  preseason_training_camp: "training_camp",
  preseason: "training_camp",
  // CFB dynasty offseason pipeline (end_of_season_recap -> players_leaving -> transfer_portal ->
  // signing_day -> training_results -> offseason_phase -> preseason -> Week 0). "preseason" is
  // shared with Madden above -- same literal stage string, same bucket either game.
  end_of_season_recap: "season_reflection",
  players_leaving: "season_reflection",
  transfer_portal: "roster_building",
  signing_day: "roster_building",
  training_results: "training_camp",
  offseason_phase: "offseason_general",
};

export function stageInterviewGroupFor(seasonStage: string): StageInterviewGroup | null {
  return STAGE_TO_GROUP[seasonStage] ?? null;
}

/** Seeded on (league, prospect, season, season_stage, advance_index) by the caller so reloading
 * the page doesn't reshuffle the question underneath the player -- same determinism pattern as
 * selectMatchupInterviewQuestion. */
export function selectStageInterviewQuestion(input: {
  pool: StageInterviewQuestion[];
  group: StageInterviewGroup;
  seed: string;
}): StageInterviewQuestion | null {
  const eligible = input.pool.filter((question) => question.group === input.group);
  if (!eligible.length) return null;
  const rng = seededRandom(input.seed);
  const index = Math.min(Math.floor(rng() * eligible.length), eligible.length - 1);
  return eligible[index]!;
}

export type StageInterviewAnswerResult = {
  question: StageInterviewQuestion;
  option: MatchupInterviewOption;
  dnaPoints: Partial<Record<PersonaDimension, number>>;
  contentTrigger: MatchupInterviewContentTrigger | null;
  formulaVersion: typeof FORMULA_VERSIONS.stageInterview;
};

export function scoreStageInterviewAnswer(input: {
  question: StageInterviewQuestion;
  optionIndex: number;
}): StageInterviewAnswerResult {
  const option = input.question.options[input.optionIndex];
  if (!option) throw new Error("Invalid stage interview option index.");
  return {
    question: input.question,
    option,
    dnaPoints: option.dnaPoints,
    contentTrigger: option.contentTrigger ?? null,
    formulaVersion: FORMULA_VERSIONS.stageInterview,
  };
}

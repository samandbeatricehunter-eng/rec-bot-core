// Selects each team's 3 weekly non-RTI Media Day questions from the question bank, based on
// season stage plus whatever recent-game context is cheaply available. Mirrors RTI's Matchup
// Interview / Owner Interview pattern (season-stage bucketing, deterministic weekly picks) but
// scoped to non-RTI leagues, where every user represents a TEAM (there are no player prospects).

import { isCfb, isTerminalSeasonStage, postseasonPayoutStages, regularSeasonWeeks, type LeagueGame } from "../league-stage.js";
import { NON_RTI_MEDIA_DAY_QUESTIONS, nonRtiMediaDayQuestionsByCategory, type NonRtiMediaDayCategory, type NonRtiMediaDayQuestion } from "./question-bank.js";

export const NON_RTI_MEDIA_DAY_SLOTS = 3;

export type NonRtiMediaDayContext = {
  seasonStage: string;
  game: LeagueGame;
  currentWeek: number;
  /** Result of the team's most recently completed game, if any -- cheap, already-available signal. */
  lastResult?: "win" | "loss" | "tie" | null;
  /** Whether this week's game is the league's Game of the Week. */
  isGameOfTheWeek?: boolean;
};

const OFFSEASON_MADDEN_STAGES = new Set(["coach_hiring", "final_resigning", "free_agency", "draft"]);
const OFFSEASON_CFB_STAGES = new Set([
  "end_of_season_recap", "players_leaving", "transfer_portal", "signing_day", "training_results", "offseason_phase",
]);
const TEAM_LEVEL_CATEGORIES: NonRtiMediaDayCategory[] = ["team_identity", "roster_construction", "coaching_philosophy"];

function candidateCategories(context: NonRtiMediaDayContext): NonRtiMediaDayCategory[] {
  const stage = String(context.seasonStage ?? "").trim().toLowerCase();
  const game = context.game;
  const categories: NonRtiMediaDayCategory[] = [];

  if (stage === "preseason_training_camp" || stage === "preseason") {
    categories.push("preseason", "preseason", ...TEAM_LEVEL_CATEGORIES);
  } else if (isTerminalSeasonStage(stage, game)) {
    categories.push("championship", "championship", "postseason", ...TEAM_LEVEL_CATEGORIES);
  } else if (postseasonPayoutStages(game).has(stage)) {
    categories.push("postseason", "postseason", ...TEAM_LEVEL_CATEGORIES);
  } else if (stage === "regular_season") {
    const total = regularSeasonWeeks(game);
    const bucket: NonRtiMediaDayCategory =
      context.currentWeek <= total / 3 ? "regular_season_early"
        : context.currentWeek <= (total * 2) / 3 ? "regular_season_mid"
          : "regular_season_late";
    categories.push(bucket, bucket);
    if (context.lastResult === "win") categories.push("postgame_win");
    else if (context.lastResult === "loss") categories.push("postgame_loss");
    if (context.isGameOfTheWeek) categories.push("game_of_the_week");
    categories.push(...TEAM_LEVEL_CATEGORIES);
  } else if (isCfb(game) && OFFSEASON_CFB_STAGES.has(stage)) {
    categories.push("offseason_cfb", "offseason_cfb", ...TEAM_LEVEL_CATEGORIES);
  } else if (!isCfb(game) && OFFSEASON_MADDEN_STAGES.has(stage)) {
    categories.push("offseason_madden", "offseason_madden", ...TEAM_LEVEL_CATEGORIES);
  } else {
    // Unrecognized/legacy stage value -- fall back to the always-safe evergreen pool rather
    // than surfacing nothing.
    categories.push(...TEAM_LEVEL_CATEGORIES);
  }

  return categories;
}

// Tiny deterministic PRNG (mulberry32) seeded from a string -- same league/team/week always
// gets the same 3 questions on refresh, without persisting a random pick anywhere.
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFrom<T>(items: T[], random: () => number): T | null {
  if (!items.length) return null;
  return items[Math.floor(random() * items.length)] ?? items[0]!;
}

/**
 * Picks this week's 3 Media Day questions for a team. `seed` should uniquely identify the
 * team/week (e.g. `${leagueId}:${teamId}:${seasonNumber}:${currentWeek}`) so the same slots are
 * returned on every call for that week. `excludeIds` should carry every question id this team
 * has already answered this SEASON, to avoid repeats within a season where possible.
 */
export function selectNonRtiMediaDayQuestions(
  context: NonRtiMediaDayContext,
  opts: { seed: string; excludeIds?: ReadonlySet<string> },
): NonRtiMediaDayQuestion[] {
  const excludeIds = opts.excludeIds ?? new Set<string>();
  const random = seededRandom(opts.seed);
  const orderedCategories = candidateCategories(context);
  const uniqueCategories = [...new Set(orderedCategories)];

  const chosen: NonRtiMediaDayQuestion[] = [];
  const usedIds = new Set<string>(excludeIds);

  const takeFrom = (category: NonRtiMediaDayCategory): boolean => {
    const pool = nonRtiMediaDayQuestionsByCategory(category).filter((q) => !usedIds.has(q.id));
    const pick = pickFrom(pool, random);
    if (!pick) return false;
    chosen.push(pick);
    usedIds.add(pick.id);
    return true;
  };

  // Prefer covering as many distinct candidate categories as possible first, in priority order.
  for (const category of uniqueCategories) {
    if (chosen.length >= NON_RTI_MEDIA_DAY_SLOTS) break;
    takeFrom(category);
  }
  // If categories ran out of fresh questions (long season, lots of repeats already excluded),
  // cycle back through the same candidate categories ignoring the exclusion list, then finally
  // fall back to the entire bank so a team is never short a slot.
  let cursor = 0;
  while (chosen.length < NON_RTI_MEDIA_DAY_SLOTS && uniqueCategories.length) {
    const category = uniqueCategories[cursor % uniqueCategories.length]!;
    const pool = nonRtiMediaDayQuestionsByCategory(category).filter((q) => !chosen.some((c) => c.id === q.id));
    const pick = pickFrom(pool, random);
    if (pick) chosen.push(pick);
    cursor += 1;
    if (cursor > uniqueCategories.length * 4) break;
  }
  while (chosen.length < NON_RTI_MEDIA_DAY_SLOTS) {
    const pool = NON_RTI_MEDIA_DAY_QUESTIONS.filter((q) => !chosen.some((c) => c.id === q.id));
    const pick = pickFrom(pool, random);
    if (!pick) break;
    chosen.push(pick);
  }

  return chosen;
}

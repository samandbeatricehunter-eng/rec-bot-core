// Week/stage translation between EA's franchise indices and REC's display weeks.
//
// EA models time as (stageIndex, weekIndex):
//   stageIndex 0 = preseason, 1 = regular season + playoffs (one continuous index space)
//   weekIndex is 0-based, so display week = weekIndex + 1
//
// The regular-season stage keeps counting through the playoffs, and index 21 (display 22)
// is the Pro Bowl, which has no exportable data. EA still reserves it, so the Super Bowl
// lands on index 22 / display 23 rather than 22. Week indexes verified against snallabot's
// SEASON_WEEKS (filters weekIndex 21) — playoffs are stage 1 weekIndexes 18/19/20/22.
// Getting this wrong silently imports the wrong week, so all conversion goes through this
// module.

export type EaStage = 0 | 1;

export type EaWeekRef = { stageIndex: EaStage; weekIndex: number };

export const PRESEASON_WEEK_INDEXES = [0, 1, 2, 3] as const;

/** Regular season + playoffs, excluding the Pro Bowl (index 21 / display 22). */
export const SEASON_WEEK_INDEXES = Array.from({ length: 23 }, (_, index) => index).filter(
  (index) => index !== 21,
);

export const PRO_BOWL_WEEK_INDEX = 21;

/** REC's canonical phase values for rec_games.phase / rec_*_stats.season_stage. */
export type RecPhase = "preseason" | "regular_season" | "playoffs";

export type EaWeekDescriptor = {
  stageIndex: EaStage;
  weekIndex: number;
  /** 1-based week as Madden displays it (weekIndex + 1). */
  displayWeek: number;
  label: string;
  phase: RecPhase;
  isPlayoff: boolean;
};

const PLAYOFF_LABELS: Record<number, string> = {
  19: "Wild Card Round",
  20: "Divisional Round",
  21: "Conference Championship",
  23: "Super Bowl",
};

/**
 * Human label for a 1-based regular-season/playoff display week. Mirrors snallabot's week
 * table exactly: 1-18 regular season, 19 Wild Card, 20 Divisional, 21 Conference
 * Championship, 22 the Pro Bowl (no data), 23 the Super Bowl — all under stage 1.
 */
export function seasonWeekLabel(displayWeek: number): string {
  if (displayWeek >= 1 && displayWeek <= 18) return `Week ${displayWeek}`;
  const playoff = PLAYOFF_LABELS[displayWeek];
  if (playoff) return playoff;
  if (displayWeek === 22) return "Pro Bowl";
  return `Week ${displayWeek}`;
}

export function isPlayoffDisplayWeek(displayWeek: number): boolean {
  return displayWeek === 19 || displayWeek === 20 || displayWeek === 21 || displayWeek === 23;
}

export function describeEaWeek(stageIndex: EaStage, weekIndex: number): EaWeekDescriptor {
  const displayWeek = weekIndex + 1;
  if (stageIndex === 0) {
    return {
      stageIndex,
      weekIndex,
      displayWeek,
      label: `Preseason Week ${displayWeek}`,
      phase: "preseason",
      isPlayoff: false,
    };
  }
  const isPlayoff = isPlayoffDisplayWeek(displayWeek);
  return {
    stageIndex,
    weekIndex,
    displayWeek,
    label: seasonWeekLabel(displayWeek),
    phase: isPlayoff ? "playoffs" : "regular_season",
    isPlayoff,
  };
}

/** Every week REC can offer for a manual "import these weeks" picker. */
export function allSelectableWeeks(): EaWeekDescriptor[] {
  return [
    ...PRESEASON_WEEK_INDEXES.map((weekIndex) => describeEaWeek(0, weekIndex)),
    ...SEASON_WEEK_INDEXES.map((weekIndex) => describeEaWeek(1, weekIndex)),
  ];
}

/**
 * EA's seasonWeekType tells us where the franchise currently sits. 0 is preseason; 8 is the
 * offseason, where seasonWeek no longer tracks a playable week, so we clamp to the last
 * exportable week (index 22 / Super Bowl) as snallabot does.
 */
export function currentWeekFromSeasonInfo(seasonInfo: { seasonWeek: number; seasonWeekType: number }): EaWeekRef {
  const stageIndex: EaStage = seasonInfo.seasonWeekType === 0 ? 0 : 1;
  if (seasonInfo.seasonWeekType === 8) return { stageIndex: 1, weekIndex: 22 };
  const weekIndex = clampWeekIndex(stageIndex, seasonInfo.seasonWeek);
  return { stageIndex, weekIndex };
}

export function clampWeekIndex(stageIndex: EaStage, weekIndex: number): number {
  const max = stageIndex === 0 ? 3 : 22;
  if (!Number.isFinite(weekIndex)) return 0;
  return Math.min(Math.max(Math.trunc(weekIndex), 0), max);
}

/** The current week plus its neighbours, skipping the Pro Bowl in either direction. */
export function surroundingWeeks(current: EaWeekRef): EaWeekRef[] {
  const max = current.stageIndex === 0 ? 3 : 22;
  const previousRaw = current.weekIndex - 1;
  const nextRaw = current.weekIndex + 1;
  const previous = previousRaw === PRO_BOWL_WEEK_INDEX ? PRO_BOWL_WEEK_INDEX - 1 : previousRaw;
  const next = nextRaw === PRO_BOWL_WEEK_INDEX ? PRO_BOWL_WEEK_INDEX + 1 : nextRaw;
  return [previous, current.weekIndex, next]
    .filter((weekIndex) => weekIndex >= 0 && weekIndex <= max && weekIndex !== PRO_BOWL_WEEK_INDEX)
    .map((weekIndex) => ({ stageIndex: current.stageIndex, weekIndex }));
}

export function allWeeks(): EaWeekRef[] {
  return [
    ...PRESEASON_WEEK_INDEXES.map((weekIndex) => ({ stageIndex: 0 as EaStage, weekIndex })),
    ...SEASON_WEEK_INDEXES.map((weekIndex) => ({ stageIndex: 1 as EaStage, weekIndex })),
  ];
}

/** Rejects the Pro Bowl and out-of-range values so a bad request never hits EA. */
export function validateWeekRef(ref: EaWeekRef): EaWeekRef {
  const stageIndex: EaStage = ref.stageIndex === 0 ? 0 : 1;
  const max = stageIndex === 0 ? 3 : 22;
  const weekIndex = Math.trunc(ref.weekIndex);
  if (!Number.isFinite(weekIndex) || weekIndex < 0 || weekIndex > max) {
    throw new Error(`Week ${weekIndex + 1} is not a valid ${stageIndex === 0 ? "preseason" : "season"} week.`);
  }
  if (stageIndex === 1 && weekIndex === PRO_BOWL_WEEK_INDEX) {
    throw new Error("The Pro Bowl week has no exportable data in Madden.");
  }
  return { stageIndex, weekIndex };
}

/** Expands an inclusive display-week span into EA refs, dropping the Pro Bowl. */
export function weekSpan(stageIndex: EaStage, fromDisplayWeek: number, toDisplayWeek: number): EaWeekRef[] {
  const start = Math.min(fromDisplayWeek, toDisplayWeek);
  const end = Math.max(fromDisplayWeek, toDisplayWeek);
  const refs: EaWeekRef[] = [];
  for (let displayWeek = start; displayWeek <= end; displayWeek += 1) {
    const weekIndex = displayWeek - 1;
    if (stageIndex === 1 && weekIndex === PRO_BOWL_WEEK_INDEX) continue;
    const max = stageIndex === 0 ? 3 : 22;
    if (weekIndex < 0 || weekIndex > max) continue;
    refs.push({ stageIndex, weekIndex });
  }
  return refs;
}

/**
 * How weekly datasets are chosen when the caller does not send an explicit week list.
 *
 * - `current` — only the franchise's current week (manual "Current week" and auto-import)
 * - `through_current` — every exportable week in the current stage up through current
 */
export type EaWeekScope = "current" | "through_current";

export function weeksThroughCurrent(current: EaWeekRef): EaWeekRef[] {
  const ref = validateWeekRef(current);
  const refs: EaWeekRef[] = [];
  const max = ref.stageIndex === 0 ? 3 : 22;
  for (let weekIndex = 0; weekIndex <= ref.weekIndex && weekIndex <= max; weekIndex += 1) {
    if (ref.stageIndex === 1 && weekIndex === PRO_BOWL_WEEK_INDEX) continue;
    refs.push({ stageIndex: ref.stageIndex, weekIndex });
  }
  return refs;
}

export function dedupeWeekRefs(refs: EaWeekRef[]): EaWeekRef[] {
  const unique: EaWeekRef[] = [];
  for (const ref of refs) {
    const validated = validateWeekRef(ref);
    const key = `${validated.stageIndex}:${validated.weekIndex}`;
    if (!unique.some((existing) => `${existing.stageIndex}:${existing.weekIndex}` === key)) unique.push(validated);
  }
  return unique;
}

/**
 * Resolves which EA weeks a weekly dataset import should fetch.
 *
 * Explicit `weekRefs` always win (specific week or a range). Otherwise a lone stage/weekIndex
 * is that one week. Otherwise `through_current` expands 0..current in the current stage, and
 * the default (`current` / omitted) is only the franchise's current week.
 */
export function resolveWeeklyImportRefs(input: {
  weekRefs?: EaWeekRef[] | null;
  stage?: EaStage;
  weekIndex?: number;
  weekScope?: EaWeekScope | null;
  current: EaWeekRef;
}): EaWeekRef[] {
  if (input.weekRefs && input.weekRefs.length > 0) return dedupeWeekRefs(input.weekRefs);
  if (input.stage !== undefined && input.weekIndex !== undefined) {
    return [validateWeekRef({ stageIndex: input.stage, weekIndex: input.weekIndex })];
  }
  const current = validateWeekRef(input.current);
  if (input.weekScope === "through_current") return weeksThroughCurrent(current);
  return [current];
}

/**
 * Week-scoped id for rec_games.external_game_id. EA scheduleIds are not unique across weeks
 * (snallabot: unique key is weekIndex + seasonIndex + id), so a bare scheduleId would let
 * week 2 ON CONFLICT onto week 1 and erase it.
 */
export function eaScheduleExternalId(displayWeek: number, scheduleId: string | number): string {
  return `ea:w${displayWeek}:${scheduleId}`;
}

/** EA lists unplayed games as 0-0. Persist null until the game is actually completed so
 *  GOTW / readiness treat them as unscored rather than a final 0-0. */
export function persistedImportedScores(
  completed: boolean,
  homeScore: number | null,
  awayScore: number | null,
): { homeScore: number | null; awayScore: number | null } {
  if (!completed) return { homeScore: null, awayScore: null };
  return { homeScore, awayScore };
}

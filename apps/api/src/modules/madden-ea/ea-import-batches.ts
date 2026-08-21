/** Snallabot fetches two weeks of weekly stats at once (all endpoints in parallel), then
 *  the next two. Same shape here so a 6-week import is a handful of EA rounds instead of
 *  48 serial calls. */
export const EA_WEEKLY_WEEK_BATCH = 2;

/** Snallabot pulls team rosters in groups of 4. Sequential 32-team fetches were the
 *  slowest snapshot step. */
export const EA_ROSTER_TEAM_BATCH = 4;

export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  const step = Math.max(1, size);
  for (let index = 0; index < items.length; index += step) {
    batches.push(items.slice(index, index + step) as T[]);
  }
  return batches;
}

/** Write schedule before other weekly datasets so team/player stats can resolve games. */
export function weeklyWriteOrder<T extends { dataset: string }>(items: T[]): T[] {
  const schedule = items.filter((item) => item.dataset === "schedule");
  const rest = items.filter((item) => item.dataset !== "schedule");
  return [...schedule, ...rest];
}

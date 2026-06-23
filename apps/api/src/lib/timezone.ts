// Friendly timezone labels the bot offers for the next-advance picker, mapped to
// IANA zones so DST is handled correctly when converting a wall-clock time to UTC.
const TZ_LABEL_TO_IANA: Record<string, string> = {
  EST: "America/New_York",
  CST: "America/Chicago",
  PST: "America/Los_Angeles",
  AKST: "America/Anchorage",
};

export const SUPPORTED_TZ_LABELS = Object.keys(TZ_LABEL_TO_IANA);

export function tzLabelToIana(label: string): string {
  return TZ_LABEL_TO_IANA[label.toUpperCase()] ?? "America/Chicago";
}

// Offset (ms) of `timeZone` at the given instant: (wall time the zone shows) - (UTC).
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return asUTC - instant.getTime();
}

// Convert a wall-clock time in `tzLabel` (e.g. "5 PM CST on 2026-06-23") to the
// matching UTC instant. Two-step offset resolution; correct except inside the
// rare DST spring-forward gap, which the hourly picker never lands on in practice.
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tzLabel: string,
): Date {
  const timeZone = tzLabelToIana(tzLabel);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = tzOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

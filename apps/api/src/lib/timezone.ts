// Friendly timezone labels the bot offers for the next-advance picker, mapped to
// IANA zones so DST is handled correctly when converting a wall-clock time to UTC.
const TZ_LABEL_TO_IANA: Record<string, string> = {
  EST: "America/New_York",
  CST: "America/Chicago",
  MST: "America/Denver",
  PST: "America/Los_Angeles",
  AKST: "America/Anchorage",
};

export const SUPPORTED_TZ_LABELS = Object.keys(TZ_LABEL_TO_IANA);

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function tzLabelToIana(label: string): string {
  return TZ_LABEL_TO_IANA[label.toUpperCase()] ?? "America/Chicago";
}

// Offset (ms) of `timeZone` at the given instant: (wall time the zone shows) - (UTC).
export function tzOffsetMs(instant: Date, timeZone: string): number {
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
  return zonedWallTimeToUtcIana(year, month, day, hour, minute, tzLabelToIana(tzLabel));
}

// Same conversion, but for an arbitrary IANA zone (used by the scheduling system, where a user
// can pick "Other" and enter any IANA zone rather than one of the five US labels above).
export function zonedWallTimeToUtcIana(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = tzOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

// Friendly "Wed, Aug 19, 9:00 PM CDT" rendering of a UTC instant in an arbitrary IANA zone —
// used anywhere a scheduled/proposed time is shown to a specific person, so it always reads in
// their zone (or a sensible fallback) rather than the UTC the value is stored in.
export function formatInstantInZone(iso: string, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
  return dtf.format(new Date(iso));
}

// Inverse: what wall-clock date/time does `instant` show in `timeZone`? Used to walk
// calendar days in a user's own timezone when generating recurring-availability instants.
export function instantToZonedParts(instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) if (p.type !== "literal") map[p.type] = p.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: +map.year, month: +map.month, day: +map.day, hour: +map.hour, minute: +map.minute, weekday: weekdayMap[map.weekday] ?? 0 };
}

import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { instantToZonedParts, isValidIanaTimeZone, zonedWallTimeToUtcIana } from "../../lib/timezone.js";
import { userIdFromDiscordId } from "./shared.js";

export type Interval = { startUtc: string; endUtc: string };
export type RecurringWindow = { id: string; weekday: number; startMinute: number; endMinute: number };
export type Override = {
  id: string; scope: "week" | "day" | "matchup"; startsAt: string; endsAt: string;
  unavailable: boolean; timezoneOverride: string | null; gameId: string | null;
};

const DEFAULT_TIMEZONE_SOURCE = "unset";

export async function getAvailabilityProfile(userId: string) {
  const row = await supabase.from("rec_user_availability_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (row.error) throw new ApiError(500, "Failed to load availability profile.", row.error);
  return row.data ?? { user_id: userId, timezone: null, timezone_source: DEFAULT_TIMEZONE_SOURCE, show_detailed_availability: true };
}

export async function getAvailabilityProfileByDiscordId(discordId: string) {
  return getAvailabilityProfile(await userIdFromDiscordId(discordId));
}

export async function setTimezone(input: { userId: string; timezone: string; source: "site_detected" | "site_manual" | "discord_manual" }) {
  if (!isValidIanaTimeZone(input.timezone)) throw new ApiError(400, `"${input.timezone}" is not a recognized timezone.`);
  const upsert = await supabase.from("rec_user_availability_profiles").upsert({
    user_id: input.userId,
    timezone: input.timezone,
    timezone_source: input.source,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" }).select("*").single();
  if (upsert.error) throw new ApiError(500, "Failed to save your timezone.", upsert.error);
  return upsert.data;
}

export async function setAvailabilityVisibility(input: { userId: string; showDetailed: boolean }) {
  const upsert = await supabase.from("rec_user_availability_profiles").upsert({
    user_id: input.userId,
    show_detailed_availability: input.showDetailed,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" }).select("*").single();
  if (upsert.error) throw new ApiError(500, "Failed to save your availability visibility setting.", upsert.error);
  return upsert.data;
}

// Merge/normalize a set of {weekday,startMinute,endMinute} windows for ONE weekday into the
// minimal set of non-overlapping, non-adjacent continuous windows — so selecting "6-8pm" and
// "8-10pm" in the UI is stored as a single 6-10pm window, not two fragments (point 33's
// "one change I'd make" from the design doc).
export function mergeWindows(windows: Array<{ startMinute: number; endMinute: number }>): Array<{ startMinute: number; endMinute: number }> {
  const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute);
  const merged: Array<{ startMinute: number; endMinute: number }> = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.startMinute <= last.endMinute) last.endMinute = Math.max(last.endMinute, w.endMinute);
    else merged.push({ ...w });
  }
  return merged;
}

export async function getRecurringWindows(userId: string, leagueId: string | null): Promise<RecurringWindow[]> {
  // League-scoped windows take priority over the global default when both exist for this user.
  const scoped = leagueId
    ? await supabase.from("rec_user_availability_windows").select("*").eq("user_id", userId).eq("league_id", leagueId).eq("active", true)
    : { data: [] as any[], error: null };
  if (scoped.error) throw new ApiError(500, "Failed to load availability.", scoped.error);
  if (scoped.data && scoped.data.length > 0) return scoped.data.map(rowToWindow);

  const global = await supabase.from("rec_user_availability_windows").select("*").eq("user_id", userId).is("league_id", null).eq("active", true);
  if (global.error) throw new ApiError(500, "Failed to load availability.", global.error);
  return (global.data ?? []).map(rowToWindow);
}

function rowToWindow(row: any): RecurringWindow {
  return { id: row.id, weekday: row.weekday, startMinute: row.start_minute, endMinute: row.end_minute };
}

// Full replace of one weekday's recurring windows (global or league-scoped). Empty array means
// "unavailable this day" (no rows for that weekday).
export async function setRecurringWindowsForDay(input: {
  userId: string; leagueId: string | null; weekday: number;
  windows: Array<{ startMinute: number; endMinute: number }>;
}) {
  if (input.weekday < 0 || input.weekday > 6) throw new ApiError(400, "weekday must be 0-6.");
  const merged = mergeWindows(input.windows.filter((w) => w.endMinute > w.startMinute));

  let del = supabase.from("rec_user_availability_windows").delete().eq("user_id", input.userId).eq("weekday", input.weekday);
  del = input.leagueId ? del.eq("league_id", input.leagueId) : del.is("league_id", null);
  const deleted = await del;
  if (deleted.error) throw new ApiError(500, "Failed to update availability.", deleted.error);

  if (!merged.length) return { windows: [] };
  const now = new Date().toISOString();
  const inserted = await supabase.from("rec_user_availability_windows").insert(
    merged.map((w) => ({
      user_id: input.userId, league_id: input.leagueId, weekday: input.weekday,
      start_minute: w.startMinute, end_minute: w.endMinute, active: true, created_at: now, updated_at: now,
    })),
  ).select("*");
  if (inserted.error) throw new ApiError(500, "Failed to save availability.", inserted.error);
  return { windows: (inserted.data ?? []).map(rowToWindow) };
}

// A day is either windowed (rec_user_availability_windows has a row) or explicitly marked
// unavailable (rec_user_availability_day_marks has a row) -- the two are mutually exclusive, so
// setting one clears the other. Both use the same global/league-scoped fallback.
export async function markAvailabilityDayUnavailable(input: { userId: string; leagueId: string | null; weekday: number }) {
  if (input.weekday < 0 || input.weekday > 6) throw new ApiError(400, "weekday must be 0-6.");
  let delWindows = supabase.from("rec_user_availability_windows").delete().eq("user_id", input.userId).eq("weekday", input.weekday);
  delWindows = input.leagueId ? delWindows.eq("league_id", input.leagueId) : delWindows.is("league_id", null);
  const deletedWindows = await delWindows;
  if (deletedWindows.error) throw new ApiError(500, "Failed to update availability.", deletedWindows.error);

  const upsert = await supabase.from("rec_user_availability_day_marks").upsert(
    { user_id: input.userId, league_id: input.leagueId, weekday: input.weekday, marked_at: new Date().toISOString() },
    { onConflict: "user_id,weekday,league_id" },
  );
  if (upsert.error) throw new ApiError(500, "Failed to mark this day unavailable.", upsert.error);
  return { markedUnavailable: true };
}

export async function clearAvailabilityDayUnavailable(input: { userId: string; leagueId: string | null; weekday: number }) {
  let del = supabase.from("rec_user_availability_day_marks").delete().eq("user_id", input.userId).eq("weekday", input.weekday);
  del = input.leagueId ? del.eq("league_id", input.leagueId) : del.is("league_id", null);
  const deleted = await del;
  if (deleted.error) throw new ApiError(500, "Failed to clear that unavailable mark.", deleted.error);
  return { markedUnavailable: false };
}

export async function getAvailabilityDayMarks(userId: string, leagueId: string | null): Promise<Set<number>> {
  const scoped = leagueId
    ? await supabase.from("rec_user_availability_day_marks").select("weekday").eq("user_id", userId).eq("league_id", leagueId)
    : { data: [] as any[], error: null };
  if (scoped.error) throw new ApiError(500, "Failed to load availability.", scoped.error);
  const global = await supabase.from("rec_user_availability_day_marks").select("weekday").eq("user_id", userId).is("league_id", null);
  if (global.error) throw new ApiError(500, "Failed to load availability.", global.error);
  return new Set([...(scoped.data ?? []), ...(global.data ?? [])].map((r: any) => Number(r.weekday)));
}

// "Fully set" = a timezone AND, for every day of the week, at least one active window or an
// explicit Unavailable mark (global or league-scoped) -- an untouched day counts as missing.
export async function isAvailabilityFullySet(userId: string, leagueId: string | null): Promise<boolean> {
  const profile = await getAvailabilityProfile(userId);
  if (!profile.timezone) return false;
  const [windows, dayMarks] = await Promise.all([
    getRecurringWindows(userId, leagueId),
    getAvailabilityDayMarks(userId, leagueId),
  ]);
  const windowedDays = new Set(windows.map((w) => w.weekday));
  for (let weekday = 0; weekday <= 6; weekday++) {
    if (!windowedDays.has(weekday) && !dayMarks.has(weekday)) return false;
  }
  return true;
}

export async function listOverrides(input: { userId: string; leagueId?: string | null; gameId?: string | null }): Promise<Override[]> {
  let query = supabase.from("rec_availability_overrides").select("*").eq("user_id", input.userId).order("starts_at", { ascending: true });
  if (input.gameId) query = query.eq("game_id", input.gameId);
  else if (input.leagueId !== undefined) query = input.leagueId ? query.eq("league_id", input.leagueId) : query.is("league_id", null);
  const result = await query;
  if (result.error) throw new ApiError(500, "Failed to load availability overrides.", result.error);
  return (result.data ?? []).map(rowToOverride);
}

function rowToOverride(row: any): Override {
  return {
    id: row.id, scope: row.scope, startsAt: row.starts_at, endsAt: row.ends_at,
    unavailable: row.unavailable, timezoneOverride: row.timezone_override, gameId: row.game_id,
  };
}

export async function createOverride(input: {
  userId: string; leagueId: string | null; gameId?: string | null; scope: "week" | "day" | "matchup";
  startsAt: string; endsAt: string; unavailable: boolean; timezoneOverride?: string | null;
}) {
  if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) throw new ApiError(400, "End time must be after start time.");
  if (input.scope === "matchup" && !input.gameId) throw new ApiError(400, "A matchup override requires a gameId.");
  const insert = await supabase.from("rec_availability_overrides").insert({
    user_id: input.userId, league_id: input.leagueId, game_id: input.gameId ?? null, scope: input.scope,
    starts_at: input.startsAt, ends_at: input.endsAt, unavailable: input.unavailable,
    timezone_override: input.timezoneOverride ?? null,
  }).select("*").single();
  if (insert.error) throw new ApiError(500, "Failed to save the availability change.", insert.error);
  return rowToOverride(insert.data);
}

export async function deleteOverride(input: { userId: string; overrideId: string }) {
  const deleted = await supabase.from("rec_availability_overrides").delete().eq("id", input.overrideId).eq("user_id", input.userId).select("id").maybeSingle();
  if (deleted.error) throw new ApiError(500, "Failed to remove the availability change.", deleted.error);
  if (!deleted.data) throw new ApiError(404, "Availability change not found.");
  return { deleted: true };
}

function subtractInterval(intervals: Interval[], cut: Interval): Interval[] {
  const cutStart = new Date(cut.startUtc).getTime();
  const cutEnd = new Date(cut.endUtc).getTime();
  const out: Interval[] = [];
  for (const iv of intervals) {
    const s = new Date(iv.startUtc).getTime();
    const e = new Date(iv.endUtc).getTime();
    if (cutEnd <= s || cutStart >= e) { out.push(iv); continue; }
    if (cutStart > s) out.push({ startUtc: iv.startUtc, endUtc: new Date(cutStart).toISOString() });
    if (cutEnd < e) out.push({ startUtc: new Date(cutEnd).toISOString(), endUtc: iv.endUtc });
  }
  return out;
}

function clipAndSort(intervals: Interval[], fromUtc: string, toUtc: string): Interval[] {
  const from = new Date(fromUtc).getTime();
  const to = new Date(toUtc).getTime();
  const clipped = intervals
    .map((iv) => ({ startUtc: new Date(Math.max(from, new Date(iv.startUtc).getTime())).toISOString(), endUtc: new Date(Math.min(to, new Date(iv.endUtc).getTime())).toISOString() }))
    .filter((iv) => new Date(iv.endUtc).getTime() > new Date(iv.startUtc).getTime());
  clipped.sort((a, b) => new Date(a.startUtc).getTime() - new Date(b.startUtc).getTime());
  // Merge any that ended up adjacent/overlapping after clipping.
  const merged: Interval[] = [];
  for (const iv of clipped) {
    const last = merged[merged.length - 1];
    if (last && new Date(iv.startUtc).getTime() <= new Date(last.endUtc).getTime()) {
      if (new Date(iv.endUtc).getTime() > new Date(last.endUtc).getTime()) last.endUtc = iv.endUtc;
    } else merged.push({ ...iv });
  }
  return merged;
}

// Expand this user's recurring weekly windows into concrete UTC intervals covering every day
// in [fromUtc, toUtc), in their profile timezone.
function expandRecurringWindows(windows: RecurringWindow[], timezone: string, fromUtc: string, toUtc: string): Interval[] {
  const intervals: Interval[] = [];
  const from = new Date(fromUtc);
  const to = new Date(toUtc);
  // Walk one calendar day at a time in the user's timezone, starting one day before `from` so a
  // window that starts the prior day and crosses midnight (end_minute > 1440) is still caught.
  let cursor = new Date(from.getTime() - 26 * 60 * 60 * 1000);
  const windowsByWeekday = new Map<number, RecurringWindow[]>();
  for (const w of windows) windowsByWeekday.set(w.weekday, [...(windowsByWeekday.get(w.weekday) ?? []), w]);

  let guard = 0;
  while (cursor.getTime() < to.getTime() && guard < 40) {
    guard += 1;
    const parts = instantToZonedParts(cursor, timezone);
    for (const w of windowsByWeekday.get(parts.weekday) ?? []) {
      const startUtc = zonedWallTimeToUtcIana(parts.year, parts.month, parts.day, Math.floor(w.startMinute / 60), w.startMinute % 60, timezone);
      const endDayOffsetMin = w.endMinute; // may exceed 1440 -- Date.UTC normalizes overflowed hours/days for us via the minute math below
      const endUtc = new Date(startUtc.getTime() + (endDayOffsetMin - w.startMinute) * 60 * 1000);
      intervals.push({ startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() });
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return clipAndSort(intervals, fromUtc, toUtc);
}

// The core resolver: default recurring availability, with week overrides applied on top, then
// matchup overrides applied on top of that -- each override layer fully replaces whatever
// availability existed in its own [starts_at, ends_at) span (see availability.service.ts's
// createOverride docs): unavailable=true blacks the span out, unavailable=false makes the whole
// span available regardless of what the recurring schedule said.
export async function getEffectiveAvailability(input: {
  userId: string; leagueId: string; gameId?: string | null; fromUtc: string; toUtc: string;
}): Promise<{ timezone: string | null; intervals: Interval[] }> {
  const profile = await getAvailabilityProfile(input.userId);
  const timezone = profile.timezone ?? "America/Chicago";
  const windows = await getRecurringWindows(input.userId, input.leagueId);
  let intervals = expandRecurringWindows(windows, timezone, input.fromUtc, input.toUtc);

  const weekOverrides = await listOverrides({ userId: input.userId, leagueId: input.leagueId });
  for (const ov of weekOverrides.filter((o) => o.scope !== "matchup")) {
    intervals = subtractInterval(intervals, { startUtc: ov.startsAt, endUtc: ov.endsAt });
    if (!ov.unavailable) intervals.push({ startUtc: ov.startsAt, endUtc: ov.endsAt });
  }

  if (input.gameId) {
    const matchupOverrides = await listOverrides({ userId: input.userId, gameId: input.gameId });
    for (const ov of matchupOverrides) {
      intervals = subtractInterval(intervals, { startUtc: ov.startsAt, endUtc: ov.endsAt });
      if (!ov.unavailable) intervals.push({ startUtc: ov.startsAt, endUtc: ov.endsAt });
    }
  }

  return { timezone: profile.timezone, intervals: clipAndSort(intervals, input.fromUtc, input.toUtc) };
}

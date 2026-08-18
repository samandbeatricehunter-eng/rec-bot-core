// Parses a Discord modal's free-text availability line for one weekday into
// {startMinute,endMinute} windows the scheduling API stores -- e.g. "6pm-9pm, 10pm-12am" or
// "off". Requires am/pm on every time (no implicit inference) so a typo can't silently store
// the wrong half of the day; the site's settings page offers a real time picker instead for
// anyone who doesn't want to type this out.
export type ParsedWindow = { startMinute: number; endMinute: number };

const OFF_WORDS = new Set(["off", "unavailable", "none", "n/a", "-"]);
const TIME_RE = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;

function parseClock(raw: string): number | null {
  const match = TIME_RE.exec(raw.trim());
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;
  const meridiem = match[3].toLowerCase();
  const hour24 = meridiem === "am" ? (hour12 === 12 ? 0 : hour12) : (hour12 === 12 ? 12 : hour12 + 12);
  return hour24 * 60 + minute;
}

export function parseAvailabilityText(input: string): { windows: ParsedWindow[] } | { error: string } {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || OFF_WORDS.has(trimmed)) return { windows: [] };

  const windows: ParsedWindow[] = [];
  for (const segmentRaw of input.split(",")) {
    const segment = segmentRaw.trim();
    if (!segment) continue;
    const parts = segment.split("-");
    if (parts.length !== 2) return { error: `Couldn't read "${segment}" — use a format like "6pm-9pm" (comma-separate multiple windows).` };
    const start = parseClock(parts[0]);
    const end = parseClock(parts[1]);
    if (start == null || end == null) return { error: `Couldn't read "${segment}" — each time needs a number and am/pm, e.g. "6pm-9pm" or "10pm-1am".` };
    const endAdjusted = end <= start ? end + 1440 : end; // crosses midnight, e.g. 10pm-1am
    windows.push({ startMinute: start, endMinute: endAdjusted });
  }
  return { windows };
}

export const WEEKDAY_LABELS: Array<{ weekday: number; label: string }> = [
  { weekday: 1, label: "Monday" }, { weekday: 2, label: "Tuesday" }, { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" }, { weekday: 5, label: "Friday" }, { weekday: 6, label: "Saturday" },
  { weekday: 0, label: "Sunday" },
];

export function formatWindows(windows: ParsedWindow[]): string {
  if (!windows.length) return "Unavailable";
  return windows.map((w) => `${formatClock(w.startMinute)}-${formatClock(w.endMinute % 1440)}${w.endMinute >= 1440 ? " (+1d)" : ""}`).join(", ");
}

function formatClock(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const meridiem = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${hour12}${meridiem}` : `${hour12}:${String(minute).padStart(2, "0")}${meridiem}`;
}

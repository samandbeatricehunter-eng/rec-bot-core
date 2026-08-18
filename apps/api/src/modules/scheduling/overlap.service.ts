import type { Interval } from "./availability.service.js";

export const MIN_GAME_WINDOW_MINUTES = 90;

export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(new Date(x.startUtc).getTime(), new Date(y.startUtc).getTime());
      const end = Math.min(new Date(x.endUtc).getTime(), new Date(y.endUtc).getTime());
      if (end - start >= MIN_GAME_WINDOW_MINUTES * 60 * 1000) {
        out.push({ startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString() });
      }
    }
  }
  out.sort((a2, b2) => new Date(a2.startUtc).getTime() - new Date(b2.startUtc).getTime());
  return out;
}

export type ScoredCandidate = { kickoffUtc: string; windowEndUtc: string; score: number };

// Scoring per the design doc's 6-factor rule: prefer windows with plenty of runway before the
// deadline (safety margin), avoid extremely late local kickoffs for either coach, and prefer
// sooner over later without being so soon the opponent has no notice. `deadlineUtc` is the next
// advance (or the 48h horizon when no advance is set) -- "significantly more safety before
// advance" from the example in the spec is captured by rewarding margin-to-deadline directly.
export function scoreOverlapWindows(input: {
  windows: Interval[]; deadlineUtc: string; nowUtc: string; homeTimezone: string; awayTimezone: string;
}): ScoredCandidate[] {
  const deadline = new Date(input.deadlineUtc).getTime();
  const now = new Date(input.nowUtc).getTime();
  const candidates: ScoredCandidate[] = [];

  for (const w of input.windows) {
    const start = new Date(w.startUtc).getTime();
    const end = new Date(w.endUtc).getTime();
    const durationMin = (end - start) / 60000;
    const marginToDeadlineMin = (deadline - end) / 60000;
    const noticeMin = (start - now) / 60000;
    const homeLocalHour = localHour(start, input.homeTimezone);
    const awayLocalHour = localHour(start, input.awayTimezone);
    const lateNightPenalty = latePenalty(homeLocalHour) + latePenalty(awayLocalHour);

    // Longer windows, more safety margin before the deadline, and at least a little notice all
    // score positively; being extremely late-night for either coach or offering essentially no
    // notice both score negatively.
    const score =
      Math.min(durationMin, 240) * 0.5 +
      Math.min(Math.max(marginToDeadlineMin, 0), 2880) * 0.15 +
      Math.min(Math.max(noticeMin, 0), 180) * 0.2 -
      lateNightPenalty * 25;

    candidates.push({ kickoffUtc: w.startUtc, windowEndUtc: w.endUtc, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function localHour(instantMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" });
  return Number(fmt.format(new Date(instantMs)));
}

// 0 penalty during a normal evening window, rising penalty the later past midnight it gets.
function latePenalty(localHour: number): number {
  if (localHour >= 0 && localHour < 6) return (6 - localHour) / 2;
  return 0;
}

// Kickoff-time suggestions within a shared window, at 30-minute increments (per the design
// doc's "8:00, 8:30, 9:00, 9:30" example) rather than only the window's exact start.
export function suggestedKickoffsWithinWindow(window: Interval, maxSuggestions = 4): string[] {
  const start = new Date(window.startUtc).getTime();
  const end = new Date(window.endUtc).getTime();
  const latestKickoff = end - MIN_GAME_WINDOW_MINUTES * 60 * 1000;
  const suggestions: string[] = [];
  for (let t = start; t <= latestKickoff && suggestions.length < maxSuggestions; t += 30 * 60 * 1000) {
    suggestions.push(new Date(t).toISOString());
  }
  return suggestions.length ? suggestions : [window.startUtc];
}

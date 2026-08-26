import { elapsedMsExcludingQuietHours } from "../../lib/timezone.js";

const CENTRAL_TIME_ZONE = "America/Chicago";

/** No automated user pings in game channels from midnight through 5:59:59 AM Central. */
export function isGameChannelQuietHours(at = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(at));
  return hour >= 0 && hour < 6;
}

// The 8h "opponent never responded" wait doesn't run while the non-responding coach is asleep
// -- their local midnight-6:59AM doesn't count toward it, so a proposal sent right before
// someone's bedtime doesn't quietly qualify for a Force Win before they've had a normal waking
// day to see it. recipientTimeZone defaults to Central (this file's existing quiet-hours
// convention) for callers that don't have a specific recipient's profile timezone on hand yet.
export function hasFailureToScheduleWaitElapsed(
  requesterRespondedAt: string | null | undefined,
  opponentRespondedAt: string | null | undefined,
  recipientTimeZone: string = CENTRAL_TIME_ZONE,
  nowMs = Date.now(),
): boolean {
  if (!requesterRespondedAt || opponentRespondedAt) return false;
  const outreachMs = new Date(requesterRespondedAt).getTime();
  if (!Number.isFinite(outreachMs)) return false;
  return elapsedMsExcludingQuietHours(outreachMs, nowMs, recipientTimeZone, 0, 7) >= 8 * 60 * 60 * 1000;
}

// Check-ins were retired (see reminder-poller.service.ts's simplification) -- qualification now
// rests on "scheduled through REC and marked over", not on both coaches having pressed a
// check-in button.
export function qualifiesForSchedulingPayoutBonus(input: {
  confirmedAt: string | null | undefined;
  homeUserId: string | null | undefined;
  awayUserId: string | null | undefined;
  markedOver: boolean;
}): boolean {
  return Boolean(input.confirmedAt && input.homeUserId && input.awayUserId && input.markedOver);
}

export type DiscordCleanupMessage = {
  id: string;
  author?: { id?: string };
  content?: string;
  embeds?: unknown[];
  mentions?: unknown[];
  components?: Array<{ components?: Array<{ custom_id?: string }> }>;
};

/** Select transient REC scheduling traffic while preserving humans and bot-authored embeds. */
export function isTransientGameSchedulingMessage(message: DiscordCleanupMessage, botUserId: string): boolean {
  if (message.author?.id !== botUserId || (message.embeds?.length ?? 0) > 0) return false;
  if ((message.mentions?.length ?? 0) > 0) return true;
  const hasSchedulingAction = (message.components ?? []).some((row) =>
    (row.components ?? []).some((component) => String(component.custom_id ?? "").startsWith("rec:gamesched:")),
  );
  if (hasSchedulingAction) return true;
  return /\b(proposed|proposal|accepted|countered|declined|withdrew|reschedul(?:e|ed|ing)|schedule(?:d| a time)|kickoff|check(?:ed)? in|force win|autopilot)\b/i.test(message.content ?? "");
}

export type MatchupsChannelPostState = {
  week_number: number;
  channel_id: string;
  message_id: string;
};

export type MatchupsChannelWritePlan =
  | { action: "edit"; channelId: string; messageId: string }
  | { action: "move"; deleteChannelId: string; deleteMessageId: string }
  | { action: "post" };

export const WEEKLY_MATCHUPS_EMBED_TITLE_RE = /^Season \d+, Week \d+ Matchups$/;

export function isWeeklyMatchupsEmbedTitle(title: string | null | undefined): boolean {
  return Boolean(title && WEEKLY_MATCHUPS_EMBED_TITLE_RE.test(title));
}

// Dedicated matchups channel wins; announcements is the fallback for leagues that never
// split the weekly board out of the announcements channel.
export function resolveMatchupsChannelId(routes: Record<string, unknown> | null | undefined): string {
  const matchups = String(routes?.matchups_channel_id ?? "").trim();
  if (matchups) return matchups;
  return String(routes?.announcements_channel_id ?? "").trim();
}

// Week number is intentionally ignored: the same Discord message is edited in place when the
// league advances, so the channel never accumulates a new copy per week (or per scheduling
// mutation). A new post only happens when nothing is tracked yet, or the tracked message is
// in a different channel.
export function planMatchupsChannelWrite(input: {
  stored: MatchupsChannelPostState | null;
  channelId: string;
}): MatchupsChannelWritePlan {
  if (input.stored?.message_id && input.stored.channel_id === input.channelId) {
    return { action: "edit", channelId: input.channelId, messageId: input.stored.message_id };
  }
  if (input.stored?.message_id) {
    return { action: "move", deleteChannelId: input.stored.channel_id, deleteMessageId: input.stored.message_id };
  }
  return { action: "post" };
}

export function planAfterMatchupsEditAttempt(result: "edited" | "missing" | "failed"): "done" | "post" | "abort" {
  if (result === "edited") return "done";
  if (result === "missing") return "post";
  return "abort";
}

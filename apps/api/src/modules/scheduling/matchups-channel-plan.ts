export type MatchupsChannelPostState = {
  week_number: number;
  channel_id: string;
  message_id: string;
};

export type MatchupsChannelWritePlan =
  | { action: "edit"; channelId: string; messageId: string }
  | { action: "replace"; deleteChannelId: string; deleteMessageId: string }
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

// Same week + same channel: edit the tracked message so scheduling mutations don't spam
// a new announcement. A new week (or a channel move) deletes the old board and posts a
// replacement at the bottom — never leave two "Season N, Week M Matchups" embeds.
export function planMatchupsChannelWrite(input: {
  stored: MatchupsChannelPostState | null;
  channelId: string;
  currentWeek: number;
}): MatchupsChannelWritePlan {
  if (input.stored?.message_id && input.stored.channel_id === input.channelId) {
    if (input.stored.week_number === input.currentWeek) {
      return { action: "edit", channelId: input.channelId, messageId: input.stored.message_id };
    }
    return { action: "replace", deleteChannelId: input.stored.channel_id, deleteMessageId: input.stored.message_id };
  }
  if (input.stored?.message_id) {
    return { action: "move", deleteChannelId: input.stored.channel_id, deleteMessageId: input.stored.message_id };
  }
  return { action: "post" };
}

// Discord's channel history is newest-first. Prefer the tracked id when it is still in
// the channel; otherwise keep the newest leftover board so we edit that instead of posting
// another copy.
export function chooseMatchupsKeepId(input: {
  existingIdsNewestFirst: string[];
  preferredId: string | null;
}): string | null {
  if (input.preferredId && input.existingIdsNewestFirst.includes(input.preferredId)) {
    return input.preferredId;
  }
  return input.existingIdsNewestFirst[0] ?? null;
}

export function planAfterMatchupsEditAttempt(result: "edited" | "missing" | "failed"): "done" | "post" | "abort" {
  if (result === "edited") return "done";
  if (result === "missing") return "post";
  return "abort";
}

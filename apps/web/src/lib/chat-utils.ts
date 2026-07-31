// Shared helpers for every chat surface (League Chat, Game Chat, Commissioner Chat, and the
// Universal Chat Drawer) — extracted from what LeagueChatPanel.tsx and CommissionerChatHome.tsx
// each implemented independently.

// created_at is a timestamptz, serialized with a UTC offset — Date + toLocaleTimeString
// (no explicit timeZone) always renders in the viewer's own device timezone.
export function formatLocalTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const MENTION_TRIGGER_RE = /(?:^|\s)@([a-z0-9._-]*)$/i;
const MENTION_REPLACE_RE = /(?:^|\s)@[a-z0-9._-]*$/i;

/** Trailing "@word" trigger at the end of a draft — the same single-line-input approach used
 * by every composer in this codebase (no cursor-position tracking, since none of them are a
 * rich editor). Returns the partial query typed after "@", or null if no mention is in progress. */
export function mentionQueryFromDraft(draft: string): string | null {
  const match = MENTION_TRIGGER_RE.exec(draft);
  return match ? match[1] : null;
}

/** Replaces the trailing "@word" being typed with a resolved mention token (e.g. "<@123>"),
 * preserving whatever leading whitespace preceded it. */
export function insertMentionToken(draft: string, token: string): string {
  return draft.replace(MENTION_REPLACE_RE, (m) => `${m[0] === "@" ? "" : m[0]}${token} `);
}

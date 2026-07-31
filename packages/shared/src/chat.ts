export type ChatChannelType = "league" | "game" | "commissioner";

/** Normalized message shape used by the unified chat drawer. The three
 * underlying services (league-chat, game-chat, commissioner-chat) keep their
 * own snake_case row types on the wire — callers adapt onto this shape. */
export type ChatMessageRow = {
  id: string;
  authorUserId: string | null;
  authorDiscordId: string | null;
  authorDisplayName: string | null;
  isDiscordOnly: boolean;
  source: "site" | "discord" | "system";
  discordMessageId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
};

export type ChatChannelSummary = {
  id: string;
  type: ChatChannelType;
  label: string;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  isLive?: boolean;
  isGotw?: boolean;
  participantFlag?: boolean;
};

export type ChatMarkReadInput = {
  channelType: ChatChannelType;
  channelId: string;
  lastReadMessageId: string;
};

export type ChatReactionSummary = { messageId: string; emojiKey: string; count: number; mine: boolean };

/** A small fixed quick-react set rather than a full emoji picker — matches the scope of every
 * other reaction surface in this codebase (matchup/highlight reactions are also a fixed set). */
export const CHAT_QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "👀"] as const;

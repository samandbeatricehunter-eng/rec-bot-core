import { useEffect, useRef, useState } from "react";
import type { ChatChannelType, ChatMessageRow } from "@rec/shared";
import { CHAT_QUICK_REACTIONS } from "@rec/shared";
import { formatLocalTime } from "../../lib/chat-utils.js";
import { renderMessageWithMentions } from "../../lib/mentions.js";
import { useChatReactions, type ReactionPill } from "../../lib/useChatReactions.js";
import type { MentionableList } from "../../types/api.js";

const DC_TOOLTIP = "Non-registered Discord-only member.";

function MessageReactionRow({ pills, onToggle }: { pills: ReactionPill[]; onToggle: (emojiKey: string) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="chat-reaction-row">
      {pills.map((pill) => (
        <button
          key={pill.emojiKey}
          type="button"
          className={`chat-reaction-pill${pill.mine ? " is-mine" : ""}`}
          onClick={() => onToggle(pill.emojiKey)}
        >
          {pill.emojiKey} {pill.count}
        </button>
      ))}
      <button type="button" className="chat-reaction-add" onClick={() => setPickerOpen((open) => !open)} aria-label="Add reaction">
        +
      </button>
      {pickerOpen && (
        <div className="chat-reaction-picker">
          {CHAT_QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onToggle(emoji);
                setPickerOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConversationView({
  messages,
  viewerDiscordId,
  mentionable,
  messageClassName,
  guildId,
  channelType,
}: {
  messages: ChatMessageRow[];
  viewerDiscordId: string;
  mentionable: MentionableList | null;
  /** Optional per-message body className (e.g. League/Game Chat's distinct styling for
   * source: "system" rows) — omit for the plain look commissioner chat has always used. */
  messageClassName?: (message: ChatMessageRow) => string | undefined;
  /** Reactions are opt-in: pass both to enable the reaction bar/quick-react row, omit either to
   * skip it entirely (kept optional so every existing caller works unchanged). */
  guildId?: string;
  channelType?: ChatChannelType;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const messageIds = messages.map((m) => m.id);
  const { reactionsByMessage, toggle } = useChatReactions({
    guildId: guildId ?? "",
    channelType: guildId && channelType ? channelType : null,
    messageIds,
  });

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages]);

  return (
    <div ref={feedRef} className="commissioner-chat-feed">
      {messages.map((m) => (
        <div key={m.id}>
          <span
            style={{
              fontWeight: 700,
              fontSize: "var(--text-xs)",
              color: m.authorDiscordId === viewerDiscordId ? "var(--gold)" : "var(--text-secondary)",
            }}
          >
            {m.authorDisplayName ?? "REC Member"}
          </span>
          {m.isDiscordOnly && (
            <span className="hub-dc-tag" title={DC_TOOLTIP}>
              DC
            </span>
          )}
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}> {formatLocalTime(m.createdAt)}</span>
          <p className={messageClassName?.(m)} style={{ margin: "2px 0 0" }}>
            {renderMessageWithMentions(m.body, mentionable)}
          </p>
          {guildId && channelType && (
            <MessageReactionRow pills={reactionsByMessage[m.id] ?? []} onToggle={(emojiKey) => void toggle(m.id, emojiKey)} />
          )}
        </div>
      ))}
      {messages.length === 0 && <p className="hub-empty">No messages yet — say hello.</p>}
    </div>
  );
}

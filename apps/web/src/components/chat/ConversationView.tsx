import { useEffect, useRef } from "react";
import type { ChatMessageRow } from "@rec/shared";
import { formatLocalTime } from "../../lib/chat-utils.js";
import { renderMessageWithMentions } from "../../lib/mentions.js";
import type { MentionableList } from "../../types/api.js";

const DC_TOOLTIP = "Non-registered Discord-only member.";

export function ConversationView({
  messages,
  viewerDiscordId,
  mentionable,
  messageClassName,
}: {
  messages: ChatMessageRow[];
  viewerDiscordId: string;
  mentionable: MentionableList | null;
  /** Optional per-message body className (e.g. League/Game Chat's distinct styling for
   * source: "system" rows) — omit for the plain look commissioner chat has always used. */
  messageClassName?: (message: ChatMessageRow) => string | undefined;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

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
        </div>
      ))}
      {messages.length === 0 && <p className="hub-empty">No messages yet — say hello.</p>}
    </div>
  );
}

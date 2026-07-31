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

function MessageRow({
  message,
  viewerDiscordId,
  mentionable,
  messageClassName,
  reactionPills,
  onToggleReaction,
  onEdit,
  onDelete,
}: {
  message: ChatMessageRow;
  viewerDiscordId: string;
  mentionable: MentionableList | null;
  messageClassName?: (message: ChatMessageRow) => string | undefined;
  reactionPills: ReactionPill[] | null;
  onToggleReaction: ((emojiKey: string) => void) | null;
  onEdit: ((body: string) => Promise<void>) | null;
  onDelete: (() => void) | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [busy, setBusy] = useState(false);
  const isMine = message.authorDiscordId === viewerDiscordId;

  async function saveEdit() {
    if (!onEdit || !draft.trim()) return;
    setBusy(true);
    try {
      await onEdit(draft.trim());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span
        style={{
          fontWeight: 700,
          fontSize: "var(--text-xs)",
          color: isMine ? "var(--gold)" : "var(--text-secondary)",
        }}
      >
        {message.authorDisplayName ?? "REC Member"}
      </span>
      {message.isDiscordOnly && (
        <span className="hub-dc-tag" title={DC_TOOLTIP}>
          DC
        </span>
      )}
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}> {formatLocalTime(message.createdAt)}</span>
      {message.editedAt && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}> (edited)</span>}
      {isMine && (onEdit || onDelete) && !editing && (
        <span className="chat-message-owner-actions">
          {onEdit && (
            <button type="button" onClick={() => { setDraft(message.body); setEditing(true); }}>
              Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete this message?")) onDelete();
              }}
            >
              Delete
            </button>
          )}
        </span>
      )}
      {editing ? (
        <div className="chat-message-edit-row">
          <input className="form-input" value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className="btn btn-primary" disabled={busy || !draft.trim()} onClick={() => void saveEdit()}>
            Save
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <p className={messageClassName?.(message)} style={{ margin: "2px 0 0" }}>
          {renderMessageWithMentions(message.body, mentionable)}
        </p>
      )}
      {reactionPills && onToggleReaction && <MessageReactionRow pills={reactionPills} onToggle={onToggleReaction} />}
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
  onEditMessage,
  onDeleteMessage,
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
  /** Edit/delete are opt-in too — only the message's own author ever sees the controls, so
   * omitting these just means no caller has wired the action yet, not a missing feature. */
  onEditMessage?: (messageId: string, body: string) => Promise<void>;
  onDeleteMessage?: (messageId: string) => void;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const messageIds = messages.map((m) => m.id);
  const reactionsEnabled = Boolean(guildId && channelType);
  const { reactionsByMessage, toggle } = useChatReactions({
    guildId: guildId ?? "",
    channelType: reactionsEnabled ? (channelType as ChatChannelType) : null,
    messageIds,
  });

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages]);

  return (
    <div ref={feedRef} className="commissioner-chat-feed">
      {messages.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          viewerDiscordId={viewerDiscordId}
          mentionable={mentionable}
          messageClassName={messageClassName}
          reactionPills={reactionsEnabled ? reactionsByMessage[m.id] ?? [] : null}
          onToggleReaction={reactionsEnabled ? (emojiKey) => void toggle(m.id, emojiKey) : null}
          onEdit={onEditMessage ? (body) => onEditMessage(m.id, body) : null}
          onDelete={onDeleteMessage ? () => onDeleteMessage(m.id) : null}
        />
      ))}
      {messages.length === 0 && <p className="hub-empty">No messages yet — say hello.</p>}
    </div>
  );
}

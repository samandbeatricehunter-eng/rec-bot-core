import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X } from "lucide-react";
import type { ChatChannelSummary, ChatChannelType, ChatMessageRow } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import { useSharedChatChannel } from "../../lib/chat-store.js";
// Side-effect only: registers the realtime hooks chat-store.ts calls when a channel activates.
// Imported here (not from chat-store.ts itself) to keep chat-store.ts free of a circular import
// — the drawer is unconditionally mounted by both host apps whenever chat is available, so this
// always loads before any channel is ever subscribed to.
import "../../lib/chat-realtime-client.js";
import { useChatDrawer } from "../../lib/chat-drawer-context.js";
import type { LeagueChatMember, MentionableList } from "../../types/api.js";
import { ChannelList } from "./ChannelList.js";
import { ConversationView } from "./ConversationView.js";
import { Composer } from "./Composer.js";

const CHANNEL_POLL_INTERVAL_MS = 15_000;

/**
 * Self-contained: renders both its own launcher (fixed icon + unread badge) and the slide-out
 * panel. Self-contained because apps/site's embed boundary only has Discord-shaped auth
 * (guildId/discordId) inside the embedded hub tree — the drawer can't depend on the site's
 * outer chrome/header, so it mounts once inside each host's auth-ready tree instead.
 */
export function UniversalChatDrawer({ guildId, discordId }: { guildId: string; discordId: string }) {
  const drawer = useChatDrawer();
  const [channels, setChannels] = useState<ChatChannelSummary[]>([]);
  const [selected, setSelected] = useState<{ channelType: ChatChannelType; channelId: string } | null>(null);
  const [leagueMembers, setLeagueMembers] = useState<LeagueChatMember[]>([]);
  const [commissionerMentionable, setCommissionerMentionable] = useState<MentionableList | null>(null);
  const canAccessCommissionerChatRef = useRef(false);

  const loadChannels = useCallback(() => {
    recApi
      .listChatChannels(guildId)
      .then((res) => {
        setChannels(res.channels);
        if (res.canAccessCommissionerChat && !canAccessCommissionerChatRef.current) {
          canAccessCommissionerChatRef.current = true;
          recApi.getMentionableCommissioners(guildId).then(setCommissionerMentionable).catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, [guildId]);

  useEffect(() => {
    loadChannels();
    const interval = setInterval(loadChannels, CHANNEL_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadChannels]);

  useEffect(() => {
    recApi.listLeagueMembersForChat(guildId).then((res) => setLeagueMembers(res.members)).catch(() => undefined);
  }, [guildId]);

  // Follow an external "open to this channel" request; otherwise default to the first channel.
  useEffect(() => {
    if (drawer.target) {
      setSelected(drawer.target);
      return;
    }
    setSelected((prev) => prev ?? (channels[0] ? { channelType: channels[0].type, channelId: channels[0].id } : null));
  }, [drawer.target, channels]);

  const handleLatestMessageId = useCallback(
    (lastReadMessageId: string) => {
      if (!drawer.open || !selected) return;
      recApi
        .markChatChannelRead({ guildId, channelType: selected.channelType, channelId: selected.channelId, lastReadMessageId })
        .then(loadChannels)
        .catch(() => undefined);
    },
    [drawer.open, guildId, selected, loadChannels],
  );

  const { messages, reactionsByMessage, attachmentsByMessage, sendMessage, editMessage, deleteMessage, toggleReaction, sending } = useSharedChatChannel({
    guildId,
    channelType: selected?.channelType ?? null,
    channelId: selected?.channelId ?? null,
    onLatestMessageId: handleLatestMessageId,
  });
  const [replyTarget, setReplyTarget] = useState<ChatMessageRow | null>(null);

  const mentionable: MentionableList | null = useMemo(() => {
    if (selected?.channelType === "commissioner") return commissionerMentionable;
    return { members: leagueMembers.filter((m) => m.discordId).map((m) => ({ discordId: m.discordId as string, displayName: m.displayName })), roles: [] };
  }, [selected?.channelType, commissionerMentionable, leagueMembers]);

  const mentionOptions = useMemo(() => {
    if (selected?.channelType === "commissioner") {
      return [
        ...(commissionerMentionable?.roles ?? []).map((r) => ({ token: `<@&${r.roleId}>`, label: r.name })),
        ...(commissionerMentionable?.members ?? []).map((m) => ({ token: `<@${m.discordId}>`, label: m.displayName })),
      ];
    }
    return leagueMembers.filter((m) => m.discordId).map((m) => ({ token: `<@${m.discordId}>`, label: m.displayName }));
  }, [selected?.channelType, commissionerMentionable, leagueMembers]);

  const totalUnread = channels.reduce((sum, c) => sum + c.unreadCount, 0);
  const selectedChannel = channels.find((c) => c.type === selected?.channelType && c.id === selected?.channelId) ?? null;

  return (
    <>
      <button
        type="button"
        className="chat-drawer-launcher"
        onClick={() => drawer.openTo()}
        aria-label="Open league chat"
      >
        <MessageCircle size={22} />
        {totalUnread > 0 && <span className="chat-drawer-launcher-badge">{totalUnread > 99 ? "99+" : totalUnread}</span>}
      </button>

      {drawer.open &&
        createPortal(
          <div className="chat-drawer-overlay" role="dialog" aria-label="League chat" onClick={drawer.close}>
            <div className="chat-drawer-panel" onClick={(event) => event.stopPropagation()}>
              <div className="chat-drawer-header">
                <strong>{selectedChannel?.label ?? "Chat"}</strong>
                <button type="button" className="chat-drawer-close" onClick={drawer.close} aria-label="Close chat">
                  <X size={18} />
                </button>
              </div>
              <div className="chat-drawer-body">
                <ChannelList channels={channels} selectedChannelId={selected?.channelId ?? null} onSelect={(c) => { setSelected({ channelType: c.type, channelId: c.id }); setReplyTarget(null); }} />
                <div className="chat-drawer-conversation">
                  <ConversationView
                    messages={messages}
                    viewerDiscordId={discordId}
                    mentionable={mentionable}
                    reactionsByMessage={reactionsByMessage}
                    attachmentsByMessage={attachmentsByMessage}
                    onToggleReaction={(messageId, emojiKey) => void toggleReaction(messageId, emojiKey)}
                    onEditMessage={editMessage}
                    onDeleteMessage={(messageId) => void deleteMessage(messageId)}
                    onReplyMessage={setReplyTarget}
                  />
                  <Composer
                    onSend={async (body) => {
                      const row = await sendMessage(body, replyTarget?.id ?? null);
                      setReplyTarget(null);
                      return row ? { id: row.id } : undefined;
                    }}
                    sending={sending}
                    mentionOptions={mentionOptions}
                    guildId={guildId}
                    channelType={selected?.channelType}
                    replyTo={replyTarget ? { preview: `${replyTarget.authorDisplayName ?? "REC Member"}: ${replyTarget.body}` } : null}
                    onCancelReply={() => setReplyTarget(null)}
                  />
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

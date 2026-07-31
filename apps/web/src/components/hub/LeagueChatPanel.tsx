import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { useSharedChatChannel } from "../../lib/chat-store.js";
import type { GameChatChannel, HubMatchupDetail, LeagueChatMember, MentionableList } from "../../types/api.js";
import { Button } from "../ui/Button.js";
import { UploadBoxScoreModal } from "../../routes/league-mgmt/manage-league/UploadBoxScoreModal.js";
import { MatchupActions, canViewerUploadBoxScore } from "../../routes/matchups/MatchupDetail.js";
import { ShareStreamModal } from "./ShareStreamModal.js";
import { PlayerStatsModal } from "./PlayerStatsModal.js";
import { HighlightUploadModal } from "./HighlightUploadModal.js";
import { ConversationView } from "../chat/ConversationView.js";
import { Composer } from "../chat/Composer.js";
import type { ChatMessageRow } from "@rec/shared";

const ROSTER_POLL_INTERVAL_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

const DC_TOOLTIP = "Non-registered Discord-only member — messages forward to the Discord game channel.";

// The Chat tab on Campus Buzz: a league-wide room plus one channel per current-week H2H
// matchup (bridged to that matchup's Discord game channel — see game-chat.service.ts). Message
// state comes from the shared chat store (chat-store.ts) — the same channel opened here and in
// the Universal Chat Drawer share one poll/realtime cycle and one message array, not two.
export function LeagueChatPanel({
  guildId,
  leagueId,
  discordId,
  seasonNumber,
  initialGameChannelId,
}: {
  guildId: string;
  leagueId: string;
  discordId: string;
  seasonNumber: number;
  initialGameChannelId?: string | null;
}) {
  const [channels, setChannels] = useState<GameChatChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string>(initialGameChannelId || "league");
  const [members, setMembers] = useState<LeagueChatMember[]>([]);
  const [rosterOpen, setRosterOpen] = useState(true);

  const [matchupDetail, setMatchupDetail] = useState<HubMatchupDetail | null>(null);
  const [boxScoreUploadOpen, setBoxScoreUploadOpen] = useState(false);
  const [playerStatsOpen, setPlayerStatsOpen] = useState(false);
  const [highlightUploadOpen, setHighlightUploadOpen] = useState(false);
  const [shareStreamOpen, setShareStreamOpen] = useState(false);

  const activeGameId = activeChannel === "league" ? null : channels.find((c) => c.gameChannelId === activeChannel)?.gameId ?? null;

  useEffect(() => {
    if (!activeGameId) {
      setMatchupDetail(null);
      return;
    }
    let active = true;
    recApi.getHubMatchupDetail({ guildId, gameId: activeGameId }).then((detail) => {
      if (active) setMatchupDetail(detail);
    }).catch(() => {
      if (active) setMatchupDetail(null);
    });
    return () => { active = false; };
  }, [guildId, activeGameId]);

  useEffect(() => {
    if (initialGameChannelId) setActiveChannel(initialGameChannelId);
  }, [initialGameChannelId]);

  useEffect(() => {
    recApi.listGameChatChannels(guildId).then((res) => setChannels(res.channels)).catch(() => setChannels([]));
  }, [guildId]);

  useEffect(() => {
    function loadMembers() {
      recApi.listLeagueMembersForChat(guildId).then((res) => setMembers(res.members)).catch(() => undefined);
    }
    loadMembers();
    const interval = setInterval(loadMembers, ROSTER_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [guildId]);

  useEffect(() => {
    void recApi.sendLeagueChatHeartbeat(guildId).catch(() => undefined);
    const interval = setInterval(() => {
      void recApi.sendLeagueChatHeartbeat(guildId).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [guildId]);

  const channelType = activeChannel === "league" ? "league" : "game";
  const channelId = activeChannel === "league" ? leagueId : activeChannel;
  const { messages, reactionsByMessage, attachmentsByMessage, sendMessage, editMessage, deleteMessage, toggleReaction, sending, error: chatError } = useSharedChatChannel({
    guildId,
    channelType,
    channelId,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? chatError;

  const mentionable: MentionableList = useMemo(() => ({
    members: members.filter((m) => m.discordId).map((m) => ({ discordId: m.discordId as string, displayName: m.displayName })),
    roles: [],
  }), [members]);

  const mentionOptions = useMemo(
    () => mentionable.members.map((m) => ({ token: `<@${m.discordId}>`, label: m.displayName })),
    [mentionable],
  );

  const [replyTarget, setReplyTarget] = useState<ChatMessageRow | null>(null);

  async function handleSend(body: string) {
    setActionError(null);
    try {
      const replyToMessageId = replyTarget?.id ?? null;
      const row = await sendMessage(body, replyToMessageId);
      setReplyTarget(null);
      return row ? { id: row.id } : undefined;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send message.");
      throw err;
    }
  }

  async function handleEdit(messageId: string, body: string) {
    await editMessage(messageId, body);
  }

  async function handleDelete(messageId: string) {
    await deleteMessage(messageId);
  }

  const onlineMembers = members.filter((m) => m.online);
  const offlineMembers = members.filter((m) => !m.online);

  return (
    <div className="hub-league-chat">
      <div className="hub-league-chat-channels">
        <Button variant={activeChannel === "league" ? "primary" : "secondary"} size="compact" onClick={() => { setActiveChannel("league"); setReplyTarget(null); }}>
          League
        </Button>
        {channels.map((channel) => (
          <Button
            key={channel.gameChannelId}
            variant={activeChannel === channel.gameChannelId ? "primary" : "secondary"}
            size="compact"
            onClick={() => { setActiveChannel(channel.gameChannelId); setReplyTarget(null); }}
          >
            {channel.label}
          </Button>
        ))}
      </div>

      <div className="hub-league-chat-roster">
        <button type="button" className="hub-league-chat-roster-toggle" onClick={() => setRosterOpen((open) => !open)}>
          {rosterOpen ? "Hide roster" : "Show roster"} · {onlineMembers.length} online
        </button>
        {rosterOpen && (
          <div className="hub-league-chat-roster-body">
            <div>
              <strong>Online ({onlineMembers.length})</strong>
              <ul>
                {onlineMembers.map((m) => (
                  <li key={m.userId}>
                    {m.displayName}
                    {m.isDiscordOnly && <span className="hub-dc-tag" title={DC_TOOLTIP}>DC</span>}
                  </li>
                ))}
                {onlineMembers.length === 0 && <li className="hub-muted">No one online right now.</li>}
              </ul>
            </div>
            <div>
              <strong>Offline ({offlineMembers.length})</strong>
              <ul>
                {offlineMembers.map((m) => (
                  <li key={m.userId}>
                    {m.displayName}
                    {m.isDiscordOnly && <span className="hub-dc-tag" title={DC_TOOLTIP}>DC</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {matchupDetail && (
        <MatchupActions
          matchup={matchupDetail.matchup}
          canUploadBoxScore={canViewerUploadBoxScore(matchupDetail.matchup)}
          onOpenBoxScore={() => setBoxScoreUploadOpen(true)}
          onOpenPlayerStats={() => setPlayerStatsOpen(true)}
          onOpenWager={() => undefined}
          onOpenShareStream={() => setShareStreamOpen(true)}
          onUploadHighlight={() => setHighlightUploadOpen(true)}
          highlightUploading={false}
        />
      )}

      {error && <p className="hub-transfer-status">{error}</p>}

      <div className="commissioner-chat-window">
        <ConversationView
          messages={messages}
          viewerDiscordId={discordId}
          mentionable={mentionable}
          reactionsByMessage={reactionsByMessage}
          attachmentsByMessage={attachmentsByMessage}
          onToggleReaction={(messageId, emojiKey) => void toggleReaction(messageId, emojiKey)}
          messageClassName={(m) => (m.source === "system" ? "hub-league-chat-message hub-league-chat-system" : "hub-league-chat-message")}
          onEditMessage={handleEdit}
          onDeleteMessage={(messageId) => void handleDelete(messageId)}
          onReplyMessage={setReplyTarget}
        />
        <Composer
          onSend={handleSend}
          sending={sending}
          mentionOptions={mentionOptions}
          guildId={guildId}
          channelType={activeChannel === "league" ? "league" : "game"}
          replyTo={replyTarget ? { preview: `${replyTarget.authorDisplayName ?? "REC Member"}: ${replyTarget.body}` } : null}
          onCancelReply={() => setReplyTarget(null)}
        />
      </div>

      {boxScoreUploadOpen && matchupDetail && (
        <UploadBoxScoreModal
          guildId={guildId}
          discordId={discordId}
          weekNumber={matchupDetail.matchup.weekNumber}
          seasonNumber={seasonNumber}
          gameId={matchupDetail.matchup.gameId}
          commissionerSubmission={false}
          requireSecondImage
          onClose={() => setBoxScoreUploadOpen(false)}
          onSubmitted={() => {
            setBoxScoreUploadOpen(false);
            // The opponent-tag notice lands server-side (createBoxScoreSubmission) — the shared
            // chat store's next poll tick picks it up like any other message.
          }}
        />
      )}

      {playerStatsOpen && (
        <PlayerStatsModal guildId={guildId} onClose={() => setPlayerStatsOpen(false)} onSubmitted={() => setPlayerStatsOpen(false)} />
      )}

      {highlightUploadOpen && activeGameId && (
        <HighlightUploadModal
          guildId={guildId}
          gameId={activeGameId}
          onClose={() => setHighlightUploadOpen(false)}
          onSubmitted={() => setHighlightUploadOpen(false)}
        />
      )}

      {shareStreamOpen && activeGameId && (
        <ShareStreamModal
          guildId={guildId}
          gameId={activeGameId}
          onClose={() => setShareStreamOpen(false)}
          onSubmitted={() => setShareStreamOpen(false)}
        />
      )}
    </div>
  );
}

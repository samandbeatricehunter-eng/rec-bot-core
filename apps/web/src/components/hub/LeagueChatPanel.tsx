import { useEffect, useMemo, useRef, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { toChatMessageRow } from "../../lib/chat-utils.js";
import type { GameChatChannel, GameChatMessage, HubMatchupDetail, LeagueChatMember, LeagueChatMessage, MentionableList } from "../../types/api.js";
import { Button } from "../ui/Button.js";
import { UploadBoxScoreModal } from "../../routes/league-mgmt/manage-league/UploadBoxScoreModal.js";
import { MatchupActions, canViewerUploadBoxScore } from "../../routes/matchups/MatchupDetail.js";
import { ShareStreamModal } from "./ShareStreamModal.js";
import { PlayerStatsModal } from "./PlayerStatsModal.js";
import { HighlightUploadModal } from "./HighlightUploadModal.js";
import { ConversationView } from "../chat/ConversationView.js";
import { Composer } from "../chat/Composer.js";

const POLL_INTERVAL_MS = 5000;
const ROSTER_POLL_INTERVAL_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

const DC_TOOLTIP = "Non-registered Discord-only member — messages forward to the Discord game channel.";

// The Chat tab on Campus Buzz: a league-wide room plus one channel per current-week H2H
// matchup (bridged to that matchup's Discord game channel — see game-chat.service.ts).
// Poll-based like every other chat feature in this codebase (commissioner chat, matchup
// chat) — no realtime infra.
export function LeagueChatPanel({
  guildId,
  discordId,
  seasonNumber,
  initialGameChannelId,
}: {
  guildId: string;
  discordId: string;
  seasonNumber: number;
  initialGameChannelId?: string | null;
}) {
  const [channels, setChannels] = useState<GameChatChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string>(initialGameChannelId || "league");
  const [messages, setMessages] = useState<Array<LeagueChatMessage | GameChatMessage>>([]);
  const [members, setMembers] = useState<LeagueChatMember[]>([]);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollInFlightRef = useRef(false);

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

  function pollMessages() {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    const request = activeChannel === "league"
      ? recApi.listLeagueChatMessages({ guildId })
      : recApi.listGameChatMessages({ guildId, gameChannelId: activeChannel });
    request
      .then((res) => setMessages(res.messages))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load chat."))
      .finally(() => { pollInFlightRef.current = false; });
  }

  useEffect(() => {
    setMessages([]);
    setError(null);
    pollMessages();
    const interval = setInterval(pollMessages, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, activeChannel]);

  const mentionable: MentionableList = useMemo(() => ({
    members: members.filter((m) => m.discordId).map((m) => ({ discordId: m.discordId as string, displayName: m.displayName })),
    roles: [],
  }), [members]);

  const mentionOptions = useMemo(
    () => mentionable.members.map((m) => ({ token: `<@${m.discordId}>`, label: m.displayName })),
    [mentionable],
  );

  const conversationMessages = useMemo(() => messages.map((m) => toChatMessageRow(m as unknown as Record<string, unknown>)), [messages]);

  async function handleSend(body: string) {
    setSending(true);
    setError(null);
    try {
      const res = activeChannel === "league"
        ? await recApi.postLeagueChatMessage({ guildId, body })
        : await recApi.postGameChatMessage({ guildId, gameChannelId: activeChannel, body });
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      pollMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
      throw err;
    } finally {
      setSending(false);
    }
  }

  async function handleEdit(messageId: string, body: string) {
    const res = activeChannel === "league"
      ? await recApi.editLeagueChatMessage({ guildId, messageId, body })
      : await recApi.editGameChatMessage({ guildId, messageId, body });
    setMessages((prev) => prev.map((m) => (m.id === res.message.id ? res.message : m)));
  }

  async function handleDelete(messageId: string) {
    if (activeChannel === "league") await recApi.deleteLeagueChatMessage({ guildId, messageId });
    else await recApi.deleteGameChatMessage({ guildId, messageId });
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }

  const onlineMembers = members.filter((m) => m.online);
  const offlineMembers = members.filter((m) => !m.online);

  return (
    <div className="hub-league-chat">
      <div className="hub-league-chat-channels">
        <Button variant={activeChannel === "league" ? "primary" : "secondary"} size="compact" onClick={() => setActiveChannel("league")}>
          League
        </Button>
        {channels.map((channel) => (
          <Button
            key={channel.gameChannelId}
            variant={activeChannel === channel.gameChannelId ? "primary" : "secondary"}
            size="compact"
            onClick={() => setActiveChannel(channel.gameChannelId)}
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
          messages={conversationMessages}
          viewerDiscordId={discordId}
          mentionable={mentionable}
          guildId={guildId}
          channelType={activeChannel === "league" ? "league" : "game"}
          messageClassName={(m) => (m.source === "system" ? "hub-league-chat-message hub-league-chat-system" : "hub-league-chat-message")}
          onEditMessage={handleEdit}
          onDeleteMessage={(messageId) => void handleDelete(messageId)}
        />
        <Composer onSend={handleSend} sending={sending} mentionOptions={mentionOptions} />
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
            // The opponent-tag notice lands server-side (createBoxScoreSubmission) — the next
            // poll picks it up like any other message, no special handling needed here.
            pollMessages();
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

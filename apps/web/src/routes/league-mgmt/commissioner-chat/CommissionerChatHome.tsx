import { useEffect, useMemo, useRef, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { toChatMessageRow } from "../../../lib/chat-utils.js";
import type { ChatMessage, ChatTopic, MentionableList } from "../../../types/api.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Badge } from "../../../components/ui/Badge.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { PollComposerModal } from "./PollComposerModal.js";
import { PendingItemsPanel } from "../notifications/PendingItemsPanel.js";
import { useSearchParams } from "react-router-dom";
import { ConversationView } from "../../../components/chat/ConversationView.js";
import { Composer } from "../../../components/chat/Composer.js";

const POLL_INTERVAL_MS = 5000;

// A shared space for commissioners/co-commissioners to discuss and vote on topics — meant
// to eventually replace the need for the Commissioner's Office Discord channel for this
// purpose. Simple poll-every-5s read model, no WebSockets — the audience per league is a
// handful of people, so real-time infrastructure isn't worth the complexity here.
//
// Embedded directly at the top of LeagueMgmtHome.tsx (an always-visible panel, not a tile
// you click into) — no PageHeader here, just a compact heading, since it now shares the
// page with the tile grid below it instead of owning the whole screen. Polls live in their
// own tab (not merged into the message feed) so they don't get buried by chat volume.
export function CommissionerChatHome() {
  const { guildId, discordId } = useReadyAuth();
  const [params] = useSearchParams();
  const requestedTab = params.get("officeTab");
  const [tab, setTab] = useState<"messages" | "polls" | "payouts" | "requests">(
    requestedTab === "payouts" || requestedTab === "requests" ? requestedTab : "messages",
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollInFlightRef = useRef(false);

  const [topics, setTopics] = useState<ChatTopic[] | null>(null);
  const [showPollComposer, setShowPollComposer] = useState(false);

  const [mentionable, setMentionable] = useState<MentionableList | null>(null);

  function pollMessages() {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    recApi
      .listChatMessages({ guildId })
      .then((res) => {
        if (!res.messages.length) {
          setMessages([]);
          return;
        }
        setMessages(res.messages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load chat."))
      .finally(() => { pollInFlightRef.current = false; });
  }

  useEffect(() => {
    pollMessages();
    const interval = setInterval(pollMessages, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  useEffect(() => {
    recApi.getMentionableCommissioners(guildId).then(setMentionable).catch(() => setMentionable(null));
  }, [guildId]);

  function loadTopics() {
    recApi
      .listChatTopics(guildId)
      .then((res) => setTopics(res.topics))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load voting topics."));
  }

  useEffect(loadTopics, [guildId]);

  async function handleSend(body: string) {
    setSending(true);
    setError(null);
    try {
      const res = await recApi.postChatMessage({ guildId, body });
      setMessages((prev) => prev.some((message) => message.id === res.message.id) ? prev : [...prev, res.message]);
      pollMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
      throw err;
    } finally {
      setSending(false);
    }
  }

  async function handleEditMessage(messageId: string, body: string) {
    const res = await recApi.editChatMessage({ guildId, messageId, body });
    setMessages((prev) => prev.map((m) => (m.id === res.message.id ? res.message : m)));
  }

  async function handleDeleteMessage(messageId: string) {
    await recApi.deleteChatMessage({ guildId, messageId });
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }

  async function handleVote(topicId: string, optionIndex: number) {
    setError(null);
    try {
      await recApi.voteOnChatTopic({ guildId, topicId, optionIndex });
      loadTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record your vote.");
    }
  }

  async function handleClose(topicId: string) {
    setError(null);
    try {
      await recApi.closeChatTopic({ guildId, topicId });
      loadTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close voting.");
    }
  }

  const mentionOptions = useMemo(() => {
    const roleOptions = (mentionable?.roles ?? []).map((r) => ({ token: `<@&${r.roleId}>`, label: r.name }));
    const memberOptions = (mentionable?.members ?? []).map((m) => ({ token: `<@${m.discordId}>`, label: m.displayName }));
    return [...roleOptions, ...memberOptions];
  }, [mentionable]);

  const conversationMessages = useMemo(() => messages.map((m) => toChatMessageRow(m as unknown as Record<string, unknown>)), [messages]);

  return (
    <Card className="commissioner-chat-card">
      <h2 style={{ margin: "0 0 var(--space-1)" }}>Commissioner's Office</h2>
      <p style={{ margin: "0 0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        Discuss and vote on topics with your commissioners and co-commissioners.
      </p>
      {error && <ErrorState message={error} />}

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        <Button variant={tab === "messages" ? "primary" : "secondary"} onClick={() => setTab("messages")}>Messages</Button>
        <Button variant={tab === "polls" ? "primary" : "secondary"} onClick={() => setTab("polls")}>
          Polls {topics && topics.filter((t) => t.status === "open").length > 0 ? `(${topics.filter((t) => t.status === "open").length})` : ""}
        </Button>
        <Button variant={tab === "payouts" ? "primary" : "secondary"} onClick={() => setTab("payouts")}>Payouts</Button>
        <Button variant={tab === "requests" ? "primary" : "secondary"} onClick={() => setTab("requests")}>Team Requests</Button>
      </div>

      {tab === "messages" && (
        <div className="commissioner-chat-window">
          <ConversationView
            messages={conversationMessages}
            viewerDiscordId={discordId}
            mentionable={mentionable}
            guildId={guildId}
            channelType="commissioner"
            onEditMessage={handleEditMessage}
            onDeleteMessage={(messageId) => void handleDeleteMessage(messageId)}
          />
          <Composer onSend={handleSend} sending={sending} mentionOptions={mentionOptions} placeholder="Message… (@ to mention a commissioner)" />
        </div>
      )}

      {tab === "polls" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--space-3)" }}>
            <Button variant="secondary" onClick={() => setShowPollComposer(true)}>New Poll</Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxHeight: 420, overflowY: "auto" }}>
            {topics?.map((t) => {
              const myVote = t.voters.find((v) => v.voterDiscordId === discordId)?.optionIndex;
              return (
                <div key={t.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <strong>{t.title}</strong>
                    <Badge status={t.status === "open" ? "pending" : "locked"}>{t.status}</Badge>
                  </div>
                  {t.description && <p style={{ margin: "var(--space-1) 0", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{t.description}</p>}
                  {t.closes_at && t.status === "open" && (
                    <p style={{ margin: "var(--space-1) 0", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                      Closes {new Date(t.closes_at).toLocaleString()}
                    </p>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", marginTop: "var(--space-2)" }}>
                    {t.options.map((opt, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        <Button
                          variant={myVote === i ? "primary" : "secondary"}
                          onClick={() => handleVote(t.id, i)}
                          disabled={t.status !== "open"}
                        >
                          {opt}
                        </Button>
                        <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{t.tally[i] ?? 0} vote{(t.tally[i] ?? 0) === 1 ? "" : "s"}</span>
                      </div>
                    ))}
                  </div>
                  {t.status === "open" && (
                    <Button variant="ghost" onClick={() => handleClose(t.id)} style={{ marginTop: "var(--space-2)" }}>
                      Close Voting
                    </Button>
                  )}
                </div>
              );
            })}
            {topics && topics.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No polls yet.</p>}
          </div>
        </div>
      )}

      {tab === "payouts" && <PendingItemsPanel />}
      {tab === "requests" && <PendingItemsPanel initialFilter="team_request" />}

      {showPollComposer && (
        <PollComposerModal
          guildId={guildId}
          onClose={() => setShowPollComposer(false)}
          onCreated={() => { setShowPollComposer(false); loadTopics(); }}
        />
      )}
    </Card>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { ChatMessageRow } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { useSharedChatChannel } from "../../../lib/chat-store.js";
import type { ChatTopic, MentionableList } from "../../../types/api.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Badge } from "../../../components/ui/Badge.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { PollComposerModal } from "./PollComposerModal.js";
import { PendingItemsPanel } from "../notifications/PendingItemsPanel.js";
import { useSearchParams } from "react-router-dom";
import { ConversationView } from "../../../components/chat/ConversationView.js";
import { Composer } from "../../../components/chat/Composer.js";

// A shared space for commissioners/co-commissioners to discuss and vote on topics — meant
// to eventually replace the need for the Commissioner's Office Discord channel for this
// purpose. Message state comes from the shared chat store (chat-store.ts), keyed by guildId
// the same way the Universal Chat Drawer's commissioner channel is — so opening this page and
// the drawer's Commissioner Chat at the same time is one poll/realtime cycle, not two.
//
// Two presentations of this same component:
  //   - Standalone Messages/Polls (legacy; the hub route now redirects to Notifications).
  //   - `embedded`: Polls only. Commissioner chat itself lives in the Universal Chat Drawer.
  // Payouts and Team Requests have moved to the Awaiting Review panel (CommandCenterDashboard).
export function CommissionerChatHome({ embedded = false }: { embedded?: boolean } = {}) {
  const { guildId, discordId } = useReadyAuth();
  const [params] = useSearchParams();
  const requestedTab = params.get("officeTab");
  const [tab, setTab] = useState<"messages" | "polls" | "payouts" | "requests">(
    embedded ? "polls" : requestedTab === "payouts" || requestedTab === "requests" ? requestedTab : "messages",
  );
  const { messages, reactionsByMessage, attachmentsByMessage, sendMessage, editMessage, deleteMessage, toggleReaction, sending, error: chatError } = useSharedChatChannel({
    guildId,
    channelType: "commissioner",
    channelId: guildId,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? chatError;

  const [topics, setTopics] = useState<ChatTopic[] | null>(null);
  const [showPollComposer, setShowPollComposer] = useState(false);

  const [mentionable, setMentionable] = useState<MentionableList | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessageRow | null>(null);

  useEffect(() => {
    recApi.getMentionableCommissioners(guildId).then(setMentionable).catch(() => setMentionable(null));
  }, [guildId]);

  function loadTopics() {
    recApi
      .listChatTopics(guildId)
      .then((res) => setTopics(res.topics))
      .catch((err) => setActionError(err instanceof Error ? err.message : "Failed to load voting topics."));
  }

  useEffect(loadTopics, [guildId]);

  async function handleSend(body: string) {
    setActionError(null);
    try {
      const row = await sendMessage(body, replyTarget?.id ?? null);
      setReplyTarget(null);
      return row ? { id: row.id } : undefined;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send message.");
      throw err;
    }
  }

  async function handleEditMessage(messageId: string, body: string) {
    await editMessage(messageId, body);
  }

  async function handleDeleteMessage(messageId: string) {
    await deleteMessage(messageId);
  }

  async function handleVote(topicId: string, optionIndex: number) {
    setActionError(null);
    try {
      await recApi.voteOnChatTopic({ guildId, topicId, optionIndex });
      loadTopics();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to record your vote.");
    }
  }

  async function handleClose(topicId: string) {
    setActionError(null);
    try {
      await recApi.closeChatTopic({ guildId, topicId });
      loadTopics();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to close voting.");
    }
  }

  const mentionOptions = useMemo(() => {
    const roleOptions = (mentionable?.roles ?? []).map((r) => ({ token: `<@&${r.roleId}>`, label: r.name }));
    const memberOptions = (mentionable?.members ?? []).map((m) => ({ token: `<@${m.discordId}>`, label: m.displayName }));
    return [...roleOptions, ...memberOptions];
  }, [mentionable]);

  return (
    <Card className="commissioner-chat-card">
      <h2 style={{ margin: "0 0 var(--space-1)" }}>{embedded ? "Decisions and Polls" : "Commissioner's Office"}</h2>
      <p style={{ margin: "0 0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        {embedded
          ? "Vote on topics with your commissioners and co-commissioners."
          : "Discuss and vote on topics with your commissioners and co-commissioners."}
      </p>
      {error && <ErrorState message={error} />}

      {!embedded && (
        <div className="commissioner-chat-tabs">
          <Button variant={tab === "messages" ? "primary" : "secondary"} onClick={() => setTab("messages")}>Messages</Button>
          <Button variant={tab === "polls" ? "primary" : "secondary"} onClick={() => setTab("polls")}>
            Polls {topics && topics.filter((t) => t.status === "open").length > 0 ? `(${topics.filter((t) => t.status === "open").length})` : ""}
          </Button>
        </div>
      )}

      {!embedded && tab === "messages" && (
        <div className="commissioner-chat-window">
          <ConversationView
            messages={messages}
            viewerDiscordId={discordId}
            mentionable={mentionable}
            reactionsByMessage={reactionsByMessage}
            attachmentsByMessage={attachmentsByMessage}
            onToggleReaction={(messageId, emojiKey) => void toggleReaction(messageId, emojiKey)}
            onEditMessage={handleEditMessage}
            onDeleteMessage={(messageId) => void handleDeleteMessage(messageId)}
            onReplyMessage={setReplyTarget}
          />
          <Composer
            onSend={handleSend}
            sending={sending}
            mentionOptions={mentionOptions}
            guildId={guildId}
            channelType="commissioner"
            placeholder="Message… (@ to mention a commissioner)"
            replyTo={replyTarget ? { preview: `${replyTarget.authorDisplayName ?? "REC Member"}: ${replyTarget.body}` } : null}
            onCancelReply={() => setReplyTarget(null)}
          />
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

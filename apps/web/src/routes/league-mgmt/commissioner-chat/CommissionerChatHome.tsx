import { useEffect, useRef, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ChatMessage, ChatTopic } from "../../../types/api.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Badge } from "../../../components/ui/Badge.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const POLL_INTERVAL_MS = 5000;

// A shared space for commissioners/co-commissioners to discuss and vote on topics — meant
// to eventually replace the need for the Commissioner's Office Discord channel for this
// purpose. Simple poll-every-5s read model, no WebSockets — the audience per league is a
// handful of people, so real-time infrastructure isn't worth the complexity here.
//
// Embedded directly at the top of LeagueMgmtHome.tsx (an always-visible panel, not a tile
// you click into) — no PageHeader here, just a compact heading, since it now shares the
// page with the tile grid below it instead of owning the whole screen.
export function CommissionerChatHome() {
  const { guildId, discordId } = useReadyAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watermarkRef = useRef<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const [topics, setTopics] = useState<ChatTopic[] | null>(null);
  const [showNewTopic, setShowNewTopic] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newOptions, setNewOptions] = useState(["", ""]);
  const [creatingTopic, setCreatingTopic] = useState(false);

  function pollMessages() {
    recApi
      .listChatMessages({ guildId, sinceIso: watermarkRef.current })
      .then((res) => {
        if (!res.messages.length) return;
        watermarkRef.current = res.messages[res.messages.length - 1].created_at;
        setMessages((prev) => {
          // De-dupe by id — two overlapping polls (e.g. a slow response still in flight
          // when the next 5s tick fires) can otherwise both append the same message.
          const seen = new Set(prev.map((m) => m.id));
          const fresh = res.messages.filter((m) => !seen.has(m.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load chat."));
  }

  useEffect(() => {
    pollMessages();
    const interval = setInterval(pollMessages, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages]);

  function loadTopics() {
    recApi
      .listChatTopics(guildId)
      .then((res) => setTopics(res.topics))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load voting topics."));
  }

  useEffect(loadTopics, [guildId]);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const res = await recApi.postChatMessage({ guildId, body });
      watermarkRef.current = res.message.created_at;
      setMessages((prev) => [...prev, res.message]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
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

  async function handleCreateTopic() {
    const options = newOptions.map((o) => o.trim()).filter(Boolean);
    if (!newTitle.trim() || options.length < 2) return;
    setCreatingTopic(true);
    setError(null);
    try {
      await recApi.createChatTopic({ guildId, title: newTitle.trim(), description: newDescription.trim() || null, options });
      setNewTitle("");
      setNewDescription("");
      setNewOptions(["", ""]);
      setShowNewTopic(false);
      loadTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the topic.");
    } finally {
      setCreatingTopic(false);
    }
  }

  return (
    <div style={{ marginBottom: "var(--space-6)" }}>
      <h2 style={{ margin: "0 0 var(--space-1)" }}>Commissioner's Office</h2>
      <p style={{ margin: "0 0 var(--space-4)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        Discuss and vote on topics with your commissioners and co-commissioners.
      </p>
      {error && <ErrorState message={error} />}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "var(--space-4)" }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>Chat</h2>
          <div ref={feedRef} style={{ height: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            {messages.map((m) => (
              <div key={m.id}>
                <span style={{ color: m.author_discord_id === discordId ? "var(--gold)" : "var(--text-secondary)", fontWeight: 700, fontSize: "var(--text-xs)" }}>
                  {m.author_display_name ?? `<@${m.author_discord_id}>`}
                </span>{" "}
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{new Date(m.created_at).toLocaleTimeString()}</span>
                <p style={{ margin: "2px 0 0" }}>{m.body}</p>
              </div>
            ))}
            {messages.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No messages yet — say hello.</p>}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <input
              className="form-input"
              placeholder="Message…"
              value={draft}
              disabled={sending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
            <Button variant="primary" onClick={handleSend} disabled={sending || !draft.trim()}>Send</Button>
          </div>
        </Card>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
            <h2 style={{ margin: 0 }}>Voting Topics</h2>
            <Button variant="secondary" onClick={() => setShowNewTopic((v) => !v)}>{showNewTopic ? "Cancel" : "New Topic"}</Button>
          </div>

          {showNewTopic && (
            <div style={{ marginBottom: "var(--space-4)", paddingBottom: "var(--space-4)", borderBottom: "1px solid var(--border)" }}>
              <div className="form-field">
                <label className="form-label" htmlFor="topic-title">Title</label>
                <input id="topic-title" className="form-input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="topic-desc">Description (optional)</label>
                <textarea id="topic-desc" className="form-input" rows={2} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label">Options</label>
                {newOptions.map((opt, i) => (
                  <input
                    key={i}
                    className="form-input"
                    style={{ marginBottom: "var(--space-2)" }}
                    placeholder={`Option ${i + 1}`}
                    value={opt}
                    onChange={(e) => setNewOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))}
                  />
                ))}
                <Button variant="secondary" onClick={() => setNewOptions((prev) => [...prev, ""])} disabled={newOptions.length >= 10}>
                  Add Option
                </Button>
              </div>
              <Button variant="primary" onClick={handleCreateTopic} disabled={creatingTopic}>
                {creatingTopic ? "Creating…" : "Create Topic"}
              </Button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {topics?.map((t) => {
              const myVote = t.voters.find((v) => v.voterDiscordId === discordId)?.optionIndex;
              return (
                <div key={t.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <strong>{t.title}</strong>
                    <Badge status={t.status === "open" ? "pending" : "locked"}>{t.status}</Badge>
                  </div>
                  {t.description && <p style={{ margin: "var(--space-1) 0", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{t.description}</p>}
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
            {topics && topics.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No voting topics yet.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

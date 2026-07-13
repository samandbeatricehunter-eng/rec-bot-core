import { useEffect, useMemo, useRef, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { renderMessageWithMentions } from "../../../lib/mentions.js";
import type { ChatMessage, ChatTopic, MentionableList } from "../../../types/api.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Badge } from "../../../components/ui/Badge.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { PollComposerModal } from "./PollComposerModal.js";

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
  const [tab, setTab] = useState<"messages" | "polls">("messages");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watermarkRef = useRef<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const [topics, setTopics] = useState<ChatTopic[] | null>(null);
  const [showPollComposer, setShowPollComposer] = useState(false);

  const [mentionable, setMentionable] = useState<MentionableList | null>(null);

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

  // @-mention autocomplete: trigger on the trailing "@word" at the end of the draft (simple
  // single-line-input approach — no cursor-position tracking needed since this is a plain
  // text input, not a rich editor).
  const mentionQuery = useMemo(() => {
    const match = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(draft);
    return match ? match[1] : null;
  }, [draft]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null || !mentionable) return [];
    const q = mentionQuery.toLowerCase();
    const roleOptions = mentionable.roles
      .filter((r) => r.name.toLowerCase().includes(q))
      .map((r) => ({ token: `<@&${r.roleId}>`, label: r.name }));
    const memberOptions = mentionable.members
      .filter((m) => m.displayName.toLowerCase().includes(q))
      .map((m) => ({ token: `<@${m.discordId}>`, label: m.displayName }));
    return [...roleOptions, ...memberOptions].slice(0, 8);
  }, [mentionQuery, mentionable]);

  function insertMention(token: string) {
    setDraft((prev) => prev.replace(/(?:^|\s)@[a-z0-9._-]*$/i, (m) => `${m[0] === "@" ? "" : m[0]}${token} `));
  }

  return (
    <Card>
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
      </div>

      {tab === "messages" && (
        <div>
          <div ref={feedRef} style={{ height: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            {messages.map((m) => (
              <div key={m.id}>
                <span style={{ color: m.author_discord_id === discordId ? "var(--gold)" : "var(--text-secondary)", fontWeight: 700, fontSize: "var(--text-xs)" }}>
                  {m.author_display_name ?? `<@${m.author_discord_id}>`}
                </span>{" "}
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{new Date(m.created_at).toLocaleTimeString()}</span>
                <p style={{ margin: "2px 0 0" }}>{renderMessageWithMentions(m.body, mentionable)}</p>
              </div>
            ))}
            {messages.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No messages yet — say hello.</p>}
          </div>
          <div style={{ position: "relative" }}>
            {mentionMatches.length > 0 && (
              <div className="card" style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: "var(--space-1)", padding: "var(--space-1)", maxHeight: 180, overflowY: "auto", zIndex: 20 }}>
                {mentionMatches.map((opt) => (
                  <button
                    key={opt.token}
                    className="btn btn-ghost"
                    style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                    onClick={() => insertMention(opt.token)}
                  >
                    @{opt.label}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <input
                className="form-input"
                placeholder="Message… (@ to mention a commissioner)"
                value={draft}
                disabled={sending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              />
              <Button variant="primary" onClick={handleSend} disabled={sending || !draft.trim()}>Send</Button>
            </div>
          </div>
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

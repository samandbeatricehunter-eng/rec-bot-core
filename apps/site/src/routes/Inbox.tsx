import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  siteApi,
  type DmTarget,
  type SiteConversation,
  type SiteMessage,
} from "../lib/site-api.js";

export function Inbox() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<SiteConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SiteMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [composeQuery, setComposeQuery] = useState("");
  const [targets, setTargets] = useState<DmTarget[]>([]);
  const [composeBusy, setComposeBusy] = useState(false);

  async function refreshConversations() {
    const response = await siteApi.listConversations();
    setConversations(response.conversations);
  }

  async function openThread(conversationId: string) {
    setActiveId(conversationId);
    setError(null);
    const response = await siteApi.listMessages({ conversationId, limit: 80 });
    setMessages(response.messages);
    await siteApi.markConversationRead(conversationId);
    await refreshConversations();
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    siteApi
      .listConversations()
      .then((response) => {
        if (!active) return;
        setConversations(response.conversations);
        if (response.conversations[0]) {
          void openThread(response.conversations[0].id);
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load inbox.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const timer = window.setInterval(() => {
      void siteApi
        .listMessages({ conversationId: activeId, limit: 80 })
        .then((response) => setMessages(response.messages))
        .catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [activeId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const query = composeQuery.trim();
      if (!query) {
        setTargets([]);
        return;
      }
      setComposeBusy(true);
      siteApi
        .searchDmTargets({ query, limit: 12 })
        .then((response) => {
          if (active) setTargets(response.targets);
        })
        .catch(() => {
          if (active) setTargets([]);
        })
        .finally(() => {
          if (active) setComposeBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [composeQuery]);

  async function startDm(target: DmTarget) {
    setError(null);
    try {
      const opened = await siteApi.openDm({ userId: target.userId });
      setComposeQuery("");
      setTargets([]);
      await refreshConversations();
      await openThread(opened.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open DM.");
    }
  }

  async function send() {
    if (!activeId || !draft.trim()) return;
    setSendBusy(true);
    setError(null);
    try {
      await siteApi.sendMessage(activeId, draft.trim());
      setDraft("");
      const response = await siteApi.listMessages({
        conversationId: activeId,
        limit: 80,
      });
      setMessages(response.messages);
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
    } finally {
      setSendBusy(false);
    }
  }

  const active = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="site-page-card site-inbox">
      <div className="site-inbox-header">
        <div>
          <h1>Inbox</h1>
          <p className="site-muted">
            Direct messages and commissioner threads.{" "}
            <Link to="/friends">Manage friends</Link>
          </p>
        </div>
      </div>

      {error && <p className="site-auth-error">{error}</p>}
      {loading ? (
        <p className="site-muted">Loading conversations…</p>
      ) : (
        <div className="site-inbox-layout">
          <aside className="site-inbox-list">
            <label className="site-field">
              <span>New DM</span>
              <input
                value={composeQuery}
                placeholder="Search eligible username…"
                onChange={(event) => setComposeQuery(event.target.value)}
              />
            </label>
            {composeBusy && <p className="site-muted">Searching…</p>}
            {targets.length > 0 && (
              <ul className="site-inbox-targets">
                {targets.map((target) => (
                  <li key={target.userId}>
                    <button
                      type="button"
                      className="site-inbox-list-item"
                      onClick={() => void startDm(target)}
                    >
                      @{target.username}
                      <span className="site-muted">{target.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="site-inbox-section-label">Conversations</div>
            {conversations.length === 0 ? (
              <p className="site-muted">No conversations yet.</p>
            ) : (
              <ul className="site-inbox-targets">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className={
                        conversation.id === activeId
                          ? "site-inbox-list-item is-active"
                          : "site-inbox-list-item"
                      }
                      onClick={() => void openThread(conversation.id)}
                    >
                      <strong>
                        {conversation.label}
                        {conversation.unread ? " ·" : ""}
                      </strong>
                      <span className="site-muted">
                        {conversation.lastMessagePreview ?? "No messages yet"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="site-inbox-thread">
            {!active ? (
              <p className="site-muted">Select a conversation or start a DM.</p>
            ) : (
              <>
                <h2>{active.label}</h2>
                <div className="site-inbox-messages">
                  {messages.length === 0 ? (
                    <p className="site-muted">No messages yet. Say hello.</p>
                  ) : (
                    messages.map((message) => (
                      <div key={message.id} className="site-inbox-message">
                        <div className="site-inbox-message-meta">
                          <strong>
                            {message.authorUsername
                              ? `@${message.authorUsername}`
                              : message.authorDisplayName ?? "Member"}
                          </strong>
                          <span className="site-muted">
                            {new Date(message.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p>{message.body}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="site-inbox-compose">
                  <label className="site-field">
                    <span>Message</span>
                    <input
                      value={draft}
                      placeholder="Write a message…"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                    />
                  </label>
                  <button
                    className="site-btn site-btn-primary"
                    disabled={sendBusy || !draft.trim()}
                    onClick={() => void send()}
                  >
                    {sendBusy ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

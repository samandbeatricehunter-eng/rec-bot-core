import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { siteApi, type SiteFriendship } from "../lib/site-api.js";

export function Friends() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<SiteFriendship[]>([]);
  const [pendingIncoming, setPendingIncoming] = useState<SiteFriendship[]>([]);
  const [pendingOutgoing, setPendingOutgoing] = useState<SiteFriendship[]>([]);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await siteApi.listFriends();
    setAccepted(response.accepted);
    setPendingIncoming(response.pendingIncoming);
    setPendingOutgoing(response.pendingOutgoing);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    siteApi
      .listFriends()
      .then((response) => {
        if (!active) return;
        setAccepted(response.accepted);
        setPendingIncoming(response.pendingIncoming);
        setPendingOutgoing(response.pendingOutgoing);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load friends.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function sendRequest() {
    const value = username.trim().replace(/^@/, "");
    if (!value) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await siteApi.requestFriend({ username: value });
      setUsername("");
      setNotice(
        result.autoAccepted
          ? `You are now friends with @${result.peer.username}.`
          : `Friend request sent to @${result.peer.username}.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request.");
    } finally {
      setBusy(false);
    }
  }

  async function respond(friendshipId: string, action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      await siteApi.respondFriend(friendshipId, action);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update request.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(friendshipId: string) {
    setBusy(true);
    setError(null);
    try {
      await siteApi.removeFriend({ friendshipId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove friend.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-page-card site-friends">
      <h1>Friends</h1>
      <p className="site-muted">
        Accepted friends can DM even without a shared active league.{" "}
        <Link to="/inbox">Open inbox</Link>
      </p>

      {error && <p className="site-auth-error">{error}</p>}
      {notice && <p className="site-auth-success">{notice}</p>}

      <label className="site-field">
        <span>Add by username</span>
        <input
          value={username}
          placeholder="ex: rec.coach21"
          onChange={(event) => setUsername(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void sendRequest();
            }
          }}
        />
      </label>
      <button
        className="site-btn site-btn-primary"
        disabled={busy || !username.trim()}
        onClick={() => void sendRequest()}
      >
        {busy ? "Working…" : "Send friend request"}
      </button>

      {loading ? (
        <p className="site-muted">Loading…</p>
      ) : (
        <>
          <section className="site-friends-section">
            <h2>Incoming requests</h2>
            {pendingIncoming.length === 0 ? (
              <p className="site-muted">No incoming requests.</p>
            ) : (
              <ul className="site-friends-list">
                {pendingIncoming.map((item) => (
                  <li key={item.friendshipId}>
                    <div>
                      <strong>@{item.peer.username}</strong>
                      <span className="site-muted"> · {item.peer.displayName}</span>
                    </div>
                    <div className="site-friends-actions">
                      <button
                        className="site-btn site-btn-primary"
                        disabled={busy}
                        onClick={() => void respond(item.friendshipId, "accept")}
                      >
                        Accept
                      </button>
                      <button
                        className="site-btn site-btn-ghost"
                        disabled={busy}
                        onClick={() => void respond(item.friendshipId, "decline")}
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="site-friends-section">
            <h2>Outgoing requests</h2>
            {pendingOutgoing.length === 0 ? (
              <p className="site-muted">No outgoing requests.</p>
            ) : (
              <ul className="site-friends-list">
                {pendingOutgoing.map((item) => (
                  <li key={item.friendshipId}>
                    <div>
                      <strong>@{item.peer.username}</strong>
                      <span className="site-muted"> · pending</span>
                    </div>
                    <button
                      className="site-btn site-btn-ghost"
                      disabled={busy}
                      onClick={() => void remove(item.friendshipId)}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="site-friends-section">
            <h2>Friends</h2>
            {accepted.length === 0 ? (
              <p className="site-muted">No friends yet.</p>
            ) : (
              <ul className="site-friends-list">
                {accepted.map((item) => (
                  <li key={item.friendshipId}>
                    <div>
                      <strong>@{item.peer.username}</strong>
                      <span className="site-muted"> · {item.peer.displayName}</span>
                    </div>
                    <button
                      className="site-btn site-btn-ghost"
                      disabled={busy}
                      onClick={() => void remove(item.friendshipId)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

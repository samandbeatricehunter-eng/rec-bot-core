import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import { siteApi } from "../lib/site-api.js";

function PlaceholderCard({
  title,
  body,
  links,
  children,
}: {
  title: string;
  body: string;
  links?: Array<{ to: string; label: string }>;
  children?: React.ReactNode;
}) {
  return (
    <div className="site-page-card">
      <h1>{title}</h1>
      <p>{body}</p>
      {links?.length ? (
        <div className="site-league-demo-links">
          {links.map((link) => (
            <Link key={link.to} className="site-btn site-btn-ghost" to={link.to}>
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function HomePage() {
  return (
    <PlaceholderCard
      title="Home"
      body="Main hub home. League feeds, shortcuts, and season highlights will land here."
    />
  );
}

export function LeaguesPage() {
  return (
    <PlaceholderCard
      title="Leagues"
      body="Search and manage the leagues you belong to. Join / request flows come next."
    />
  );
}

export function HeadlinesPage() {
  return (
    <PlaceholderCard
      title="Headlines"
      body="Global REC media and headlines (formerly Media). Stories and clips will appear here."
    />
  );
}

export function CompPage() {
  return (
    <PlaceholderCard
      title="Comp"
      body="Competition board placeholder — standings across events and ladders."
    />
  );
}

export function LeagueBuzzPage() {
  const { leagueId = "" } = useParams();
  const hub = useHub();
  const game = hub.selectedLeague?.game ?? hub.leagues.find((l) => l.id === leagueId)?.game;
  const title = game?.startsWith("madden") ? "Breaking News" : "Campus Buzz";
  return (
    <PlaceholderCard
      title={title}
      body="League social feed placeholder."
      links={[{ to: `/l/${leagueId}/matchups`, label: "Matchups" }]}
    />
  );
}

export function LeagueMatchupsPage() {
  const { leagueId = "" } = useParams();
  const [games, setGames] = useState<Array<{ gameId: string; label: string }>>([]);
  const [weekNumber, setWeekNumber] = useState<number | null>(null);
  const [gameId, setGameId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    let active = true;
    siteApi
      .listHighlightGames(leagueId)
      .then((result) => {
        if (!active) return;
        setWeekNumber(result.weekNumber);
        setGames(result.games);
        setGameId(result.games[0]?.gameId ?? "");
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load matchups.");
      });
    return () => {
      active = false;
    };
  }, [leagueId]);

  async function onFileSelected(file: File | null) {
    if (!file || !leagueId || !gameId) return;
    setBusy(true);
    setError(null);
    setNotice(`Uploading ${file.name}…`);
    try {
      const direct = await siteApi.createHighlightDirectUpload({
        leagueId,
        gameId,
        fileName: file.name,
      });
      const form = new FormData();
      form.append("file", file);
      const uploaded = await fetch(direct.uploadURL, { method: "POST", body: form });
      if (!uploaded.ok) throw new Error(`Cloudflare upload failed (${uploaded.status}).`);
      await siteApi.markHighlightUploadReceived({ leagueId, highlightId: direct.highlightId });
      setNotice("Uploaded — encoding to 720p. Commissioners will review before it appears in Highlights.");
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const status = await siteApi.getHighlightUploadStatus({
          leagueId,
          highlightId: direct.highlightId,
        });
        if (status.mediaStatus === "ready") {
          setNotice("Ready for commissioner review. You’ll be paid after they approve (if a payout slot is available).");
          break;
        }
        if (status.mediaStatus === "failed") {
          throw new Error("Encoding failed. Try another clip.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlaceholderCard
      title="Matchups"
      body={
        weekNumber
          ? `Week ${weekNumber}. Upload an in-game highlight from your matchup (registered accounts only). Clips go to Cloudflare Stream and wait for commissioner approval before payout/display.`
          : "This week's slate. Upload highlights from your matchup once games load."
      }
    >
      {error && <p className="site-auth-error">{error}</p>}
      {notice && <p className="site-auth-success">{notice}</p>}
      {games.length === 0 ? (
        <p className="site-muted">No uploadable matchup for you this week (need an active team assignment).</p>
      ) : (
        <div className="site-billing-panel">
          <label className="site-field">
            <span>Your matchup</span>
            <select
              className="site-select"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              disabled={busy}
            >
              {games.map((game) => (
                <option key={game.gameId} value={game.gameId}>
                  {game.label}
                </option>
              ))}
            </select>
          </label>
          <label className="site-field">
            <span>Highlight clip (video)</span>
            <input
              type="file"
              accept="video/*"
              disabled={busy || !gameId}
              onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
            />
          </label>
          {busy && <p className="site-muted">Working…</p>}
        </div>
      )}
    </PlaceholderCard>
  );
}

export function LeagueTeamPage() {
  return (
    <PlaceholderCard
      title="My Team"
      body="Your roster, depth chart, and team tools for this league."
    />
  );
}

export function LeagueStorePage() {
  return (
    <PlaceholderCard
      title="Store"
      body="League store placeholder — purchases and upgrades for this franchise."
    />
  );
}

export function LeagueMgmtPage() {
  const { leagueId = "" } = useParams();
  const [botEnabled, setBotEnabled] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [botBusy, setBotBusy] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function enableBot() {
    if (!leagueId) return;
    setBotBusy(true);
    setBotError(null);
    setCopied(false);
    try {
      const result = await siteApi.enableLeagueBot(leagueId);
      setBotEnabled(result.league.discord_bot_enabled);
      setInviteToken(result.league.discord_bot_invite_token);
    } catch (error) {
      setBotError(
        error instanceof Error ? error.message : "Could not enable Discord bot.",
      );
    } finally {
      setBotBusy(false);
    }
  }

  async function disableBot() {
    if (!leagueId) return;
    setBotBusy(true);
    setBotError(null);
    setCopied(false);
    try {
      const result = await siteApi.disableLeagueBot(leagueId);
      setBotEnabled(result.league.discord_bot_enabled);
      setInviteToken(null);
    } catch (error) {
      setBotError(
        error instanceof Error ? error.message : "Could not disable Discord bot.",
      );
    } finally {
      setBotBusy(false);
    }
  }

  async function copyToken() {
    if (!inviteToken) return;
    try {
      await navigator.clipboard.writeText(inviteToken);
      setCopied(true);
    } catch {
      setBotError("Could not copy invite token.");
    }
  }

  return (
    <PlaceholderCard
      title="League Mgmt"
      body="Commissioner tools live here. Retire, request demotion to member, and future primary-commissioner transfer will be managed from this page. The notification bell's Commissioner section deep-links into this league's review inbox — it does not replace the Office tools here."
      links={[
        { to: `/l/${leagueId}/mgmt/inbox`, label: "Commissioner inbox" },
      ]}
    >
      <div className="site-billing-panel">
        <h2>
          Discord bot{" "}
          <span className="site-discord-only-badge">Owner · Platinum</span>
        </h2>
        <p className="site-muted">
          Enable the REC Discord bot for this league. Requires a Platinum plan and
          league ownership. Enabling generates a fresh invite token.
        </p>
        {botError && <p className="site-auth-error">{botError}</p>}
        {botEnabled && inviteToken ? (
          <>
            <label className="site-field">
              <span>Invite token</span>
              <input readOnly value={inviteToken} />
            </label>
            <div className="site-profile-actions">
              <button
                className="site-btn site-btn-primary"
                type="button"
                onClick={() => void copyToken()}
              >
                {copied ? "Copied" : "Copy token"}
              </button>
              <button
                className="site-btn site-btn-ghost"
                type="button"
                disabled={botBusy}
                onClick={() => void disableBot()}
              >
                {botBusy ? "Working…" : "Disable bot"}
              </button>
            </div>
          </>
        ) : (
          <button
            className="site-btn site-btn-primary site-btn-lg"
            type="button"
            disabled={botBusy || !leagueId}
            onClick={() => void enableBot()}
          >
            {botBusy ? "Enabling…" : "Enable Discord bot"}
          </button>
        )}
      </div>
    </PlaceholderCard>
  );
}

export function LeagueMgmtInboxPage() {
  const { leagueId = "" } = useParams();
  const [items, setItems] = useState<
    Array<{
      reviewId: string;
      header: string;
      summary: string;
      amount: number;
      uploaderName: string;
      iframeUrl: string | null;
      playbackUrl: string | null;
    }>
  >([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrateNotice, setMigrateNotice] = useState<string | null>(null);

  async function reload() {
    if (!leagueId) return;
    const result = await siteApi.listPendingHighlights(leagueId);
    setItems(result.items);
  }

  useEffect(() => {
    let active = true;
    reload()
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load inbox.");
      });
    return () => {
      active = false;
    };
  }, [leagueId]);

  async function review(reviewId: string, action: "approve" | "deny") {
    if (!leagueId) return;
    setBusyId(reviewId);
    setError(null);
    try {
      await siteApi.reviewHighlight({
        leagueId,
        reviewId,
        action,
        deniedReason: action === "deny" ? "Denied by commissioner review." : undefined,
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function migrateLegacy() {
    if (!leagueId) return;
    setMigrateNotice("Migrating mirrored clips to Cloudflare Stream…");
    try {
      const result = await siteApi.migrateHighlightsToStream({ leagueId, limit: 50 });
      setMigrateNotice(`Stream migration: ${result.succeeded}/${result.attempted} succeeded (${result.failed} failed).`);
    } catch (err) {
      setMigrateNotice(null);
      setError(err instanceof Error ? err.message : "Migration failed.");
    }
  }

  return (
    <PlaceholderCard
      title="Commissioner inbox"
      body="Pending highlight reviews. Approve to publish the clip to Highlights and issue payout when a paid slot is available."
    >
      {error && <p className="site-auth-error">{error}</p>}
      {migrateNotice && <p className="site-muted">{migrateNotice}</p>}
      <div className="site-profile-actions" style={{ marginBottom: 16 }}>
        <button className="site-btn site-btn-ghost" type="button" onClick={() => void migrateLegacy()}>
          Migrate mirrored clips to Stream
        </button>
      </div>
      {items.length === 0 ? (
        <p className="site-muted">No pending highlights right now.</p>
      ) : (
        <div className="site-billing-panel" style={{ display: "grid", gap: 16 }}>
          {items.map((item) => (
            <article key={item.reviewId} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>{item.header}</h2>
              <p className="site-muted" style={{ margin: "0 0 8px" }}>
                {item.uploaderName} · {item.summary}
                {item.amount > 0 ? ` · ${item.amount} coins if approved` : " · display-only (weekly payout slots full)"}
              </p>
              {item.iframeUrl ? (
                <iframe
                  title="Pending highlight"
                  src={`${item.iframeUrl}?muted=true`}
                  style={{ width: "100%", aspectRatio: "16 / 9", border: 0, borderRadius: 8 }}
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : item.playbackUrl ? (
                <video src={item.playbackUrl} controls style={{ width: "100%", borderRadius: 8 }} />
              ) : (
                <p className="site-muted">Clip still encoding…</p>
              )}
              <div className="site-profile-actions" style={{ marginTop: 10 }}>
                <button
                  className="site-btn site-btn-primary"
                  type="button"
                  disabled={busyId === item.reviewId}
                  onClick={() => void review(item.reviewId, "approve")}
                >
                  Approve
                </button>
                <button
                  className="site-btn site-btn-ghost"
                  type="button"
                  disabled={busyId === item.reviewId}
                  onClick={() => void review(item.reviewId, "deny")}
                >
                  Deny
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </PlaceholderCard>
  );
}
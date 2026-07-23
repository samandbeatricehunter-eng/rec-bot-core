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

  async function readVideoDurationSeconds(file: File): Promise<number> {
    const objectUrl = URL.createObjectURL(file);
    try {
      return await new Promise<number>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve(Number(video.duration) || 0);
        video.onerror = () => reject(new Error(`Could not read duration for ${file.name}.`));
        video.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function uploadOne(file: File): Promise<void> {
    if (!leagueId || !gameId) return;
    const duration = await readVideoDurationSeconds(file);
    if (duration > 45) {
      throw new Error(
        `${file.name} is ${Math.ceil(duration)}s. Crop to 45 seconds or less and try again.`,
      );
    }
    const direct = await siteApi.createHighlightDirectUpload({
      leagueId,
      gameId,
      fileName: file.name,
    });
    const form = new FormData();
    form.append("file", file);
    const uploaded = await fetch(direct.uploadURL, { method: "POST", body: form });
    if (!uploaded.ok) throw new Error(`Cloudflare upload failed for ${file.name} (${uploaded.status}).`);
    await siteApi.markHighlightUploadReceived({ leagueId, highlightId: direct.highlightId });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const status = await siteApi.getHighlightUploadStatus({
        leagueId,
        highlightId: direct.highlightId,
      });
      if (status.mediaStatus === "ready") return;
      if (status.mediaStatus === "failed") {
        throw new Error(
          status.failureReason
          ?? `${file.name} was rejected. Crop to 45 seconds or less and try again.`,
        );
      }
    }
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length || !leagueId || !gameId) return;
    const files = Array.from(fileList).slice(0, 2);
    setBusy(true);
    setError(null);
    setNotice(
      files.length === 1
        ? `Uploading ${files[0].name}…`
        : `Uploading ${files.length} highlights…`,
    );
    const failures: string[] = [];
    let succeeded = 0;
    for (const file of files) {
      try {
        setNotice(`Uploading ${file.name}…`);
        await uploadOne(file);
        succeeded += 1;
      } catch (err) {
        failures.push(err instanceof Error ? err.message : `Upload failed for ${file.name}.`);
      }
    }
    if (succeeded > 0) {
      setNotice(
        succeeded === 1
          ? "Uploaded — encoding to 720p. Commissioner approval publishes it and issues payout when a paid slot is available."
          : `${succeeded} clips uploaded — encoding to 720p. Approve in commissioner inbox publishes + pays (when slots remain).`,
      );
    } else {
      setNotice(null);
    }
    if (failures.length) setError(failures.join(" "));
    setBusy(false);
  }

  return (
    <PlaceholderCard
      title="Matchups"
      body={
        weekNumber
          ? `Week ${weekNumber}. Upload up to 2 highlight clips at once (45 seconds max each). Commissioner approval publishes them and issues payout when a paid weekly slot remains.`
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
            <span>Highlight clips (up to 2 videos, ≤45s each)</span>
            <input
              type="file"
              accept="video/*"
              multiple
              disabled={busy || !gameId}
              onChange={(e) => {
                void onFilesSelected(e.target.files);
                e.target.value = "";
              }}
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

  return (
    <PlaceholderCard
      title="Commissioner inbox"
      body="Pending highlight reviews. Approve publishes the clip to Highlights and issues the payout when a paid weekly slot is available."
    >
      {error && <p className="site-auth-error">{error}</p>}
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

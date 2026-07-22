import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  return (
    <PlaceholderCard
      title="Campus Buzz"
      body="League social feed placeholder."
      links={[{ to: `/l/${leagueId}/matchups`, label: "Matchups" }]}
    />
  );
}

export function LeagueMatchupsPage() {
  return (
    <PlaceholderCard
      title="Matchups"
      body="This week's slate. Rankings and Open Teams will be tabs on this page in a later pass."
    />
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
  return (
    <PlaceholderCard
      title="Commissioner inbox"
      body="League review queue (streams, box scores, purchases, etc.). Distinct from the top-right notification bell, which only summarizes and deep-links here. Full review UI ports from Commissioners Office next."
    />
  );
}
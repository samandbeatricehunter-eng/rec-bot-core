import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { useHub } from "../lib/hub-context.js";
import {
  siteApi,
  type EntitlementSummary,
  type LinkProfileResponse,
  type SiteLeagueSummary,
} from "../lib/site-api.js";

function roleLabel(league: SiteLeagueSummary) {
  const role = league.commissionerRole ?? (league.isCommissioner ? "co" : "member");
  if (role === "head") return "Head Commish";
  if (role === "co") return "Co-Commish";
  return "Member";
}

function tierLabel(entitlements: EntitlementSummary | null | undefined) {
  const tier = entitlements?.tier ?? "none";
  if (tier === "platinum") return "Platinum Member";
  if (tier === "gold") return "Gold Member";
  return "Member";
}

export function HomePage() {
  const auth = useAuth();
  const hub = useHub();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<LinkProfileResponse | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementSummary | null>(null);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    let cancelled = false;
    Promise.all([
      siteApi.getLinkProfile().catch(() => null),
      siteApi.getEntitlements().catch(() => null),
    ]).then(([me, ents]) => {
      if (cancelled) return;
      setProfile(me);
      setEntitlements(ents ?? me?.entitlements ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  const displayName = profile?.displayName || profile?.username || "Coach";
  const isCommissioner = hub.leagues.some((league) => league.isCommissioner);
  const tier = entitlements ?? profile?.entitlements;
  const isPlatinum = tier?.tier === "platinum";

  function openLeague(leagueId: string) {
    hub.selectLeague(leagueId);
    navigate(`/l/${leagueId}/buzz`);
  }

  return (
    <div className="site-home">
      <section className="site-home-hero">
        <div className="site-home-hero-copy">
          <p className="site-home-eyebrow">REC Leagues eSports</p>
          <h1>Welcome back, {displayName}</h1>
          <p>
            {tierLabel(tier)}
            {isCommissioner ? " · Commissioner tools ready" : " · Your leagues at a glance"}
          </p>
        </div>
        {isPlatinum ? <span className="site-home-badge">Platinum</span> : null}
      </section>

      <div className="site-home-grid">
        {isCommissioner ? (
          <section className="site-home-panel">
            <header className="site-home-panel-head">
              <p>Commissioner</p>
              <h2>Quick actions</h2>
            </header>
            <div className="site-home-actions">
              <Link className="site-home-action" to="/leagues">
                <strong>Create / find league</strong>
                <span>Search open leagues or claim ownership</span>
              </Link>
              <Link className="site-home-action" to="/inbox">
                <strong>Inbox</strong>
                <span>Messages and league threads</span>
              </Link>
              <Link className="site-home-action" to="/account">
                <strong>Account & linking</strong>
                <span>Discord, username, membership</span>
              </Link>
              <Link className="site-home-action" to="/pricing">
                <strong>Membership</strong>
                <span>Gold & Platinum plans</span>
              </Link>
            </div>
          </section>
        ) : null}

        <section className="site-home-panel site-home-panel-wide">
          <header className="site-home-panel-head">
            <p>Your season</p>
            <h2>My leagues</h2>
          </header>
          {hub.leaguesLoading ? (
            <p className="site-muted">Loading leagues…</p>
          ) : hub.leaguesError ? (
            <p className="site-auth-error">{hub.leaguesError}</p>
          ) : hub.leagues.length === 0 ? (
            <div className="site-home-empty">
              <p>No leagues linked yet.</p>
              <Link className="site-btn site-btn-primary" to="/leagues">
                Browse leagues
              </Link>
            </div>
          ) : (
            <ul className="site-home-league-list">
              {hub.leagues.map((league) => (
                <li key={league.id}>
                  <button type="button" className="site-home-league-row" onClick={() => openLeague(league.id)}>
                    <span className="site-home-league-mark" aria-hidden>
                      {String(league.name ?? "?").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="site-home-league-copy">
                      <strong>{league.name}</strong>
                      <span>
                        {league.gameLabel} · {roleLabel(league)}
                        {league.teamName ? ` · ${league.teamName}` : ""}
                      </span>
                    </span>
                    <span className="site-home-league-cta">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="site-home-panel">
          <header className="site-home-panel-head">
            <p>Around REC</p>
            <h2>Headlines</h2>
          </header>
          <div className="site-home-empty">
            <p>Global headlines land here as the media board ships.</p>
            <Link className="site-btn site-btn-ghost" to="/headlines">
              Open Headlines
            </Link>
          </div>
        </section>

        <section className="site-home-panel">
          <header className="site-home-panel-head">
            <p>Activity</p>
            <h2>Recent</h2>
          </header>
          <div className="site-home-empty">
            <p>League advances, invites, and challenges will show up here.</p>
            <Link className="site-btn site-btn-ghost" to="/inbox">
              Open Inbox
            </Link>
          </div>
        </section>
      </div>

      {!isPlatinum ? (
        <section className="site-home-platinum-banner">
          <div>
            <strong>Go Platinum</strong>
            <p>Exclusive tournaments, priority support, and commissioner power tools.</p>
          </div>
          <Link className="site-btn site-btn-primary" to="/pricing">
            Manage membership
          </Link>
        </section>
      ) : null}
    </div>
  );
}

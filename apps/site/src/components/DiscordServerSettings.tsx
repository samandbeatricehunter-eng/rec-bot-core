import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { siteApi } from "../lib/site-api.js";

/**
 * League Settings > Discord Server — reaches the same /discord-guild-picker League created
 * league linkage flow that the "My Leagues" ConnectDiscordCard uses (fresh "guilds"-scoped
 * OAuth round-trip, pick server, link, invite bot). Unlike that card, this one renders on
 * the league's own Settings page (which is the route the Create League wizard points
 * commissioners to: "…or use League Settings to connect a server"), so it also shows the
 * current link state and returns the user here after the picker finishes.
 */
export function DiscordServerSettings({ leagueId }: { leagueId: string }) {
  const location = useLocation();
  const [status, setStatus] = useState<{ linked: boolean; serverName: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setError(null);
    siteApi
      .checkLeagueLinked(leagueId)
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not check the server link.");
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const pickerNext = location.pathname || `/l/${leagueId}/mgmt/settings`;
  const pickerPath = `/discord-guild-picker?leagueId=${encodeURIComponent(leagueId)}&next=${encodeURIComponent(pickerNext)}`;

  return (
    <section className="site-page-card"
      style={{ marginBottom: "var(--space-4)" }}
    >
      <h2 style={{ marginTop: 0 }}>Discord Server</h2>
      {error ? (
        <p className="site-auth-error">{error}</p>
      ) : status === null ? (
        <p className="site-muted">Checking your Discord connection…</p>
      ) : status.linked ? (
        <>
          <p className="site-muted">
            This league is linked to <strong>{status.serverName ?? "a Discord server"}</strong>.
            The REC bot handles league news, chat routing, and roster/team roles in that server.
          </p>
          <Link className="site-btn site-btn-ghost" to={pickerPath}>
            Change Discord Server
          </Link>
        </>
      ) : (
        <>
          <p className="site-muted">
            No Discord server is linked to this league yet. In-game chat and the REC bot can't
            post here until you connect one.
          </p>
          <Link className="site-btn site-btn-primary" to={pickerPath}>
            Connect a Discord Server
          </Link>
        </>
      )}
    </section>
  );
}
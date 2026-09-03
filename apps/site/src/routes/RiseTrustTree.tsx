// Placeholder page -- the Trust Tree mechanic itself hasn't been designed yet. Exists so the
// "My Team" nav link (HubHome.tsx) has somewhere real to go rather than a dead link.
import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";

export function RiseTrustTreePage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";

  useEffect(() => {
    if (leagueId) hubCtx.ensureLeagueScope(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  if (selected && !isRise) return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  if (!selected) return <div className="site-page site-loading">Loading…</div>;

  return (
    <div className="site-page rise-page">
      <header className="rise-hero">
        <p className="site-muted">My Team</p>
        <h1>Trust Tree</h1>
        <p className="site-muted">This page is coming soon.</p>
      </header>
      <p><Link to={`/l/${leagueId}/team/upgrades`}>Back to Player XP</Link></p>
    </div>
  );
}

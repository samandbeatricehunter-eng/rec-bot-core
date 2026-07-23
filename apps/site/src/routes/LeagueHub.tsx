import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { siteApi } from "../lib/site-api.js";

type HubView = "buzz" | "matchups" | "team" | "store" | "mgmt";

function viewFromPath(pathname: string): HubView {
  if (pathname.includes("/matchups")) return "matchups";
  if (pathname.includes("/team")) return "team";
  if (pathname.includes("/store")) return "store";
  if (pathname.includes("/mgmt")) return "mgmt";
  return "buzz";
}

function hashForView(view: HubView): string {
  switch (view) {
    case "matchups":
      return "#/?section=league&subTab=matchups";
    case "team":
      return "#/?section=team";
    case "store":
      return "#/?section=store";
    case "mgmt":
      return "#/league-mgmt";
    case "buzz":
    default:
      return "#/?section=league&subTab=buzz";
  }
}

function applyHubView(hubUrl: string, view: HubView): string {
  try {
    const url = new URL(hubUrl);
    url.hash = hashForView(view).replace(/^#/, "");
    return url.toString();
  } catch {
    return hubUrl;
  }
}

/**
 * Embeds the Discord Activity hub (apps/web) inside the site shell so desktop
 * keeps the site sidebar while showing the same panels as /app.
 */
export function LeagueHubPage() {
  const { leagueId = "" } = useParams();
  const location = useLocation();
  const view = useMemo(() => viewFromPath(location.pathname), [location.pathname]);
  const [baseHubUrl, setBaseHubUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    siteApi
      .openLeagueHub({ leagueId, view: "buzz", embed: true })
      .then((result) => {
        if (cancelled) return;
        setBaseHubUrl(result.hubUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        setBaseHubUrl(null);
        setError(err instanceof Error ? err.message : "Could not open league hub.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const hubUrl = baseHubUrl ? applyHubView(baseHubUrl, view) : null;

  if (loading) {
    return <div className="site-page site-loading">Loading league hub...</div>;
  }

  if (error || !hubUrl) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Could not open league</h1>
          <p className="site-auth-error">{error ?? "Missing hub URL."}</p>
          <p className="site-muted">
            Finish Discord linking and username on Account, then try again. You can also open the
            hub from Discord with <strong>/app</strong>.
          </p>
          <div className="site-league-demo-links">
            <Link className="site-btn site-btn-primary" to="/account">
              Account
            </Link>
            <Link className="site-btn site-btn-ghost" to="/leagues">
              Leagues
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="site-hub-embed">
      <iframe
        key={`${leagueId}:${view}`}
        className="site-hub-embed-frame"
        title="League hub"
        src={hubUrl}
        allow="autoplay; fullscreen; clipboard-write"
      />
    </div>
  );
}

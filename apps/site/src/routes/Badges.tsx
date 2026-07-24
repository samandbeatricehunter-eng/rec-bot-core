import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi } from "../lib/site-api.js";

type BadgeRow = {
  badge_key: string;
  badge_scope: string;
  polarity: string | null;
  tier: string | null;
  earned_count: number | null;
  season: number | null;
  week: number | null;
};

function labelFor(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function BadgesPage() {
  const auth = useAuth();
  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    let cancelled = false;
    setLoading(true);
    siteApi
      .listMyBadges()
      .then((response) => {
        if (!cancelled) setBadges(response.badges ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load badges.");
          setBadges([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  return (
    <div className="site-home">
      <section className="site-home-panel">
        <header className="site-home-panel-head">
          <p>Career collection</p>
          <h2>Your Badges</h2>
        </header>
        <p className="site-muted" style={{ marginTop: 0 }}>
          <Link to="/home">← Back to Home</Link>
        </p>
        {loading ? <p className="site-muted">Loading badges…</p> : null}
        {error ? <p className="site-auth-error">{error}</p> : null}
        {!loading && !error && badges.length === 0 ? (
          <p className="site-muted">No badges earned yet.</p>
        ) : null}
        {badges.length > 0 ? (
          <ul className="site-badge-list">
            {badges.map((badge, index) => (
              <li key={`${badge.badge_key}-${badge.season ?? "x"}-${badge.week ?? "x"}-${index}`}>
                <strong>{labelFor(badge.badge_key)}</strong>
                <span>
                  {[badge.badge_scope, badge.tier, badge.polarity]
                    .filter(Boolean)
                    .join(" · ")}
                  {badge.earned_count && badge.earned_count > 1
                    ? ` · ×${badge.earned_count}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
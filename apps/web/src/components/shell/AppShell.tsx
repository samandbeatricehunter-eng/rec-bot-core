import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Trash2, Trophy } from "lucide-react";
import { Button } from "../ui/Button.js";
import { NotificationBell } from "../ui/NotificationBell.js";
import { useAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { LeagueHeaderSummary } from "../../types/api.js";

const NOTIFICATION_POLL_MS = 30_000;

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const isHome = location.pathname === "/";
  const [notificationCount, setNotificationCount] = useState(0);
  const [headerSummary, setHeaderSummary] = useState<LeagueHeaderSummary | null>(null);

  useEffect(() => {
    if (auth.status !== "ready") return;
    let cancelled = false;
    function load() {
      if (auth.status !== "ready") return;
      recApi
        .listCommissionerNotifications(auth.guildId)
        .then((res) => { if (!cancelled) setNotificationCount(res.notifications.length); })
        .catch(() => { if (!cancelled) setNotificationCount(0); });
    }
    load();
    const interval = setInterval(load, NOTIFICATION_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [auth.status, auth.status === "ready" ? auth.guildId : null]);

  // League identity (name/password/season/week/team-count) doesn't change second-to-second
  // like notifications do — fetch once per mount, no polling.
  useEffect(() => {
    if (auth.status !== "ready") return;
    recApi
      .getLeagueHeaderSummary(auth.guildId)
      .then(setHeaderSummary)
      .catch(() => setHeaderSummary(null));
  }, [auth.status, auth.status === "ready" ? auth.guildId : null]);

  return (
    <div className="app-backdrop">
      <div style={{ maxWidth: "var(--content-width)", margin: "0 auto", padding: "var(--space-5)" }}>
        <header
          className="app-header-bar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            marginBottom: "var(--space-6)",
          }}
        >
          {!isHome && (
            <Button variant="ghost" onClick={() => navigate(-1)}>
              <ChevronLeft size={18} /> Back
            </Button>
          )}
          <Link
            to="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              fontWeight: 800,
              fontSize: "var(--text-lg)",
              textDecoration: "none",
              color: "var(--gold)",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <Trophy size={22} />
            REC LEAGUE
          </Link>
          {headerSummary && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {headerSummary.league.name}
              </span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                Season {headerSummary.league.seasonNumber} · Week {headerSummary.league.currentWeek ?? "—"} ·{" "}
                {headerSummary.teams.linked}/{headerSummary.teams.total} teams linked
                {headerSummary.league.leaguePassword && <> · Password: {headerSummary.league.leaguePassword}</>}
              </span>
            </div>
          )}
          <div style={{ marginLeft: "auto" }}>
            {auth.status === "ready" && <NotificationBell count={notificationCount} />}
          </div>
        </header>
        <main>{children}</main>
      </div>
      {headerSummary?.isGuildOwner && (
        <button
          onClick={() => navigate("/league-mgmt/delete-league")}
          className="delete-league-fab"
          aria-label="Delete League"
          title="Delete League — head commissioner only"
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

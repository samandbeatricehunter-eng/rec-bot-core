import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Trash2, Trophy } from "lucide-react";
import { Button } from "../ui/Button.js";
import { NotificationBell } from "../ui/NotificationBell.js";
import { HubNotificationsBell } from "../chrome/HubNotificationsBell.js";
import { LeagueSelector } from "../chrome/LeagueSelector.js";
import { BottomNav } from "../chrome/BottomNav.js";
import { useAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { LeagueThemeProvider } from "../../lib/league-theme-context.js";
import type { LeagueHeaderSummary } from "../../types/api.js";

const NOTIFICATION_POLL_MS = 30_000;

function isHubEmbedMode() {
  try {
    return new URLSearchParams(window.location.search).get("embed") === "1";
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const hub = useHubChrome();
  const embed = isHubEmbedMode();
  const isHome =
    location.pathname === "/" ||
    location.pathname === "/home" ||
    location.pathname === "/leagues";
  const isLeagueMgmt = location.pathname.startsWith("/league-mgmt");
  const isMainPlaceholder = ["/headlines", "/comp", "/account"].includes(location.pathname);
  // Show bottom chrome on hub home + main placeholders + league-mgmt (league nav with Mgmt active).
  // Site iframe embed keeps content chrome off — site shell owns navigation.
  const showChrome =
    !embed &&
    (isHome || isMainPlaceholder || isLeagueMgmt || location.pathname.startsWith("/matchups"));
  const isLeagueScope = hub.scope.kind === "league";
  const [notificationCount, setNotificationCount] = useState(0);
  const [headerSummary, setHeaderSummary] = useState<LeagueHeaderSummary | null>(null);

  useEffect(() => {
    if (auth.status !== "ready" || !isLeagueMgmt) {
      setNotificationCount(0);
      return;
    }
    let cancelled = false;
    function load() {
      if (auth.status !== "ready") return;
      recApi
        .listCommissionerNotifications(auth.guildId)
        .then((res) => {
          if (!cancelled) setNotificationCount(res.notifications.length);
        })
        .catch(() => {
          if (!cancelled) setNotificationCount(0);
        });
    }
    load();
    const interval = setInterval(load, NOTIFICATION_POLL_MS);
    window.addEventListener("rec:notifications-changed", load);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("rec:notifications-changed", load);
    };
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, isLeagueMgmt]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    recApi
      .getLeagueHeaderSummary(auth.guildId)
      .then(setHeaderSummary)
      .catch(() => setHeaderSummary(null));
  }, [auth.status, auth.status === "ready" ? auth.guildId : null]);

  // Universal Platinum chrome — game is still passed for labels/features, not visual reskin.
  useEffect(() => {
    document.documentElement.setAttribute("data-site-theme", "app");
    document.documentElement.removeAttribute("data-game-theme");
  }, [hub.scope.kind]);

  const gameForTheme =
    hub.scope.kind === "league"
      ? (hub.currentLeague?.game ?? headerSummary?.league.game ?? null)
      : null;

  return (
    <LeagueThemeProvider game={gameForTheme}>
      <div
        className={[
          "app-backdrop",
          isHome || embed ? "app-backdrop--hub" : "",
          showChrome ? "has-hub-chrome" : "",
          showChrome && isLeagueScope ? "is-league-scope" : "",
          showChrome && !isLeagueScope ? "is-main-scope" : "",
          embed ? "is-hub-embed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={`app-shell-container${showChrome ? " has-hub-chrome" : ""}`}>
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
              className="app-wordmark"
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
              {hub.scope.kind === "league" && hub.currentLeague
                ? hub.currentLeague.name
                : "REC Leagues eSports"}
            </Link>
            {headerSummary && hub.scope.kind === "league" && (
              <div className="app-header-summary">
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: "var(--text-sm)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {headerSummary.league.name}
                </span>
                <span className="app-header-summary-meta">
                  Season {headerSummary.league.seasonNumber} · {headerSummary.league.weekLabel} ·{" "}
                  {headerSummary.teams.linked}/{headerSummary.teams.cap} teams linked (
                  {headerSummary.teams.availableTeams} available)
                  {headerSummary.league.leaguePassword && (
                    <> · Password: {headerSummary.league.leaguePassword}</>
                  )}
                </span>
              </div>
            )}
            <div style={{ marginLeft: "auto" }}>
              {auth.status === "ready" && isLeagueMgmt ? (
                <NotificationBell count={notificationCount} />
              ) : auth.status === "ready" ? (
                <HubNotificationsBell />
              ) : null}
            </div>
          </header>
          <main>{children}</main>
        </div>
        {showChrome ? (
          <>
            <aside className="hub-desktop-sidebar" aria-label="Global navigation">
              <div className="hub-sidebar-brand">REC Leagues eSports</div>
              <BottomNav variant="global" layout="sidebar" />
              {hub.currentLeague ? (
                <div className="hub-sidebar-leagues">
                  <div className="hub-sidebar-section-label">MY LEAGUES</div>
                  <button
                    type="button"
                    className={[
                      "hub-sidebar-league-btn",
                      hub.scope.kind === "league" ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => hub.selectLeague()}
                  >
                    <span className="hub-sidebar-league-name">{hub.currentLeague.name}</span>
                    <span className="hub-sidebar-league-meta">
                      {hub.currentLeague.gameLabel}
                      {hub.currentLeague.isCommissioner ? " · Commish" : " · Member"}
                    </span>
                  </button>
                </div>
              ) : null}
            </aside>
            <div className="hub-chrome-stack hub-chrome-stack-mobile">
              <LeagueSelector />
              <BottomNav variant="auto" />
            </div>
            {isLeagueScope ? (
              <div className="hub-chrome-stack hub-chrome-stack-desktop-league">
                <BottomNav variant="league" />
              </div>
            ) : null}
          </>
        ) : null}
        {isLeagueMgmt && headerSummary?.isGuildOwner && (
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
    </LeagueThemeProvider>
  );
}

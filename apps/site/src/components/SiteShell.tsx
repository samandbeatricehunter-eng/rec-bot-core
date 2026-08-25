import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav.js";
import { DesktopSidebar } from "./DesktopSidebar.js";
import { ImpersonationBanner } from "./ImpersonationBanner.js";
import { NotificationsBell } from "./NotificationsBell.js";
import { ProfileChip } from "./ProfileChip.js";
import { SiteFooter } from "./SiteFooter.js";
import { SiteTicker } from "./SiteTicker.js";
import { GoingLiveModal } from "./GoingLiveModal.js";
import { useHub } from "../lib/hub-context.js";

// Which of the four background images (site.css's .site-shell[data-bg=...]) applies here.
// Tournaments is a cross-league site feature (not tied to hub.selectedLeague), so it's
// resolved from the route rather than league scope; everything else falls back to "general".
function resolveBackground(pathname: string, game: string | undefined): "madden" | "cfb" | "tournaments" | "general" {
  if (pathname.startsWith("/tournaments")) return "tournaments";
  if (game === "cfb_27") return "cfb";
  if (game?.startsWith("madden")) return "madden";
  return "general";
}

export function SiteShell({ children }: { children: ReactNode }) {
  const hub = useHub();
  const location = useLocation();
  const isLeague = hub.scope.kind === "league";
  const background = resolveBackground(location.pathname, hub.selectedLeague?.game);

  return (
    <div
      className={[
        "site-shell",
        isLeague ? "is-league-scope" : "is-main-scope",
      ].join(" ")}
      data-bg={background}
    >
      <ImpersonationBanner />
      <header className="site-top-bar">
        <div className="site-top-bar-start">
          {hub.selectedLeague ? (
            <div className="site-top-bar-league">
              <strong>{hub.selectedLeague.name}</strong>
              <span>{hub.selectedLeague.gameLabel}</span>
            </div>
          ) : (
            <span className="site-top-bar-brand site-top-bar-brand-mobile-only">REC Leagues</span>
          )}
        </div>
        <div className="site-top-bar-end">
          {/* LeagueTopNav no longer renders its own bell (removed as a duplicate in
              fb43ca5e) — this is the only notification bell now, on every page. */}
          <NotificationsBell />
          <ProfileChip />
        </div>
      </header>

      <DesktopSidebar />

      <main className="site-shell-main">
        {children}
        {!isLeague ? <SiteFooter /> : null}
      </main>

      <div className="site-chrome-stack site-chrome-stack-mobile">
        <BottomNav />
      </div>

      <SiteTicker />
      <GoingLiveModal />
    </div>
  );
}
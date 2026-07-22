import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav.js";
import { DesktopSidebar } from "./DesktopSidebar.js";
import { LeagueSelector } from "./LeagueSelector.js";
import { NotificationsBell } from "./NotificationsBell.js";
import { useHub } from "../lib/hub-context.js";

export function SiteShell({ children }: { children: ReactNode }) {
  const hub = useHub();
  const isLeague = hub.scope.kind === "league";

  return (
    <div
      className={[
        "site-shell",
        isLeague ? "is-league-scope" : "is-main-scope",
      ].join(" ")}
    >
      <header className="site-top-bar">
        <span className="site-top-bar-brand">REC League</span>
        <NotificationsBell />
      </header>

      <DesktopSidebar />

      <main className="site-shell-main">{children}</main>

      <div className="site-chrome-stack site-chrome-stack-mobile">
        <LeagueSelector />
        <BottomNav variant="auto" />
      </div>

      {isLeague ? (
        <div className="site-chrome-stack site-chrome-stack-desktop-league">
          <BottomNav variant="league" />
        </div>
      ) : null}
    </div>
  );
}

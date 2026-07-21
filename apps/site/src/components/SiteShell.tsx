import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav.js";
import { LeagueSelector } from "./LeagueSelector.js";
import { NotificationsBell } from "./NotificationsBell.js";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell">
      <header className="site-top-bar">
        <span className="site-top-bar-brand">REC League</span>
        <NotificationsBell />
      </header>
      <main className="site-shell-main">{children}</main>
      <div className="site-chrome-stack">
        <LeagueSelector />
        <BottomNav />
      </div>
    </div>
  );
}
